import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function isAuthConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export class AuthNotConfiguredError extends Error {
  constructor() {
    super(
      "Autenticação não configurada: defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY (Supabase → Project Settings → API).",
    );
  }
}

/** Cliente Supabase do lado do servidor, com sessão em cookies httpOnly. */
export async function supabaseServer() {
  if (!isAuthConfigured()) throw new AuthNotConfiguredError();
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Chamado a partir de Server Component: o proxy já renova a sessão.
        }
      },
    },
  });
}
