"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordResetAction, signInAction, signUpAction, updatePasswordAction } from "@/app/(auth)/actions";
import { Alert, Button, Field, Input } from "@/components/ui";

export function SignInForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(signInAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next ?? "/conta"} />
      <Field label="E-mail" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
      <Field label="Senha" htmlFor="password"><Input id="password" name="password" type="password" autoComplete="current-password" required /></Field>
      <Link href="/recuperar-senha" className="-mt-2 self-end text-xs text-brand underline">Esqueci minha senha</Link>
      {state?.message && <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert>}
      <Button type="submit" size="lg" disabled={pending}>{pending ? "Entrando…" : "Entrar"}</Button>
    </form>
  );
}

export function SignUpForm() {
  const [state, action, pending] = useActionState(signUpAction, null);
  if (state?.ok) return <Alert tone="success">{state.message}</Alert>;
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Nome completo" htmlFor="name"><Input id="name" name="name" autoComplete="name" required /></Field>
      <Field label="E-mail" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
      <Field label="Senha" htmlFor="password" hint="Mínimo de 8 caracteres, com letras e números."><Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} /></Field>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="terms" required className="mt-1" /> <span>Li e aceito os <Link className="underline" href="/institucional/termos-de-uso" target="_blank">termos de uso</Link> e a <Link className="underline" href="/institucional/politica-de-privacidade" target="_blank">política de privacidade</Link>.</span></label>
      <label className="flex items-start gap-2 text-sm text-muted"><input type="checkbox" name="marketing" className="mt-1" /> <span>Quero receber ofertas por e-mail (opcional; você pode cancelar quando quiser).</span></label>
      {state?.message && <Alert tone="danger">{state.message}</Alert>}
      <Button type="submit" size="lg" disabled={pending}>{pending ? "Criando…" : "Criar conta"}</Button>
    </form>
  );
}

export function ResetRequestForm() {
  const [state, action, pending] = useActionState(requestPasswordResetAction, null);
  if (state?.ok) return <Alert tone="success">{state.message}</Alert>;
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="E-mail da conta" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
      {state?.message && <Alert tone="danger">{state.message}</Alert>}
      <Button type="submit" size="lg" disabled={pending}>Enviar link</Button>
    </form>
  );
}

export function NewPasswordForm() {
  const [state, action, pending] = useActionState(updatePasswordAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Nova senha" htmlFor="password" hint="Mínimo de 8 caracteres, com letras e números."><Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} /></Field>
      <Field label="Confirme a nova senha" htmlFor="confirm"><Input id="confirm" name="confirm" type="password" autoComplete="new-password" required /></Field>
      {state?.message && <Alert tone="danger">{state.message}</Alert>}
      <Button type="submit" size="lg" disabled={pending}>Salvar nova senha</Button>
    </form>
  );
}
