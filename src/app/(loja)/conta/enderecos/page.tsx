import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { AddressForm } from "@/components/store/account-forms";
import { deleteAddressAction } from "../actions";
import { Badge, Card } from "@/components/ui";
import { formatCEP } from "@/lib/validation/br";

export const metadata: Metadata = { title: "Endereços", robots: { index: false } };

export default async function AddressesPage() {
  const user = await requireUser("/conta/enderecos");
  const list = await db()`select * from public.addresses where profile_id = ${user.id} order by is_default desc, created_at desc`;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Endereços</h1>
      {list.map((a) => (
        <Card key={a.id} className="p-5">
          <details>
            <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm">
              <span><strong>{a.label || a.recipient_name}</strong> {a.is_default && <Badge tone="brand">Principal</Badge>}<br />{a.street}, {a.number} — {a.district}, {a.city}/{a.state} · {formatCEP(a.cep)}</span>
              <span className="text-brand underline">Editar</span>
            </summary>
            <div className="mt-4"><AddressForm a={a} /></div>
            <form action={deleteAddressAction} className="mt-3"><input type="hidden" name="id" value={a.id} /><button className="text-sm text-danger underline">Excluir endereço</button></form>
          </details>
        </Card>
      ))}
      <Card className="p-5">
        <h2 className="mb-4 font-bold">Novo endereço</h2>
        <AddressForm />
      </Card>
    </div>
  );
}
