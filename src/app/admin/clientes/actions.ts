"use server";

import { redirect } from "next/navigation";
import { assertPermission } from "@/lib/auth/session";
import { runAdmin, str, optStr } from "@/lib/admin/action";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { anonymizeCustomer } from "@/lib/customers/lgpd";

const back = (f: FormData) => `/admin/clientes/${str(f, "profileId")}`;

export async function blockCustomerAction(f: FormData) {
  return runAdmin(back(f), async () => {
    const u = await assertPermission("customers.write");
    const block = str(f, "block") === "1";
    if (str(f, "profileId") === u.id) throw new Error("Você não pode bloquear a própria conta.");
    const [r] = await db()`update public.profiles set is_blocked = ${block} where id = ${str(f, "profileId")} and role = 'customer' returning id`;
    if (!r) throw new Error("Cliente não encontrado (contas da equipe são gerenciadas em Usuários).");
    await audit(u, block ? "customer.block" : "customer.unblock", "profile", str(f, "profileId"));
    return block ? "Cliente bloqueado: não consegue mais entrar na conta." : "Cliente desbloqueado.";
  });
}

export async function supportNoteAction(f: FormData) {
  return runAdmin(back(f), async () => {
    const u = await assertPermission("customers.write");
    const kind = str(f, "kind");
    if (!["note", "contact", "complaint", "return"].includes(kind)) throw new Error("Tipo inválido.");
    const body = str(f, "body");
    if (body.length < 2) throw new Error("Escreva a anotação.");
    const orderNumber = optStr(f, "orderNumber");
    let orderId: string | null = null;
    if (orderNumber) {
      const [o] = await db()<{ id: string }[]>`select id from public.orders where number = ${Number(orderNumber.replace(/\D/g, "")) || 0} and profile_id = ${str(f, "profileId")}`;
      if (!o) throw new Error(`Pedido ${orderNumber} não pertence a este cliente.`);
      orderId = o.id;
    }
    await db()`insert into public.support_notes (profile_id, order_id, author_id, kind, body) values (${str(f, "profileId")}, ${orderId}, ${u.id}, ${kind}, ${body.slice(0, 4000)})`;
    return "Registro de atendimento salvo.";
  });
}

export async function anonymizeCustomerAction(f: FormData) {
  return runAdmin(back(f), async () => {
    const u = await assertPermission("customers.write");
    const [p] = await db()<{ email: string }[]>`select email from public.profiles where id = ${str(f, "profileId")}`;
    if (!p) throw new Error("Cliente não encontrado.");
    if (str(f, "confirmEmail").toLowerCase() !== p.email.toLowerCase()) throw new Error("Para confirmar, digite exatamente o e-mail do cliente.");
    await anonymizeCustomer(str(f, "profileId"), u.id, optStr(f, "note"));
    await audit(u, "customer.erase", "profile", str(f, "profileId"), { after: { reason: optStr(f, "note") } });
    // a página do cliente deixa de existir: volta para a lista
    redirect(`/admin/clientes?ok=${encodeURIComponent("Dados pessoais eliminados. Pedidos mantidos por obrigação legal.")}`);
  });
}
