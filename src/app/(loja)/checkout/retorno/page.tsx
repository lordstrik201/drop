import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { db } from "@/lib/db/client";
import { getSessionUser } from "@/lib/auth/session";
import { retryPaymentAction } from "../../actions";
import { syncMercadoPagoPayment } from "@/lib/payments/service";
import { Alert, Button, LinkButton } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { signOrderAccess } from "@/lib/orders/access";
import { ORDER_STATUS_LABELS } from "@/lib/orders/status";
import type { OrderStatus } from "@/lib/types";
import { log } from "@/lib/logger";
import { trackEventScript } from "@/components/store/analytics";

export const metadata: Metadata = { title: "Status do pagamento", robots: { index: false } };

type SP = { pedido?: string; payment_id?: string; collection_id?: string; falha?: string };

export default async function ReturnPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const orderId = /^[0-9a-f-]{36}$/i.test(sp.pedido ?? "") ? sp.pedido! : null;
  if (!orderId) return <div className="mx-auto max-w-xl px-4 py-12"><Alert tone="danger">Pedido não informado.</Alert></div>;

  // O retorno do Mercado Pago traz o id do pagamento: consultamos a API oficial
  // (o webhook continua sendo a fonte principal; isto só antecipa a atualização).
  const paymentId = sp.payment_id ?? sp.collection_id;
  if (paymentId && /^\d+$/.test(paymentId)) {
    try { await syncMercadoPagoPayment(paymentId); } catch (e) { await log("warn", "checkout", "Consulta no retorno falhou", { error: (e as Error).message }); }
  }
  const [o] = await db()<{ id: string; number: string; status: OrderStatus; total_cents: number; profile_id: string | null; customer_email: string }[]>`
    select id, number, status, total_cents, profile_id, customer_email from public.orders where id = ${orderId}`;
  if (!o) return <div className="mx-auto max-w-xl px-4 py-12"><Alert tone="danger">Pedido não encontrado.</Alert></div>;
  const user = await getSessionUser();
  const ownsOrder = o.profile_id ? o.profile_id === user?.id : true;
  const paid = !["pending_payment", "canceled", "under_review"].includes(o.status);
  const detailsHref = user && ownsOrder && o.profile_id ? `/conta/pedidos/${o.id}` : `/rastreio/${o.id}?t=${signOrderAccess(o.id)}`;

  return (
    <div className="mx-auto max-w-xl px-4 py-12 text-center">
      {paid ? <CheckCircle2 className="mx-auto text-success" size={56} aria-hidden /> : o.status === "pending_payment" ? <Clock className="mx-auto text-warning" size={56} aria-hidden /> : <XCircle className="mx-auto text-danger" size={56} aria-hidden />}
      <h1 className="mt-4 text-2xl font-bold">
        {paid ? "Pagamento aprovado!" : o.status === "pending_payment" ? "Aguardando pagamento" : ORDER_STATUS_LABELS[o.status]}
      </h1>
      <p className="mt-2 text-muted">Pedido <strong>#{o.number}</strong> · {formatBRL(o.total_cents)}</p>
      {paid && <script dangerouslySetInnerHTML={{ __html: trackEventScript("purchase", { transaction_id: String(o.number), value: o.total_cents / 100, currency: "BRL" }) }} />}
      <div className="mt-6 flex flex-col gap-3 text-left">
        {sp.falha === "config" && <Alert tone="warning">O pagamento online ainda não está ativo nesta loja. Seu pedido foi registrado e nenhuma cobrança foi feita; nossa equipe entrará em contato.</Alert>}
        {sp.falha === "gateway" && <Alert tone="warning">Não conseguimos abrir o pagamento agora. Seu pedido está salvo. Tente novamente em instantes.</Alert>}
        {o.status === "pending_payment" && !sp.falha && <Alert tone="info">Se você pagou com Pix, a confirmação costuma levar poucos instantes. Avisaremos por e-mail ({o.customer_email}) assim que o pagamento for aprovado.</Alert>}
        {paid && <Alert tone="success">Enviamos a confirmação para {o.customer_email}. Seu pedido será encaminhado ao fornecedor e você receberá o código de rastreio quando for despachado.</Alert>}
      </div>
      <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
        {o.status === "pending_payment" && ownsOrder && (
          <form action={retryPaymentAction}><input type="hidden" name="orderId" value={o.id} /><Button type="submit" variant="accent" size="lg">Pagar agora</Button></form>
        )}
        <LinkButton href={detailsHref} variant="secondary" size="lg">Acompanhar pedido</LinkButton>
      </div>
      <Link href="/" className="mt-6 inline-block text-sm text-brand underline">Voltar à loja</Link>
    </div>
  );
}
