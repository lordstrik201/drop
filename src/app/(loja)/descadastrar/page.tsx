import { redirect } from "next/navigation";
import { unsubscribe, verifyToken } from "@/lib/marketing/abandoned";

export const metadata = { title: "Descadastrar", robots: { index: false } };

async function confirm(f: FormData) {
  "use server";
  const t = String(f.get("t") ?? "");
  try {
    await unsubscribe(t);
  } catch {
    redirect("/descadastrar?erro=1");
  }
  redirect("/descadastrar?ok=1");
}

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ t?: string; ok?: string; erro?: string }> }) {
  const sp = await searchParams;
  const valid = !!verifyToken("unsub", sp.t);
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="text-2xl font-bold">Comunicações por e-mail</h1>
      {sp.ok ? (
        <p className="mt-4 text-muted">Pronto. Você não receberá mais e-mails de ofertas e lembretes. E-mails sobre seus pedidos continuam chegando normalmente.</p>
      ) : sp.erro || !valid ? (
        <p className="mt-4 text-muted">Link inválido ou incompleto. Você também pode desativar as comunicações em Minha conta → Meus dados.</p>
      ) : (
        <form action={confirm} className="mt-6">
          <input type="hidden" name="t" value={sp.t} />
          <p className="mb-4 text-muted">Confirme para deixar de receber ofertas e lembretes por e-mail.</p>
          <button className="rounded-lg bg-ink px-4 py-2 font-semibold text-white">Não quero mais receber</button>
        </form>
      )}
    </div>
  );
}
