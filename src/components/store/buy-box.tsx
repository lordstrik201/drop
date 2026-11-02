"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { Truck, ShieldCheck } from "lucide-react";
import { addToCartAction, quoteShippingAction } from "@/app/(loja)/actions";
import { Alert, Button, Price, inputClass } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import type { EffectivePrice } from "@/lib/catalog/pricing";
import type { ShippingOption } from "@/lib/shipping/quote";

type Variant = { id: string; title: string; options: Record<string, string>; stock: number; pricing: EffectivePrice };

export function deliveryText(min: number | null, max: number | null) {
  if (min == null && max == null) return "Prazo informado após a confirmação do fornecedor";
  if (min != null && max != null && min !== max) return `Estimativa: ${min} a ${max} dias úteis`;
  return `Estimativa: ${max ?? min} dias úteis`;
}

export function BuyBox({ productId, variants, optionNames, leadTime }: { productId: string; variants: Variant[]; optionNames: string[]; leadTime: { min: number | null; max: number | null; processing: number | null } }) {
  const first = variants.find((v) => v.stock > 0) ?? variants[0];
  const [sel, setSel] = useState<Record<string, string>>(first?.options ?? {});
  const [qty, setQty] = useState(1);
  const [state, action, pending] = useActionState(addToCartAction, null);
  const [cep, setCep] = useState("");
  const [quote, setQuote] = useState<{ options?: ShippingOption[]; message?: string } | null>(null);
  const [quoting, startQuote] = useTransition();

  const variant = useMemo(() => {
    if (!optionNames.length) return variants[0];
    return variants.find((v) => optionNames.every((n) => v.options[n] === sel[n]));
  }, [sel, variants, optionNames]);

  const valuesFor = (name: string) => Array.from(new Set(variants.map((v) => v.options[name]).filter(Boolean)));
  const isAvailable = (name: string, value: string) => variants.some((v) => v.options[name] === value && v.stock > 0 && optionNames.every((n) => n === name || !sel[n] || v.options[n] === sel[n]));

  if (!variants.length) return <Alert tone="warning">Produto indisponível no momento.</Alert>;
  const max = Math.min(variant?.stock ?? 0, 99);

  return (
    <div className="mt-5 flex flex-col gap-5">
      {variant ? <Price price={variant.pricing.price} original={variant.pricing.original} size="lg" /> : <p className="text-sm text-muted">Selecione as opções</p>}
      {variant?.pricing.discountPercent ? <p className="-mt-3 text-sm font-semibold text-success">Economize {variant.pricing.discountPercent}%</p> : null}

      {optionNames.map((name) => (
        <fieldset key={name}>
          <legend className="mb-2 text-sm font-semibold">{name}: <span className="font-normal text-muted">{sel[name] ?? "selecione"}</span></legend>
          <div className="flex flex-wrap gap-2">
            {valuesFor(name).map((value) => {
              const active = sel[name] === value;
              const avail = isAvailable(name, value);
              return (
                <button key={value} type="button" onClick={() => setSel({ ...sel, [name]: value })} aria-pressed={active}
                  className={`min-w-11 rounded-lg border px-3 py-2 text-sm ${active ? "border-brand bg-brand/5 font-semibold text-brand" : "border-line bg-surface"} ${avail ? "" : "text-muted line-through opacity-60"}`}>
                  {value}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}

      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="variantId" value={variant?.id ?? ""} />
        <div className="flex items-center gap-3">
          <label htmlFor="qty" className="text-sm font-semibold">Quantidade</label>
          <select id="qty" name="quantity" value={qty} onChange={(e) => setQty(Number(e.target.value))} className={`${inputClass} w-24`} disabled={!variant || max < 1}>
            {Array.from({ length: Math.max(1, Math.min(max, 10)) }, (_, k) => k + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          {variant && variant.stock > 0 && variant.stock <= 5 && <span className="text-xs font-semibold text-warning">Últimas {variant.stock} unidades</span>}
        </div>
        {variant && variant.stock > 0 ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" name="buyNow" value="1" size="lg" variant="accent" className="flex-1" disabled={pending}>Comprar agora</Button>
            <Button type="submit" size="lg" className="flex-1" disabled={pending}>{pending ? "Adicionando…" : "Adicionar ao carrinho"}</Button>
          </div>
        ) : (
          <Alert tone="warning">{variant ? "Esgotado no fornecedor no momento." : "Combinação indisponível."}</Alert>
        )}
        {state?.message && <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert>}
      </form>

      <div className="rounded-xl border border-line p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold"><Truck size={18} aria-hidden /> Calcular frete e prazo</p>
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!variant) return; startQuote(async () => setQuote(await quoteShippingAction(cep, { productId, variantId: variant.id, quantity: qty }))); }}>
          <input aria-label="CEP" inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" value={cep} onChange={(e) => setCep(e.target.value)} className={`${inputClass} w-36`} maxLength={9} />
          <Button type="submit" variant="secondary" disabled={quoting || !variant}>{quoting ? "…" : "Calcular"}</Button>
          <a href="https://buscacepinter.correios.com.br/app/endereco/index.php" target="_blank" rel="noopener noreferrer" className="self-center text-xs text-brand underline">Não sei meu CEP</a>
        </form>
        {quote?.message && <p className="mt-2 text-danger">{quote.message}</p>}
        {quote?.options && (
          <ul className="mt-3 space-y-1">
            {quote.options.map((o) => (
              <li key={o.id} className="flex justify-between gap-2"><span>{o.name} <span className="text-muted">· {deliveryText(o.minDays, o.maxDays)}</span></span><strong>{o.price === 0 ? "Grátis" : formatBRL(o.price)}</strong></li>
            ))}
          </ul>
        )}
        {!quote && <p className="mt-2 text-xs text-muted">{deliveryText(leadTime.min != null ? leadTime.min + (leadTime.processing ?? 0) : null, leadTime.max != null ? leadTime.max + (leadTime.processing ?? 0) : null)}. Enviado diretamente pelo fornecedor parceiro.</p>}
      </div>
      <p className="flex items-center gap-2 text-xs text-muted"><ShieldCheck size={16} aria-hidden /> Pagamento seguro pelo Mercado Pago. Não armazenamos dados do seu cartão.</p>
    </div>
  );
}
