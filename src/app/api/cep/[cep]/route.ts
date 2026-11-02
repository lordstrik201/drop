import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/security/rate-limit";

/**
 * Consulta de CEP via ViaCEP (serviço público e gratuito: https://viacep.com.br).
 * GET https://viacep.com.br/ws/{cep}/json/ → { logradouro, bairro, localidade, uf, erro? }
 */
export async function GET(request: Request, { params }: { params: Promise<{ cep: string }> }) {
  const cep = (await params).cep.replace(/\D/g, "");
  if (cep.length !== 8) return NextResponse.json({ error: "CEP inválido" }, { status: 400 });
  const ip = (request.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (!(await rateLimit(`cep:${ip}`, 30, 60)).allowed) return NextResponse.json({ error: "Muitas consultas" }, { status: 429 });
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    clearTimeout(t);
    if (!res.ok) return NextResponse.json({ error: "Serviço de CEP indisponível" }, { status: 502 });
    const d = (await res.json()) as { erro?: boolean | string; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
    if (d.erro) return NextResponse.json({ error: "CEP não encontrado" }, { status: 404 });
    return NextResponse.json(
      { cep, street: d.logradouro ?? "", district: d.bairro ?? "", city: d.localidade ?? "", state: d.uf ?? "" },
      { headers: { "Cache-Control": "public, max-age=86400" } },
    );
  } catch {
    return NextResponse.json({ error: "Serviço de CEP indisponível; preencha o endereço manualmente." }, { status: 502 });
  }
}
