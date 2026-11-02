"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { isAuthConfigured, supabaseServer } from "@/lib/auth/supabase";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { env } from "@/lib/env";
import { db } from "@/lib/db/client";
import { getCartId } from "@/lib/cart/cart";
import { log } from "@/lib/logger";

export type AuthState = { ok: boolean; message?: string } | null;

const safeNext = (n: unknown) => {
  const s = typeof n === "string" ? n : "";
  return s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\") ? s : "/conta";
};

async function ip() {
  return ((await headers()).get("x-forwarded-for") ?? "local").split(",")[0].trim();
}

const NOT_CONFIGURED = "Autenticação ainda não configurada nesta loja (Supabase).";

const passwordSchema = z
  .string()
  .min(8, "A senha deve ter ao menos 8 caracteres")
  .max(72)
  .regex(/[A-Za-z]/, "Use letras e números")
  .regex(/\d/, "Use letras e números");

export async function signInAction(_: AuthState, form: FormData): Promise<AuthState> {
  if (!isAuthConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  try {
    await enforceRateLimit(`login:${await ip()}`, 10, 600);
    await enforceRateLimit(`login-email:${email}`, 8, 900);
  } catch (e) {
    if (e instanceof RateLimitError) return { ok: false, message: e.message };
    throw e;
  }
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    const msg = error?.code === "email_not_confirmed" ? "Confirme seu e-mail antes de entrar (verifique sua caixa de entrada)." : "E-mail ou senha incorretos.";
    return { ok: false, message: msg };
  }
  const [p] = await db()<{ is_blocked: boolean }[]>`select is_blocked from public.profiles where id = ${data.user.id}`;
  if (p?.is_blocked) {
    await supabase.auth.signOut();
    return { ok: false, message: "Conta bloqueada. Fale com o atendimento." };
  }
  // Vincula o carrinho de visitante à conta
  const cartId = await getCartId();
  if (cartId) await db()`update public.carts set profile_id = ${data.user.id} where id = ${cartId} and profile_id is null and status = 'open'`;
  redirect(safeNext(form.get("next")));
}

const signUpSchema = z.object({
  name: z.string().trim().min(3, "Informe seu nome completo").max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
  password: passwordSchema,
  marketing: z.string().optional(),
  terms: z.literal("on", { message: "Aceite os termos para continuar" }),
});

export async function signUpAction(_: AuthState, form: FormData): Promise<AuthState> {
  if (!isAuthConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const parsed = signUpSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  try {
    await enforceRateLimit(`signup:${await ip()}`, 5, 3600);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  const { name, email, password, marketing } = parsed.data;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: name }, emailRedirectTo: `${env().NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/conta` },
  });
  if (error) {
    await log("warn", "auth", "Falha no cadastro", { code: error.code });
    return { ok: false, message: error.code === "weak_password" ? "Senha muito fraca." : "Não foi possível criar a conta. Verifique os dados ou tente entrar." };
  }
  if (data.user && marketing === "on") {
    await db()`update public.profiles set marketing_consent = true, marketing_consent_at = now() where id = ${data.user.id}`;
  }
  // Resposta igual para e-mail novo ou já cadastrado (não revela contas existentes)
  return { ok: true, message: "Enviamos um link de confirmação para o seu e-mail. Confirme para ativar a conta." };
}

export async function requestPasswordResetAction(_: AuthState, form: FormData): Promise<AuthState> {
  if (!isAuthConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!z.string().email().safeParse(email).success) return { ok: false, message: "E-mail inválido." };
  try {
    await enforceRateLimit(`reset:${await ip()}`, 5, 3600);
    await enforceRateLimit(`reset-email:${email}`, 3, 3600);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${env().NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/redefinir-senha` });
  if (error) await log("warn", "auth", "Falha ao solicitar redefinição", { code: error.code });
  return { ok: true, message: "Se houver uma conta com este e-mail, você receberá um link para redefinir a senha." };
}

export async function updatePasswordAction(_: AuthState, form: FormData): Promise<AuthState> {
  if (!isAuthConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const pw = passwordSchema.safeParse(form.get("password"));
  if (!pw.success) return { ok: false, message: pw.error.issues[0].message };
  if (form.get("password") !== form.get("confirm")) return { ok: false, message: "As senhas não conferem." };
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return { ok: false, message: "Link expirado. Solicite uma nova redefinição de senha." };
  const { error } = await supabase.auth.updateUser({ password: pw.data });
  if (error) return { ok: false, message: error.code === "same_password" ? "A nova senha deve ser diferente da atual." : "Não foi possível alterar a senha." };
  // Encerra outras sessões após troca de senha
  await supabase.auth.signOut({ scope: "others" });
  redirect("/conta?senha=alterada");
}
