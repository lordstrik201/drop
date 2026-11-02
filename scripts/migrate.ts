/**
 * Aplica as migrations de supabase/migrations em ordem, uma única vez cada.
 *
 * Uso: DATABASE_URL=... npx tsx scripts/migrate.ts
 * Em projetos Supabase, também é possível usar `supabase db push`.
 * Com --local-auth-stub cria um schema "auth" mínimo (apenas para testes locais,
 * fora do Supabase).
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import "dotenv/config";

export async function migrate(url: string, opts: { localAuthStub?: boolean; log?: boolean } = {}) {
  const ssl = process.env.DATABASE_SSL === "disable" || url.includes("127.0.0.1") || url.includes("localhost") ? false : "require";
  const sql = postgres(url, { ssl, max: 1, onnotice: () => {}, prepare: false });
  try {
    if (opts.localAuthStub) await sql.unsafe(await readFile(path.join(process.cwd(), "scripts/sql/local-auth-stub.sql"), "utf8"));
    await sql`create table if not exists public.schema_migrations (version text primary key, applied_at timestamptz not null default now())`;
    const dir = path.join(process.cwd(), "supabase/migrations");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const applied = new Set((await sql<{ version: string }[]>`select version from public.schema_migrations`).map((r) => r.version));
    for (const file of files) {
      const version = file.split("_")[0];
      if (applied.has(version)) continue;
      const body = await readFile(path.join(dir, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into public.schema_migrations (version) values (${version})`;
      });
      if (opts.log !== false) console.log(`✓ ${file}`);
    }
  } finally {
    await sql.end();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Defina DATABASE_URL");
    process.exit(1);
  }
  migrate(url, { localAuthStub: process.argv.includes("--local-auth-stub") })
    .then(() => console.log("Migrations aplicadas."))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
