"use client";

import Link from "next/link";
import { useActionState, useMemo, useState, useTransition } from "react";
import { Lock } from "lucide-react";
import { placeOrderAction, quoteShippingAction } from "@/app/(loja)/actions";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import type { ShippingOption } from "@/lib/shipping/quote";
import { deliveryText } from "./buy-box";

type Addr = { id: string; recipient_name: string; cep: string; street: string; number: string; complement: string | null; district: string; city: string; state: string; is_default: boolean };
type Line = { id: string; name: string; variant: string; qty: number; total: number; image: string | null };

const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");

export function CheckoutForm(props: {
  loggedIn: boolean; requireCpf: boolean;
  profile: { full_name: string | null; email: string; phone: string | null; cpf: string | null } | null;
  addresses: Addr[]; lines: Line[]; subtotal: number; discount: number; couponCode: string | null; freeShippingCoupon: boolean;
}) {
  const def = props.addresses[0];
  const [idem] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`));
  const [c, setC] = useState({
    name: props.profile?.full_name ?? "", email: props.profile?.email ?? "", phone: props.profile?.phone ?? "", cpf: props.profile?.cpf ?? "",
  });
  const [a, setA] = useState({
    recipient_name: def?.recipient_name ?? props.profile?.full_name ?? "", cep: def?.cep ?? "", street: def?.street ?? "", number: def?.number ?? "",
    complement: def?.complement ?? "", district: def?.district ?? "", city: def?.city ?? "", state: def?.state ?? "",
  });
  const [options, setOptions] = useState<ShippingOption[] | null>(null);
  const [shipId, setShipId] = useState<string | null>(null);
  const [shipMsg, setShipMsg] = useState<string | null>(null);
  const [quoting, startQuote] = useTransition();
  const [accepted, setAccepted] = useState(false);
  const [state, action, pending] = useActionState(placeOrderAction, null);
  const err = (k: string) => state?.errors?.[k];

  const chosen = options?.find((o) => o.id === shipId) ?? null;
  const shipping = props.freeShippingCoupon ? 0 : chosen?.price ?? 0;
  const total = props.subtotal - props.discount + shipping;

  async function lookupCep(cep: string) {
    const digits = cep.replace(/\D/g, "");
    if (digits.length !== 8) return;
    try {
      const r = await fetch(`/api/cep/${digits}`);
      if (r.ok) {
        const d = await r.json();
        setA((x) => ({ ...x, cep: digits, street: d.street || x.street, district: d.district || x.district, city: d.city || x.city, state: d.state || x.state }));
      }
    } catch { /* preenchimento manual continua possível */ }
    startQuote(async () => {
      const q = await quoteShippingAction(digits);
      if (q.ok && q.options) { setOptions(q.options); setShipId(q.options[0]?.id ?? null); setShipMsg(q.options.length ? null : "Nenhuma opção de entrega disponível para este CEP."); }
      else { setOptions(null); setShipId(null); setShipMsg(q.message ?? "Não foi possível calcular o frete."); }
    });
  }

  const payload = useMemo(() => JSON.stringify({ idempotencyKey: idem, ...c, address: a, shippingOptionId: shipId ?? "" }), [idem, c, a, shipId]);

  return (
    <form action={action} className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <input type="hidden" name="payload" value={payload} />
      <div className="flex flex-col gap-6">
        <section className="rounded-2xl border border-line bg-surface p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">1. Seus dados</h2>
            {!props.loggedIn && <Link href="/entrar?next=/checkout" className="text-sm font-semibold text-brand underline">Já tenho conta</Link>}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Nome completo" htmlFor="name" error={err("name")} className="sm:col-span-2"><Input id="name" autoComplete="name" required value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field>
            <Field label="E-mail" htmlFor="email" error={err("email")}><Input id="email" type="email" autoComplete="email" required value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></Field>
            <Field label="Celular" htmlFor="phone" error={err("phone")}><Input id="phone" type="tel" autoComplete="tel" inputMode="tel" required placeholder="(11) 90000-0000" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} /></Field>
            <Field label={props.requireCpf ? "CPF" : "CPF (opcional)"} htmlFor="cpf" error={err("cpf")} hint="Necessário para emissão da nota fiscal e envio."><Input id="cpf" inputMode="numeric" required={props.requireCpf} placeholder="000.000.000-00" value={c.cpf} onChange={(e) => setC({ ...c, cpf: e.target.value })} /></Field>
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-lg font-bold">2. Endereço de entrega</h2>
          {props.addresses.length > 0 && (
            <div className="mt-3">
              <Field label="Endereços salvos" htmlFor="saved">
                <Select id="saved" defaultValue={def?.id} onChange={(e) => { const s = props.addresses.find((x) => x.id === e.target.value); if (s) { setA({ ...s, complement: s.complement ?? "" }); lookupCep(s.cep); } }}>
                  {props.addresses.map((x) => <option key={x.id} value={x.id}>{x.street}, {x.number} — {x.city}/{x.state}</option>)}
                </Select>
              </Field>
            </div>
          )}
          <div className="mt-4 grid gap-3 sm:grid-cols-6">
            <Field label="CEP" htmlFor="cep" error={err("address.cep")} className="sm:col-span-2">
              <Input id="cep" inputMode="numeric" autoComplete="postal-code" required placeholder="00000-000" value={a.cep} onChange={(e) => setA({ ...a, cep: e.target.value })} onBlur={(e) => lookupCep(e.target.value)} />
            </Field>
            <Field label="Destinatário" htmlFor="rn" error={err("address.recipient_name")} className="sm:col-span-4"><Input id="rn" required value={a.recipient_name} onChange={(e) => setA({ ...a, recipient_name: e.target.value })} /></Field>
            <Field label="Rua" htmlFor="street" error={err("address.street")} className="sm:col-span-4"><Input id="street" autoComplete="address-line1" required value={a.street} onChange={(e) => setA({ ...a, street: e.target.value })} /></Field>
            <Field label="Número" htmlFor="number" error={err("address.number")} className="sm:col-span-2"><Input id="number" required value={a.number} onChange={(e) => setA({ ...a, number: e.target.value })} /></Field>
            <Field label="Complemento" htmlFor="compl" className="sm:col-span-3"><Input id="compl" autoComplete="address-line2" value={a.complement} onChange={(e) => setA({ ...a, complement: e.target.value })} /></Field>
            <Field label="Bairro" htmlFor="district" error={err("address.district")} className="sm:col-span-3"><Input id="district" required value={a.district} onChange={(e) => setA({ ...a, district: e.target.value })} /></Field>
            <Field label="Cidade" htmlFor="city" error={err("address.city")} className="sm:col-span-4"><Input id="city" autoComplete="address-level2" required value={a.city} onChange={(e) => setA({ ...a, city: e.target.value })} /></Field>
            <Field label="UF" htmlFor="uf" error={err("address.state")} className="sm:col-span-2">
              <Select id="uf" required value={a.state} onChange={(e) => setA({ ...a, state: e.target.value })}><option value="">—</option>{UFS.map((u) => <option key={u}>{u}</option>)}</Select>
            </Field>
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-lg font-bold">3. Entrega</h2>
          {quoting && <p className="mt-3 text-sm text-muted">Calculando frete…</p>}
          {!quoting && !options && !shipMsg && <p className="mt-3 text-sm text-muted">Informe o CEP para ver as opções de entrega.</p>}
          {shipMsg && <div className="mt-3"><Alert tone="warning">{shipMsg}</Alert></div>}
          {options && (
            <ul className="mt-3 flex flex-col gap-2">
              {options.map((o) => (
                <li key={o.id}>
                  <label className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 text-sm ${shipId === o.id ? "border-brand bg-brand/5" : "border-line"}`}>
                    <span className="flex items-center gap-3"><input type="radio" name="ship" checked={shipId === o.id} onChange={() => setShipId(o.id)} /><span><span className="font-semibold">{o.name}</span><span className="block text-xs text-muted">{deliveryText(o.minDays, o.maxDays)}</span></span></span>
                    <strong>{o.price === 0 || props.freeShippingCoupon ? "Grátis" : formatBRL(o.price)}</strong>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">Os produtos são enviados diretamente pelos nossos fornecedores parceiros. O prazo é uma estimativa e começa a contar após a confirmação do pagamento.</p>
        </section>
      </div>

      <aside className="h-fit rounded-2xl border border-line bg-surface p-5 lg:sticky lg:top-28">
        <h2 className="text-lg font-bold">Resumo do pedido</h2>
        <ul className="mt-3 max-h-64 divide-y divide-line overflow-y-auto text-sm">
          {props.lines.map((l) => (
            <li key={l.id} className="flex justify-between gap-3 py-2"><span>{l.qty}× {l.name}{l.variant !== "Padrão" ? ` (${l.variant})` : ""}</span><span className="shrink-0">{formatBRL(l.total)}</span></li>
          ))}
        </ul>
        <dl className="mt-3 space-y-2 border-t border-line pt-3 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatBRL(props.subtotal)}</dd></div>
          {props.discount > 0 && <div className="flex justify-between text-success"><dt>Desconto {props.couponCode}</dt><dd>-{formatBRL(props.discount)}</dd></div>}
          <div className="flex justify-between"><dt>Frete</dt><dd>{chosen || props.freeShippingCoupon ? (shipping === 0 ? "Grátis" : formatBRL(shipping)) : "—"}</dd></div>
          <div className="flex justify-between border-t border-line pt-3 text-lg font-bold"><dt>Total</dt><dd>{formatBRL(total)}</dd></div>
        </dl>
        <label className="mt-4 flex items-start gap-2 text-xs text-muted">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} required className="mt-0.5" />
          <span>Li e aceito os <Link href="/institucional/termos-de-uso" target="_blank" className="underline">termos de uso</Link>, a <Link href="/institucional/politica-de-privacidade" target="_blank" className="underline">política de privacidade</Link> e a <Link href="/institucional/trocas-e-devolucoes" target="_blank" className="underline">política de trocas</Link>.</span>
        </label>
        {state?.message && <div className="mt-3"><Alert tone="danger">{state.message}</Alert></div>}
        <Button type="submit" size="lg" variant="accent" className="mt-4 w-full" disabled={pending || !shipId || !accepted}>
          <Lock size={16} aria-hidden /> {pending ? "Processando…" : "Ir para o pagamento"}
        </Button>
        <p className="mt-3 text-center text-xs text-muted">Você será direcionado ao ambiente seguro do Mercado Pago para pagar com Pix, cartão de crédito ou débito.</p>
      </aside>
    </form>
  );
}
