import { requireStaffPage } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { Button, inputClass } from "@/components/ui";
import { Flash } from "@/components/admin/ui";
import { SETTING_FORMS, type SettingField } from "@/lib/settings/forms";
import { formatCEP } from "@/lib/validation/br";
import { saveSettingAction } from "./actions";

export const metadata = { title: "Configurações" };

function money(c: unknown) {
  return typeof c === "number" ? (c / 100).toFixed(2).replace(".", ",") : "";
}

function FieldInput({ f, value }: { f: SettingField; value: unknown }) {
  const v = value ?? "";
  switch (f.type) {
    case "bool":
      return <label className="flex items-start gap-2 text-sm"><input type="checkbox" name={f.key} defaultChecked={value === true} className="mt-1" /><span>{f.label}{f.help && <span className="block text-xs text-muted">{f.help}</span>}</span></label>;
    case "textarea":
      return <textarea name={f.key} defaultValue={String(v)} maxLength={f.max} rows={3} className={`${inputClass} h-auto py-2`} />;
    case "select":
      return <select name={f.key} defaultValue={String(v)} className={inputClass}>{f.options!.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>;
    case "color":
      return <input type="color" name={f.key} defaultValue={String(v) || "#000000"} className="h-10 w-20 rounded border border-line" />;
    case "money": case "moneyOpt":
      return <input name={f.key} defaultValue={money(value)} inputMode="decimal" placeholder="0,00" className={inputClass} />;
    case "percent":
      return <input name={f.key} defaultValue={typeof value === "number" ? String(value / 100).replace(".", ",") : ""} inputMode="decimal" placeholder="0" className={inputClass} />;
    case "int":
      return <input name={f.key} type="number" min={f.min} max={f.max} defaultValue={String(v)} className={inputClass} />;
    case "cep":
      return <input name={f.key} defaultValue={v ? formatCEP(String(v)) : ""} inputMode="numeric" placeholder="00000-000" className={inputClass} />;
    default:
      return <input name={f.key} type={f.type === "email" ? "email" : f.type === "url" ? "url" : "text"} defaultValue={String(v)} maxLength={f.max} placeholder={f.placeholder} className={inputClass} />;
  }
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  await requireStaffPage("settings.write");
  const sp = await searchParams;
  const rows = await db()<{ key: string; value: Record<string, unknown> }[]>`select key, value from public.settings`;
  const values = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Configurações</h1>
        <p className="text-sm text-muted">Alterações valem imediatamente na loja e ficam registradas na auditoria.</p>
      </div>
      <Flash msg={sp.ok} error={sp.erro} />
      <nav className="flex flex-wrap gap-2 text-sm">{SETTING_FORMS.map((f) => <a key={f.key} href={`#${f.key}`} className="rounded-full border border-line px-3 py-1 hover:bg-surface">{f.title}</a>)}</nav>
      {SETTING_FORMS.map((form) => (
        <section key={form.key} id={form.key} className="scroll-mt-20 rounded-xl border border-line bg-surface">
          <header className="border-b border-line px-4 py-3"><h2 className="font-semibold">{form.title}</h2>{form.description && <p className="text-xs text-muted">{form.description}</p>}</header>
          <form action={saveSettingAction} className="grid gap-3 p-4 sm:grid-cols-2">
            <input type="hidden" name="settingKey" value={form.key} />
            {form.fields.map((f) => (
              f.type === "bool"
                ? <div key={f.key} className="sm:col-span-2"><FieldInput f={f} value={values[form.key]?.[f.key]} /></div>
                : <label key={f.key} className={`flex flex-col gap-1 text-sm ${f.type === "textarea" ? "sm:col-span-2" : ""}`}><span className="font-medium">{f.label}</span><FieldInput f={f} value={values[form.key]?.[f.key]} />{f.help && <span className="text-xs text-muted">{f.help}</span>}</label>
            ))}
            <div className="sm:col-span-2"><Button size="sm">Salvar</Button></div>
          </form>
        </section>
      ))}
    </div>
  );
}
