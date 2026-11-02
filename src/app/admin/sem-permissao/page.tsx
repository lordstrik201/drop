import Link from "next/link";

export default function NoPermission() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <h1 className="text-xl font-bold">Sem permissão</h1>
      <p className="mt-2 text-sm text-muted">Sua função não tem acesso a esta área. Peça a um administrador para ajustar suas permissões.</p>
      <Link href="/admin" className="mt-6 inline-block text-brand underline">Voltar ao dashboard</Link>
    </div>
  );
}
