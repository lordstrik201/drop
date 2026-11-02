"use client";

import { useActionState } from "react";
import { reviewAction } from "@/app/(loja)/actions";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";

export function ReviewForm({ productId }: { productId: string }) {
  const [state, action, pending] = useActionState(reviewAction, null);
  if (state?.ok) return <Alert tone="success">{state.message}</Alert>;
  return (
    <details>
      <summary className="cursor-pointer text-sm font-semibold text-brand">Escrever uma avaliação</summary>
      <form action={action} className="mt-3 grid max-w-xl gap-3">
        <input type="hidden" name="productId" value={productId} />
        <Field label="Nota" htmlFor="rating">
          <Select id="rating" name="rating" defaultValue="5">{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} estrela{n > 1 ? "s" : ""}</option>)}</Select>
        </Field>
        <Field label="Título (opcional)" htmlFor="title"><Input id="title" name="title" maxLength={120} /></Field>
        <Field label="Comentário" htmlFor="body"><Textarea id="body" name="body" required minLength={10} maxLength={4000} /></Field>
        {state?.message && <Alert tone="danger">{state.message}</Alert>}
        <Button type="submit" disabled={pending} className="justify-self-start">Enviar avaliação</Button>
      </form>
    </details>
  );
}
