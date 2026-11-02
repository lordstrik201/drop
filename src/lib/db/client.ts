import postgres from "postgres";
import { env } from "@/lib/env";

/**
 * Conexão direta com o PostgreSQL (Supabase).
 *
 * Decisão (docs/DECISOES.md#acesso-a-dados): o servidor acessa o banco por
 * conexão direta com consultas parametrizadas (tagged templates do postgres.js),
 * o que dá transações reais para pagamentos, pedidos e estoque. Toda consulta
 * usa parâmetros; nunca concatenamos SQL com entrada do usuário.
 */
type Sql = postgres.Sql<Record<string, never>>;

const globalForDb = globalThis as unknown as { __dropSql?: Sql };

export function db(): Sql {
  if (globalForDb.__dropSql) return globalForDb.__dropSql;
  const e = env();
  const sql = postgres(e.DATABASE_URL, {
    ssl: e.DATABASE_SSL === "disable" ? false : e.DATABASE_SSL,
    max: e.APP_ENV === "production" ? 5 : 3,
    idle_timeout: 20,
    // O pooler do Supabase em modo "transaction" não suporta prepared statements.
    prepare: false,
    onnotice: () => {},
    connection: { application_name: "drop-app", TimeZone: "UTC" },
    transform: { undefined: null },
  });
  globalForDb.__dropSql = sql;
  return sql;
}

export type Tx = postgres.TransactionSql<Record<string, never>>;
export type DbOrTx = Sql | Tx;

export async function closeDb() {
  if (globalForDb.__dropSql) {
    await globalForDb.__dropSql.end({ timeout: 5 });
    globalForDb.__dropSql = undefined;
  }
}
