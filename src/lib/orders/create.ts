import { z } from "zod";
import { db, type Tx } from "@/lib/db/client";
import { computeTotals, validateCoupon, type Coupon } from "@/lib/cart/totals";
import { loadCartLines } from "@/lib/cart/cart";
import { quoteShipping, type QuoteFn } from "@/lib/shipping/quote";
import { readSetting } from "@/lib/settings";
import { isValidCPF, onlyDigits } from "@/lib/validation/br";

export const checkoutSchema = z.object({
  idempotencyKey: z.string().min(16).max(80),
  name: z.string().trim().min(3, "Informe o nome completo").max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido").max(200),
  phone: z.string().transform(onlyDigits).pipe(z.string().min(10, "Telefone inválido").max(13)),
  cpf: z.string().transform(onlyDigits).optional(),
  address: z.object({
    recipient_name: z.string().trim().min(3).max(120),
    cep: z.string().transform(onlyDigits).pipe(z.string().length(8, "CEP inválido")),
    street: z.string().trim().min(2).max(200),
    number: z.string().trim().min(1).max(20),
    complement: z.string().trim().max(120).optional().nullable(),
    district: z.string().trim().min(2).max(120),
    city: z.string().trim().min(2).max(120),
    state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "UF inválida"),
  }),
  shippingOptionId: z.string().min(1).max(60),
  notes: z.string().trim().max(500).optional().nullable(),
  utm: z.record(z.string(), z.string().max(200)).optional().nullable(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export class CheckoutError extends Error {}

export type CreatedOrder = { id: string; number: number; total: number; alreadyExisted: boolean };

/**
 * Cria o pedido a partir do carrinho em UMA transação:
 * bloqueia carrinho, variações e cupom; revalida preços, estoque e frete no
 * servidor (nunca confia em valores do navegador); grava o snapshot de preço e
 * custo; reserva o estoque espelhado do fornecedor. A chave de idempotência
 * garante que um duplo clique ou reenvio não gere dois pedidos.
 */
export async function createOrderFromCart(
  cartId: string,
  profileId: string | null,
  raw: unknown,
  deps: { melhorEnvio?: QuoteFn } = {},
): Promise<CreatedOrder> {
  const input = checkoutSchema.parse(raw);
  const checkoutCfg = await readSetting("checkout");
  if (checkoutCfg.require_cpf && (!input.cpf || !isValidCPF(input.cpf))) throw new CheckoutError("CPF inválido.");
  if (input.cpf && !isValidCPF(input.cpf)) throw new CheckoutError("CPF inválido.");

  const sql = db();
  const [existing] = await sql<{ id: string; number: string; total_cents: number }[]>`
    select id, number, total_cents from public.orders where idempotency_key = ${input.idempotencyKey}`;
  if (existing) return { id: existing.id, number: Number(existing.number), total: existing.total_cents, alreadyExisted: true };

  return sql.begin(async (tx: Tx) => {
    const [cart] = await tx<{ id: string; status: string; coupon_code: string | null; utm: unknown }[]>`
      select id, status, coupon_code, utm from public.carts where id = ${cartId} for update`;
    if (!cart || cart.status !== "open") throw new CheckoutError("Carrinho não encontrado ou já finalizado.");

    const lines = await loadCartLines(cartId, tx);
    if (lines.length === 0) throw new CheckoutError("Seu carrinho está vazio.");

    // Bloqueia as variações para checar e reservar estoque sem corrida.
    const variantIds = lines.map((l) => l.variantId);
    const stock = await tx<{ id: string; stock_quantity: number; cost: number; ship: number; supplier_variant_ref: string | null; supplier_product_ref: string | null }[]>`
      select v.id, v.stock_quantity, coalesce(v.cost_cents, p.cost_cents) as cost,
             coalesce(v.shipping_cost_cents, p.shipping_cost_cents) as ship,
             v.supplier_variant_ref, p.supplier_product_ref
      from public.product_variants v join public.products p on p.id = v.product_id
      where v.id = any(${variantIds}::uuid[]) for update of v`;
    const byId = new Map(stock.map((s) => [s.id, s]));
    for (const l of lines) {
      const s = byId.get(l.variantId);
      if (!l.available || !s || s.stock_quantity < l.quantity) {
        throw new CheckoutError(`"${l.name}${l.variantTitle !== "Padrão" ? ` (${l.variantTitle})` : ""}" não tem estoque suficiente. Ajuste o carrinho.`);
      }
    }

    const quoteLines = lines.map((l) => ({ productId: l.productId, variantId: l.variantId, quantity: l.quantity, unitPrice: l.unitPrice, shippingCost: l.shippingCost, supplierId: l.supplierId }));
    const options = await quoteShipping(quoteLines, input.address.cep, tx, deps.melhorEnvio);
    const chosen = options.find((o) => o.id === input.shippingOptionId);
    if (!chosen) throw new CheckoutError("Opção de frete indisponível. Recalcule o frete.");

    // Cupom (bloqueado para controlar limite de usos)
    let coupon: Coupon | null = null;
    if (cart.coupon_code) {
      const [c] = await tx<Coupon[]>`select * from public.coupons where code = ${cart.coupon_code} for update`;
      if (c) {
        const subtotal = lines.reduce((a, l) => a + l.unitPrice * l.quantity, 0);
        const [{ paid, uses }] = await tx<{ paid: number; uses: number }[]>`
          select
            (select count(*)::int from public.orders where lower(customer_email) = ${input.email} and paid_at is not null) as paid,
            (select count(*)::int from public.coupon_redemptions r join public.orders o on o.id = r.order_id
              where r.coupon_id = ${c.id} and lower(r.customer_email) = ${input.email} and o.status not in ('canceled')) as uses`;
        const check = validateCoupon(c, { subtotal, customerPaidOrders: paid, customerCouponUses: uses, email: input.email });
        if (!check.ok) throw new CheckoutError(`Cupom ${c.code}: ${check.reason}`);
        coupon = c;
      } else {
        throw new CheckoutError("Cupom não encontrado. Remova-o para continuar.");
      }
    }

    const totals = computeTotals(lines.map((l) => ({ key: l.variantId, unitPrice: l.unitPrice, quantity: l.quantity })), chosen.price, coupon);
    if (totals.total < checkoutCfg.min_order_cents) throw new CheckoutError("Valor mínimo do pedido não atingido.");

    const fulfillment = await readSetting("fulfillment", tx);
    const supplierIds = Array.from(new Set(lines.map((l) => l.supplierId).filter(Boolean))) as string[];
    const manualSuppliers = supplierIds.length
      ? await tx<{ n: number }[]>`select count(*)::int as n from public.suppliers where id = any(${supplierIds}::uuid[]) and requires_manual_approval`
      : [{ n: 0 }];
    const requiresManual = !fulfillment.auto_forward_paid_orders || manualSuppliers[0].n > 0 || lines.some((l) => !l.supplierId);

    const [order] = await tx<{ id: string; number: string }[]>`
      insert into public.orders (
        profile_id, cart_id, idempotency_key, status, customer_name, customer_email, customer_phone, customer_cpf,
        shipping_address, shipping_method, shipping_quote, subtotal_cents, discount_cents, shipping_cents, total_cents,
        coupon_id, coupon_code, requires_manual_approval, customer_notes, utm
      ) values (
        ${profileId}, ${cartId}, ${input.idempotencyKey}, 'pending_payment', ${input.name}, ${input.email}, ${input.phone}, ${input.cpf || null},
        ${tx.json(input.address as never)}, ${chosen.name}, ${tx.json(chosen as never)}, ${totals.subtotal}, ${totals.discount}, ${totals.shipping}, ${totals.total},
        ${coupon?.id ?? null}, ${coupon?.code ?? null}, ${requiresManual}, ${input.notes ?? null},
        ${input.utm ? tx.json(input.utm as never) : cart.utm ? tx.json(cart.utm as never) : null}
      ) returning id, number`;

    for (const l of lines) {
      const s = byId.get(l.variantId)!;
      const lineDiscount = totals.itemDiscounts[l.variantId] ?? 0;
      await tx`
        insert into public.order_items (
          order_id, product_id, variant_id, supplier_id, product_name, variant_title, sku, supplier_product_ref, supplier_variant_ref,
          image_url, quantity, unit_price_cents, unit_cost_cents, unit_shipping_cost_cents, discount_cents, total_cents
        ) values (
          ${order.id}, ${l.productId}, ${l.variantId}, ${l.supplierId}, ${l.name}, ${l.variantTitle}, ${l.sku}, ${s.supplier_product_ref}, ${s.supplier_variant_ref},
          ${l.image}, ${l.quantity}, ${l.unitPrice}, ${s.cost}, ${s.ship}, ${lineDiscount}, ${l.unitPrice * l.quantity - lineDiscount}
        )`;
      await tx`update public.product_variants set stock_quantity = stock_quantity - ${l.quantity} where id = ${l.variantId}`;
      await tx`insert into public.stock_history (variant_id, previous_quantity, new_quantity, source)
               values (${l.variantId}, ${s.stock_quantity}, ${s.stock_quantity - l.quantity}, ${"order:" + order.number})`;
    }

    if (coupon) {
      await tx`insert into public.coupon_redemptions (coupon_id, order_id, profile_id, customer_email, discount_cents)
               values (${coupon.id}, ${order.id}, ${profileId}, ${input.email}, ${totals.discount})`;
      await tx`update public.coupons set used_count = used_count + 1 where id = ${coupon.id}`;
    }

    await tx`insert into public.order_status_history (order_id, from_status, to_status, source, actor_id)
             values (${order.id}, null, 'pending_payment', 'checkout', ${profileId})`;
    await tx`update public.carts set status = 'converted', converted_order_id = ${order.id}, email = ${input.email} where id = ${cartId}`;

    if (profileId) {
      await tx`update public.profiles set
                 full_name = coalesce(full_name, ${input.name}),
                 phone = coalesce(phone, ${input.phone}),
                 cpf = coalesce(cpf, ${input.cpf || null})
               where id = ${profileId}`;
    }

    return { id: order.id, number: Number(order.number), total: totals.total, alreadyExisted: false };
  });
}

/** Devolve o estoque reservado (cancelamento/expiração de pedido não pago). */
export async function releaseOrderStock(tx: Tx, orderId: string, reason: string) {
  const items = await tx<{ variant_id: string | null; quantity: number }[]>`
    select variant_id, quantity from public.order_items where order_id = ${orderId} and variant_id is not null`;
  for (const it of items) {
    const [v] = await tx<{ stock_quantity: number }[]>`
      update public.product_variants set stock_quantity = stock_quantity + ${it.quantity} where id = ${it.variant_id}
      returning stock_quantity`;
    if (v) {
      await tx`insert into public.stock_history (variant_id, previous_quantity, new_quantity, source)
               values (${it.variant_id}, ${v.stock_quantity - it.quantity}, ${v.stock_quantity}, ${reason})`;
    }
  }
  await tx`update public.coupons c set used_count = greatest(used_count - 1, 0)
           from public.coupon_redemptions r where r.order_id = ${orderId} and r.coupon_id = c.id`;
}
