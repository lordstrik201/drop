import type { Metadata } from "next";
import Link from "next/link";
import { ResetRequestForm } from "@/components/store/auth-forms";

export const metadata: Metadata = { title: "Recuperar senha", robots: { index: false } };

export default function ResetPage() {
  return (
    <>
      <h1 className="text-xl font-bold">Recuperar senha</h1>
      <p className="mt-1 text-sm text-muted">Enviaremos um link para você criar uma nova senha.</p>
      <div className="mt-6"><ResetRequestForm /></div>
      <p className="mt-6 text-center text-sm"><Link href="/entrar" className="text-brand underline">Voltar ao login</Link></p>
    </>
  );
}
