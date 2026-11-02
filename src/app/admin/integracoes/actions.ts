"use server";

import { assertPermission } from "@/lib/auth/session";
import { runAdmin, str } from "@/lib/admin/action";
import { audit } from "@/lib/audit";
import { saveCredentials } from "@/lib/integrations/credentials";
import { testIntegration } from "@/lib/integrations/health";
import { PROVIDER_FIELDS } from "./fields";

const BACK = "/admin/integracoes";

function provider(f: FormData): keyof typeof PROVIDER_FIELDS {
  const p = str(f, "provider");
  if (!(p in PROVIDER_FIELDS)) throw new Error("Integração desconhecida.");
  return p as keyof typeof PROVIDER_FIELDS;
}

export async function saveCredentialsAction(f: FormData) {
  return runAdmin(BACK, async () => {
    const u = await assertPermission("integrations.write");
    const p = provider(f);
    const values: Record<string, string> = {};
    for (const field of PROVIDER_FIELDS[p]) {
      const v = str(f, field.key);
      if (v) values[field.key] = v;
    }
    if (!Object.keys(values).length) throw new Error("Nenhum valor informado (campos vazios mantêm o valor atual).");
    await saveCredentials(p, values, u.id);
    // nunca grava os valores na auditoria, só quais campos mudaram
    await audit(u, "integration.credentials_update", "integration", p, { after: { fields: Object.keys(values) } });
    return "Credenciais salvas (cifradas). Use “Testar conexão” para validar.";
  });
}

export async function testIntegrationAction(f: FormData) {
  return runAdmin(BACK, async () => {
    const u = await assertPermission("integrations.write");
    const p = provider(f);
    const r = await testIntegration(p, { staffEmail: u.email });
    await audit(u, "integration.test", "integration", p, { after: r });
    if (!r.ok) throw new Error(r.message);
    return r.message;
  });
}
