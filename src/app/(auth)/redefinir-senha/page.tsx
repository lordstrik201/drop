import type { Metadata } from "next";
import { NewPasswordForm } from "@/components/store/auth-forms";

export const metadata: Metadata = { title: "Nova senha", robots: { index: false } };

export default function NewPasswordPage() {
  return (
    <>
      <h1 className="text-xl font-bold">Criar nova senha</h1>
      <div className="mt-6"><NewPasswordForm /></div>
    </>
  );
}
