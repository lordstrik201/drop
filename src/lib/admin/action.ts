import "server-only";
import { redirect, unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { log } from "@/lib/logger";
import { ForbiddenError } from "@/lib/auth/rbac";

/**
 * Executa uma ação do painel e volta para a página com mensagem de sucesso ou
 * erro na URL (?ok=… / ?erro=…). Erros nunca são escondidos: aparecem na tela e
 * vão para o log técnico.
 */
export async function runAdmin(back: string, fn: () => Promise<string | void>): Promise<never> {
  let msg: string | void;
  try {
    msg = await fn();
  } catch (e) {
    unstable_rethrow(e);
    const text = e instanceof ZodError ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : (e as Error).message;
    if (!(e instanceof ForbiddenError)) await log("warn", "admin", `Ação falhou em ${back}`, { error: text });
    redirect(withParam(back, "erro", text.slice(0, 300)));
  }
  redirect(withParam(back, "ok", msg || "Alterações salvas."));
}

function withParam(url: string, key: string, value: string) {
  const [base, hash] = url.split("#");
  const [path, q = ""] = base.split("?");
  const p = new URLSearchParams(q);
  p.delete("ok");
  p.delete("erro");
  p.set(key, value);
  return `${path}?${p}${hash ? `#${hash}` : ""}`;
}

export const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
export const optStr = (f: FormData, k: string) => str(f, k) || null;
