"use client";

import { useActionState } from "react";
import { applyCouponAction } from "@/app/(loja)/actions";
import { Button, inputClass } from "@/components/ui";

export function CouponForm({ current }: { current: string | null }) {
  const [state, action, pending] = useActionState(applyCouponAction, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <label htmlFor="coupon" className="text-sm font-medium">Cupom de desconto</label>
      <div className="flex gap-2">
        <input id="coupon" name="code" defaultValue={current ?? ""} placeholder="CÓDIGO" className={`${inputClass} uppercase`} maxLength={40} />
        <Button type="submit" variant="secondary" disabled={pending}>{current ? "Alterar" : "Aplicar"}</Button>
      </div>
      {current && <button type="submit" name="code" value="" className="self-start text-xs text-muted underline">Remover cupom</button>}
      {state?.message && <p className={`text-xs ${state.ok ? "text-success" : "text-danger"}`} role="status">{state.message}</p>}
    </form>
  );
}
