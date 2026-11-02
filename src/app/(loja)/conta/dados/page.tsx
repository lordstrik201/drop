import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { PrivacyRequestForm, ProfileForm } from "@/components/store/account-forms";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "Dados e privacidade", robots: { index: false } };

export default async function ProfilePage() {
  const user = await requireUser("/conta/dados");
  const [p] = await db()`select email, full_name, phone, cpf, birth_date::text, marketing_consent from public.profiles where id = ${user.id}`;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Dados e privacidade</h1>
      <Card className="p-5"><h2 className="mb-4 font-bold">Dados pessoais</h2><ProfileForm p={p as never} /></Card>
      <Card className="p-5">
        <h2 className="font-bold">Senha</h2>
        <p className="mt-1 text-sm text-muted">Para trocar a senha, enviaremos um link para o seu e-mail.</p>
        <Link href="/recuperar-senha" className="mt-3 inline-block text-sm font-semibold text-brand underline">Alterar senha</Link>
      </Card>
      <Card className="p-5">
        <h2 className="font-bold">Seus direitos (LGPD)</h2>
        <p className="mt-1 text-sm text-muted">Você pode baixar uma cópia dos seus dados ou fazer outras solicitações sobre seus dados pessoais.</p>
        <a href="/api/conta/exportar" className="mt-3 inline-block text-sm font-semibold text-brand underline">Baixar meus dados (JSON)</a>
        <div className="mt-5"><PrivacyRequestForm /></div>
      </Card>
    </div>
  );
}
