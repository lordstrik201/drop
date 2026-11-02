import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center px-4 py-20 text-center">
      <p className="text-5xl font-extrabold text-brand">404</p>
      <h1 className="mt-3 text-xl font-bold">Página não encontrada</h1>
      <p className="mt-2 text-sm text-muted">O endereço pode ter mudado ou o produto não está mais disponível.</p>
      <Link href="/" className="mt-6 rounded-lg bg-brand px-5 py-2.5 font-semibold text-brand-contrast">Voltar à loja</Link>
    </main>
  );
}
