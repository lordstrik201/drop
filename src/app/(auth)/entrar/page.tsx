import type { Metadata } from "next";
import Link from "next/link";
import { SignInForm } from "@/components/store/auth-forms";
import { Alert } from "@/components/ui";
import { isAuthConfigured } from "@/lib/auth/supabase";

export const metadata: Metadata = { title: "Entrar", robots: { index: false } };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; erro?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <h1 className="text-xl font-bold">Entrar na sua conta</h1>
      <p className="mt-1 text-sm text-muted">Acompanhe pedidos e compre mais rápido.</p>
      <div className="mt-6 flex flex-col gap-4">
        {(!isAuthConfigured() || sp.erro === "auth-nao-configurada") && <Alert tone="warning">Login indisponível: a autenticação (Supabase) ainda não foi configurada.</Alert>}
        {sp.erro === "link-invalido" && <Alert tone="danger">Link inválido ou expirado. Tente novamente.</Alert>}
        <SignInForm next={sp.next} />
      </div>
      <p className="mt-6 text-center text-sm">Novo por aqui? <Link href={`/cadastrar${sp.next ? `?next=${encodeURIComponent(sp.next)}` : ""}`} className="font-semibold text-brand underline">Criar conta</Link></p>
    </>
  );
}
