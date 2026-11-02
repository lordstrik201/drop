"use client";

import { useActionState } from "react";
import { privacyRequestAction, saveAddressAction, saveProfileAction } from "@/app/(loja)/conta/actions";
import { Alert, Button, Field, Input, Textarea } from "@/components/ui";

type Addr = { id?: string; label?: string | null; recipient_name?: string; phone?: string | null; cep?: string; street?: string; number?: string; complement?: string | null; district?: string; city?: string; state?: string; is_default?: boolean };

export function AddressForm({ a = {} }: { a?: Addr }) {
  const [state, action, pending] = useActionState(saveAddressAction, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-6">
      <input type="hidden" name="id" value={a.id ?? ""} />
      <Field label="Identificação (ex.: Casa)" className="sm:col-span-2"><Input name="label" defaultValue={a.label ?? ""} maxLength={40} /></Field>
      <Field label="Destinatário" className="sm:col-span-4"><Input name="recipient_name" required defaultValue={a.recipient_name} /></Field>
      <Field label="CEP" className="sm:col-span-2"><Input name="cep" required inputMode="numeric" defaultValue={a.cep} /></Field>
      <Field label="Rua" className="sm:col-span-4"><Input name="street" required defaultValue={a.street} /></Field>
      <Field label="Número" className="sm:col-span-2"><Input name="number" required defaultValue={a.number} /></Field>
      <Field label="Complemento" className="sm:col-span-4"><Input name="complement" defaultValue={a.complement ?? ""} /></Field>
      <Field label="Bairro" className="sm:col-span-2"><Input name="district" required defaultValue={a.district} /></Field>
      <Field label="Cidade" className="sm:col-span-3"><Input name="city" required defaultValue={a.city} /></Field>
      <Field label="UF" className="sm:col-span-1"><Input name="state" required maxLength={2} defaultValue={a.state} className="uppercase" /></Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-6"><input type="checkbox" name="is_default" defaultChecked={a.is_default} /> Endereço principal</label>
      {state?.message && <div className="sm:col-span-6"><Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert></div>}
      <Button type="submit" disabled={pending} className="sm:col-span-2">Salvar endereço</Button>
    </form>
  );
}

export function ProfileForm({ p }: { p: { full_name: string | null; phone: string | null; cpf: string | null; birth_date: string | null; marketing_consent: boolean; email: string } }) {
  const [state, action, pending] = useActionState(saveProfileAction, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <Field label="E-mail" hint="Para alterar o e-mail, fale com o atendimento."><Input value={p.email} disabled readOnly /></Field>
      <Field label="Nome completo"><Input name="full_name" required defaultValue={p.full_name ?? ""} /></Field>
      <Field label="Celular"><Input name="phone" defaultValue={p.phone ?? ""} inputMode="tel" /></Field>
      <Field label="CPF"><Input name="cpf" defaultValue={p.cpf ?? ""} inputMode="numeric" /></Field>
      <Field label="Data de nascimento"><Input type="date" name="birth_date" defaultValue={p.birth_date ?? ""} /></Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="marketing" defaultChecked={p.marketing_consent} /> Aceito receber ofertas e novidades por e-mail</label>
      {state?.message && <div className="sm:col-span-2"><Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert></div>}
      <Button type="submit" disabled={pending} className="justify-self-start">Salvar</Button>
    </form>
  );
}

export function PrivacyRequestForm() {
  const [state, action, pending] = useActionState(privacyRequestAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="Tipo de solicitação">
        <select name="kind" className="h-10 rounded-lg border border-line bg-surface px-3 text-sm">
          <option value="correct">Corrigir meus dados</option>
          <option value="revoke_consent">Revogar consentimento de marketing</option>
          <option value="delete">Excluir minha conta e dados pessoais</option>
        </select>
      </Field>
      <Field label="Detalhes (opcional)"><Textarea name="notes" maxLength={1000} /></Field>
      <p className="text-xs text-muted">Dados de pedidos podem ser mantidos pelo prazo exigido pela legislação fiscal e de defesa do consumidor, mesmo após a exclusão da conta.</p>
      {state?.message && <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert>}
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">Enviar solicitação</Button>
    </form>
  );
}
