import type { Metadata } from "next";
import Link from "next/link";
import { SignUpForm } from "@/components/store/auth-forms";

export const metadata: Metadata = { title: "Criar conta", robots: { index: false } };

export default function SignUpPage() {
  return (
    <>
      <h1 className="text-xl font-bold">Criar conta</h1>
      <div className="mt-6"><SignUpForm /></div>
      <p className="mt-6 text-center text-sm">Já tem conta? <Link href="/entrar" className="font-semibold text-brand underline">Entrar</Link></p>
    </>
  );
}
