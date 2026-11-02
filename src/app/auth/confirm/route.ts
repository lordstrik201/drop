import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { isAuthConfigured, supabaseServer } from "@/lib/auth/supabase";

const TYPES: EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/**
 * Confirmação de e-mail e redefinição de senha (Supabase Auth).
 * Configure os templates de e-mail do Supabase para apontar para
 * {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<tipo>&next=<destino>
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const nextRaw = url.searchParams.get("next") ?? "/conta";
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/conta";
  if (!isAuthConfigured()) return NextResponse.redirect(new URL("/entrar?erro=auth-nao-configurada", request.url));
  const supabase = await supabaseServer();
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  if (tokenHash && type && TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(type === "recovery" ? "/redefinir-senha" : next, request.url));
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }
  return NextResponse.redirect(new URL("/entrar?erro=link-invalido", request.url));
}
