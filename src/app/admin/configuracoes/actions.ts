"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth/session";
import { runAdmin, str } from "@/lib/admin/action";
import { audit } from "@/lib/audit";
import { readSetting, saveSetting, type SettingsMap } from "@/lib/settings";
import { SETTING_FORMS, parseSettingForm } from "@/lib/settings/forms";

export async function saveSettingAction(f: FormData) {
  const key = str(f, "settingKey");
  return runAdmin(`/admin/configuracoes#${key}`, async () => {
    const u = await assertPermission("settings.write");
    const form = SETTING_FORMS.find((x) => x.key === key);
    if (!form) throw new Error("Configuração desconhecida.");
    const before = (await readSetting(form.key)) as unknown as Record<string, unknown>;
    const value = parseSettingForm(form, f, before);
    await saveSetting(form.key, value as unknown as SettingsMap[typeof form.key], u.id);
    await audit(u, "settings.update", "settings", key, { before, after: value });
    revalidatePath("/", "layout");
    return `${form.title}: salvo.`;
  });
}
