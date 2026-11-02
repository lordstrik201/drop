/**
 * Cria (ou promove) o primeiro administrador da loja.
 *
 * Uso:
 *   npm run db:create-admin -- --email voce@empresa.com.br
 *
 * - Se a conta já existe (cadastrada pela loja ou pelo painel do Supabase), só
 *   muda o papel para "admin".
 * - Se não existe, cria pelo Auth Admin do Supabase (auth.admin.createUser) com
 *   e-mail confirmado e uma senha aleatória forte, exibida UMA vez no terminal.
 *   Troque a senha no primeiro acesso (Minha conta → Senha) ou use "Esqueci a senha".
 *
 * Requer DATABASE_URL e, para criar contas, NEXT_PUBLIC_SUPABASE_URL e
 * SUPABASE_SERVICE_ROLE_KEY (somente no seu computador/servidor; nunca no navegador).
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import path from "node:path";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

export async function createAdmin(email: string, opts: { databaseUrl: string; createUser?: (email: string, password: string) => Promise<string> }) {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("E-mail inválido.");
  const url = opts.databaseUrl;
  const ssl = process.env.DATABASE_SSL === "disable" || url.includes("127.0.0.1") || url.includes("localhost") ? false : "require";
  const sql = postgres(url, { ssl, max: 1, prepare: false, onnotice: () => {} });
  try {
    let [p] = await sql<{ id: string; role: string }[]>`select id, role from public.profiles where lower(email) = ${normalized}`;
    let password: string | null = null;
    if (!p) {
      if (!opts.createUser) throw new Error("Conta não encontrada e criação indisponível: configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
      password = randomBytes(18).toString("base64url");
      const id = await opts.createUser(normalized, password);
      // o perfil é criado pelo gatilho de auth.users (migration de schema)
      [p] = await sql<{ id: string; role: string }[]>`select id, role from public.profiles where id = ${id}`;
      if (!p) throw new Error("Conta criada, mas o perfil não apareceu. Confira se as migrations foram aplicadas.");
    }
    await sql`update public.profiles set role = 'admin', is_blocked = false where id = ${p.id}`;
    await sql`insert into public.audit_logs (actor_id, actor_email, action, entity, entity_id, after)
              values (null, 'script:create-admin', 'user.role_change', 'profile', ${p.id}, ${sql.json({ role: "admin", via: "scripts/create-admin" })})`;
    return { id: p.id, previousRole: p.role, created: password !== null, password };
  } finally {
    await sql.end();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const email = arg("email");
  const databaseUrl = process.env.DATABASE_URL;
  if (!email || !databaseUrl) {
    console.error("Uso: DATABASE_URL=... npm run db:create-admin -- --email voce@empresa.com.br");
    process.exit(1);
  }
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const createUser = supaUrl && key
    ? async (e: string, password: string) => {
        const admin = createClient(supaUrl, key, { auth: { persistSession: false, autoRefreshToken: false } }).auth.admin;
        const { data, error } = await admin.createUser({ email: e, password, email_confirm: true });
        if (error || !data.user) throw new Error(`Supabase Auth: ${error?.message ?? "sem usuário"}`);
        return data.user.id;
      }
    : undefined;
  createAdmin(email, { databaseUrl, createUser })
    .then((r) => {
      console.log(`✓ ${email} agora é administrador (antes: ${r.previousRole}).`);
      if (r.password) console.log(`Senha temporária (anote agora; não será exibida de novo): ${r.password}`);
    })
    .catch((e) => {
      console.error(`✗ ${(e as Error).message}`);
      process.exit(1);
    });
}
