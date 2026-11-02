import postgres from "postgres";
import { migrate } from "../scripts/migrate";

/**
 * Cria um banco de testes limpo a cada execução e aplica todas as migrations.
 * Requer um PostgreSQL local: TEST_DATABASE_ADMIN_URL (padrão postgres://postgres@127.0.0.1:54329/postgres).
 */
export default async function setup() {
  const admin = process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
  const name = `drop_test_${process.pid}`;
  const sql = postgres(admin, { max: 1, onnotice: () => {} });
  await sql.unsafe(`drop database if exists ${name}`);
  await sql.unsafe(`create database ${name}`);
  await sql.end();
  const url = admin.replace(/\/[^/]*$/, `/${name}`);
  await migrate(url, { localAuthStub: true, log: false });
  process.env.DATABASE_URL = url;
  process.env.DATABASE_SSL = "disable";
  process.env.APP_ENV = "test";
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  return async () => {
    const s = postgres(admin, { max: 1, onnotice: () => {} });
    await s.unsafe(`drop database if exists ${name} with (force)`);
    await s.end();
  };
}
