import { afterAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { closeDb, db } from "@/lib/db/client";
import { loadPermissionMap } from "@/lib/auth/session";
import { hasPermission, type Permission } from "@/lib/auth/rbac";
import { GET as cronGET } from "@/app/api/cron/jobs/route";
import { createAdmin } from "../../scripts/create-admin";

afterAll(closeDb);

describe("segurança", () => {
  it("todas as tabelas públicas têm RLS ativo (inclusive as novas)", async () => {
    const rows = await db()<{ relname: string }[]>`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity and c.relname <> 'schema_migrations'`;
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("matriz de papéis: cada papel só tem o que precisa", async () => {
    const map = await loadPermissionMap();
    const can = (role: "admin" | "manager" | "support" | "operator" | "customer", p: Permission) => hasPermission(map, role, p);
    expect(can("admin", "users.manage")).toBe(true);
    expect(can("manager", "users.manage")).toBe(false);
    expect(can("manager", "integrations.write")).toBe(false);
    expect(can("manager", "finance.read")).toBe(true);
    for (const p of ["finance.read", "orders.refund", "marketing.write", "settings.write", "users.manage"] as Permission[]) {
      expect(can("support", p)).toBe(false);
      expect(can("operator", p)).toBe(false);
    }
    expect(can("operator", "products.write")).toBe(true);
    expect(can("customer", "dashboard.view")).toBe(false);
  });

  it("endpoint de tarefas exige o CRON_SECRET", async () => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "s3cr3t-de-teste-com-tamanho-suficiente";
    expect((await cronGET(new Request("http://x/api/cron/jobs"))).status).toBe(401);
    expect((await cronGET(new Request("http://x/api/cron/jobs", { headers: { authorization: "Bearer errado" } }))).status).toBe(401);
    const ok = await cronGET(new Request("http://x/api/cron/jobs", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
    expect(ok.status).toBe(200);
    delete process.env.CRON_SECRET;
    expect((await cronGET(new Request("http://x/api/cron/jobs", { headers: { authorization: "Bearer " } }))).status).toBe(401);
    process.env.CRON_SECRET = prev;
  });

  it("nenhuma credencial fixa no código-fonte", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = path.join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|sql|json|mjs)$/.test(f)) files.push(p);
      }
    };
    for (const d of ["src", "supabase", "scripts"]) walk(path.join(process.cwd(), d));
    const patterns = [/APP_USR-\d{6,}/, /TEST-\d{10,}-\d{6}/, /re_[A-Za-z0-9]{16,}/, /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{20,}/, /sk_live_[A-Za-z0-9]{10,}/];
    const hits = files.flatMap((f) => patterns.filter((re) => re.test(readFileSync(f, "utf8"))).map((re) => `${f}: ${re}`));
    expect(hits).toEqual([]);
  });

  it("script de criação do administrador promove conta existente e cria nova", async () => {
    const url = process.env.DATABASE_URL!;
    const email = `dono${Date.now()}@example.com`;
    await db()`insert into auth.users (email) values (${email})`;
    const r = await createAdmin(email.toUpperCase(), { databaseUrl: url });
    expect(r).toMatchObject({ previousRole: "customer", created: false, password: null });
    const [p] = await db()`select role from public.profiles where id = ${r.id}`;
    expect(p.role).toBe("admin");

    const novo = `novo${Date.now()}@example.com`;
    await expect(createAdmin(novo, { databaseUrl: url })).rejects.toThrow(/criação indisponível/);
    const created = await createAdmin(novo, {
      databaseUrl: url,
      createUser: async (e) => (await db()`insert into auth.users (email) values (${e}) returning id`)[0].id as string,
    });
    expect(created.created).toBe(true);
    expect(created.password!.length).toBeGreaterThanOrEqual(20);
    await expect(createAdmin("invalido", { databaseUrl: url })).rejects.toThrow(/inválido/);
    const [log] = await db()`select actor_email from public.audit_logs where entity_id = ${created.id} order by id desc limit 1`;
    expect(log.actor_email).toBe("script:create-admin");
  });
});
