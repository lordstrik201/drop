"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center px-4 py-20 text-center">
      <h1 className="text-xl font-bold">Algo deu errado</h1>
      <p className="mt-2 text-sm text-muted">Não conseguimos carregar esta página. Tente novamente em instantes.</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-muted">Código: {error.digest}</p>}
      <button onClick={reset} className="mt-6 rounded-lg bg-brand px-5 py-2.5 font-semibold text-brand-contrast">Tentar de novo</button>
    </main>
  );
}
