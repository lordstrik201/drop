import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/security/cron";
import { enqueueJob, runDueJobs } from "@/lib/jobs/queue";
import { jobHandlers } from "@/lib/jobs/handlers";
import { db } from "@/lib/db/client";

export const maxDuration = 60;

/**
 * Processa a fila de tarefas. Acionado pela Vercel Cron (vercel.json) ou por
 * qualquer agendador externo com o CRON_SECRET (ex.: pg_cron + pg_net no Supabase).
 */
async function run(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Tarefa periódica de expiração: uma por janela de 15 minutos (a chave impede duplicar).
  const slot = Math.floor(Date.now() / (15 * 60_000));
  await enqueueJob(db(), "orders.expire", {}, `orders.expire:${slot}`, { maxAttempts: 1 });
  const summary = await runDueJobs(jobHandlers, { limit: 25 });
  return NextResponse.json({ ok: true, ...summary });
}

export const GET = run;
export const POST = run;
