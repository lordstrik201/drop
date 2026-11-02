"use client";

import { useActionState } from "react";
import { trackOrderAction } from "@/app/(loja)/actions";
import { Alert, Button, Field, Input } from "@/components/ui";

export function TrackForm() {
  const [state, action, pending] = useActionState(trackOrderAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Número do pedido"><Input name="number" required inputMode="numeric" placeholder="100001" /></Field>
      <Field label="E-mail"><Input name="email" type="email" required autoComplete="email" /></Field>
      {state?.message && <Alert tone="danger">{state.message}</Alert>}
      <Button type="submit" disabled={pending}>Consultar</Button>
    </form>
  );
}
