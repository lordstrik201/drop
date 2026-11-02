"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { redeemPoints } from "@/lib/marketing/loyalty";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { isValidCPF, onlyDigits } from "@/lib/validation/br";

export type FormState = { ok: boolean; message?: string } | null;

const addressSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  label: z.string().trim().max(40).optional(),
  recipient_name: z.string().trim().min(3, "Informe o destinatário").max(120),
  phone: z.string().transform(onlyDigits).optional(),
  cep: z.string().transform(onlyDigits).pipe(z.string().length(8, "CEP inválido")),
  street: z.string().trim().min(2).max(200),
  number: z.string().trim().min(1).max(20),
  complement: z.string().trim().max(120).optional(),
  district: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(120),
  state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "UF inválida"),
  is_default: z.string().optional(),
});

export async function saveAddressAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser("/conta/enderecos");
  const p = addressSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { ok: false, message: p.error.issues[0].message };
  const d = p.data;
  const isDefault = d.is_default === "on";
  await db().begin(async (tx) => {
    if (isDefault) await tx`update public.addresses set is_default = false where profile_id = ${user.id}`;
    if (d.id) {
      await tx`update public.addresses set label = ${d.label || null}, recipient_name = ${d.recipient_name}, phone = ${d.phone || null}, cep = ${d.cep},
                 street = ${d.street}, number = ${d.number}, complement = ${d.complement || null}, district = ${d.district}, city = ${d.city},
                 state = ${d.state}, is_default = ${isDefault} where id = ${d.id} and profile_id = ${user.id}`;
    } else {
      const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from public.addresses where profile_id = ${user.id}`;
      if (n >= 20) throw new Error("Limite de 20 endereços.");
      await tx`insert into public.addresses (profile_id, label, recipient_name, phone, cep, street, number, complement, district, city, state, is_default)
               values (${user.id}, ${d.label || null}, ${d.recipient_name}, ${d.phone || null}, ${d.cep}, ${d.street}, ${d.number}, ${d.complement || null},
                       ${d.district}, ${d.city}, ${d.state}, ${isDefault || n === 0})`;
    }
  });
  revalidatePath("/conta/enderecos");
  return { ok: true, message: "Endereço salvo." };
}

export async function deleteAddressAction(form: FormData) {
  const user = await requireUser("/conta/enderecos");
  await db()`delete from public.addresses where id = ${String(form.get("id"))} and profile_id = ${user.id}`;
  revalidatePath("/conta/enderecos");
}

const profileSchema = z.object({
  full_name: z.string().trim().min(3).max(120),
  phone: z.string().transform(onlyDigits).pipe(z.string().max(13)),
  cpf: z.string().transform(onlyDigits).refine((v) => v === "" || isValidCPF(v), "CPF inválido"),
  birth_date: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).optional(),
  marketing: z.string().optional(),
});

export async function saveProfileAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser("/conta/dados");
  const p = profileSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { ok: false, message: p.error.issues[0].message };
  const d = p.data;
  const consent = d.marketing === "on";
  await db()`update public.profiles set full_name = ${d.full_name}, phone = ${d.phone || null}, cpf = ${d.cpf || null},
             birth_date = ${d.birth_date || null},
             marketing_consent = ${consent},
             marketing_consent_at = case when ${consent} <> marketing_consent then now() else marketing_consent_at end
             where id = ${user.id}`;
  revalidatePath("/conta/dados");
  return { ok: true, message: "Dados atualizados." };
}

export async function privacyRequestAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser("/conta/dados");
  const kind = String(form.get("kind"));
  if (!["delete", "correct", "revoke_consent"].includes(kind)) return { ok: false, message: "Solicitação inválida." };
  const [open] = await db()`select id from public.privacy_requests where profile_id = ${user.id} and kind = ${kind} and status = 'open'`;
  if (open) return { ok: true, message: "Você já tem uma solicitação em andamento." };
  await db()`insert into public.privacy_requests (profile_id, email, kind, notes) values (${user.id}, ${user.email}, ${kind}, ${String(form.get("notes") ?? "").slice(0, 1000) || null})`;
  if (kind === "revoke_consent") await db()`update public.profiles set marketing_consent = false, marketing_consent_at = now() where id = ${user.id}`;
  return { ok: true, message: "Solicitação registrada. Responderemos em até 15 dias, conforme a LGPD." };
}

/** Troca de pontos de fidelidade por cupom pessoal. */
export async function redeemPointsAction(f: FormData) {
  const user = await requireUser("/conta");
  let msg: string;
  try {
    const r = await redeemPoints(user.id, Number(String(f.get("points") ?? "").replace(/\D/g, "")));
    msg = `ok:${r.code}`;
  } catch (e) {
    msg = `erro:${(e as Error).message}`;
  }
  revalidatePath("/conta");
  redirect(`/conta?pontos=${encodeURIComponent(msg)}#fidelidade`);
}
