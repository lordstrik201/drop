"use client";

import { useActionState } from "react";
import { contactAction } from "@/app/(loja)/actions";
import { Alert, Button, Field, Input, Textarea } from "@/components/ui";

export function ContactForm() {
  const [state, action, pending] = useActionState(contactAction, null);
  if (state?.ok) return <Alert tone="success">{state.message}</Alert>;
  const e = state?.errors ?? {};
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <Field label="Nome" error={e.name}><Input name="name" required autoComplete="name" /></Field>
      <Field label="E-mail" error={e.email}><Input name="email" type="email" required autoComplete="email" /></Field>
      <Field label="Telefone (opcional)"><Input name="phone" type="tel" /></Field>
      <Field label="Nº do pedido (opcional)" error={e.orderNumber}><Input name="orderNumber" inputMode="numeric" /></Field>
      <Field label="Assunto" error={e.subject} className="sm:col-span-2"><Input name="subject" required /></Field>
      <Field label="Mensagem" error={e.message} className="sm:col-span-2"><Textarea name="message" required rows={6} /></Field>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      {state?.message && <div className="sm:col-span-2"><Alert tone="danger">{state.message}</Alert></div>}
      <Button type="submit" disabled={pending} className="justify-self-start">Enviar mensagem</Button>
    </form>
  );
}
