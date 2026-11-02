import { db, type DbOrTx } from "@/lib/db/client";
import { errorMessage, log } from "@/lib/logger";

export type JobHandler = (payload: Record<string, unknown>, ctx: { jobId: string; attempt: number }) => Promise<unknown>;

/** Erro definitivo: não adianta tentar de novo (ex.: dados inválidos). */
export class PermanentJobError extends Error {}

const BACKOFF_SECONDS = [60, 300, 900, 3600, 3 * 3600, 6 * 3600, 12 * 3600];

export function backoffSeconds(attempt: number) {
  return BACKOFF_SECONDS[Math.min(attempt - 1, BACKOFF_SECONDS.length - 1)];
}

/**
 * Enfileira uma tarefa. A chave de idempotência é única: enfileirar duas vezes
 * a mesma tarefa não cria uma segunda execução.
 */
export async function enqueueJob(
  sql: DbOrTx,
  type: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
  opts: { runAt?: Date; maxAttempts?: number } = {},
): Promise<string | null> {
  const [r] = await sql<{ id: string }[]>`
    insert into public.jobs (type, payload, idempotency_key, run_at, max_attempts)
    values (${type}, ${sql.json(payload as never)}, ${idempotencyKey}, ${opts.runAt ?? new Date()}, ${opts.maxAttempts ?? 6})
    on conflict (idempotency_key) do nothing returning id`;
  return r?.id ?? null;
}

export type RunSummary = { processed: number; succeeded: number; failed: number; dead: number };

/** Executa tarefas vencidas. Usa SKIP LOCKED: várias execuções simultâneas não pegam a mesma tarefa. */
export async function runDueJobs(handlers: Record<string, JobHandler>, opts: { limit?: number; workerId?: string; types?: string[] } = {}): Promise<RunSummary> {
  const sql = db();
  const worker = opts.workerId ?? `w-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const summary: RunSummary = { processed: 0, succeeded: 0, failed: 0, dead: 0 };
  // Recupera tarefas travadas por execuções que morreram (> 10 min em running)
  await sql`update public.jobs set status = 'failed', last_error = coalesce(last_error, 'Execução interrompida'), locked_at = null, locked_by = null
            where status = 'running' and locked_at < now() - interval '10 minutes'`;
  const types = opts.types ?? null;
  const claimed = await sql<{ id: string; type: string; payload: Record<string, unknown>; attempts: number; max_attempts: number }[]>`
    update public.jobs j set status = 'running', locked_at = now(), locked_by = ${worker}, attempts = j.attempts + 1
    where j.id in (
      select id from public.jobs
      where status in ('queued', 'failed') and run_at <= now() and (${types}::text[] is null or type = any(${types}::text[]))
      order by run_at limit ${opts.limit ?? 20} for update skip locked
    ) returning j.id, j.type, j.payload, j.attempts, j.max_attempts`;

  for (const job of claimed) {
    summary.processed++;
    const handler = handlers[job.type];
    try {
      if (!handler) throw new PermanentJobError(`Sem executor para a tarefa "${job.type}"`);
      const result = await handler(job.payload, { jobId: job.id, attempt: job.attempts });
      await sql`update public.jobs set status = 'succeeded', result = ${result === undefined ? null : sql.json(result as never)},
                last_error = null, locked_at = null, locked_by = null, finished_at = now() where id = ${job.id}`;
      summary.succeeded++;
    } catch (e) {
      const msg = errorMessage(e);
      const permanent = e instanceof PermanentJobError;
      const dead = permanent || job.attempts >= job.max_attempts;
      const next = new Date(Date.now() + backoffSeconds(job.attempts) * 1000);
      await sql`update public.jobs set status = ${dead ? "dead" : "failed"}, last_error = ${msg.slice(0, 2000)},
                run_at = ${dead ? new Date() : next}, locked_at = null, locked_by = null,
                finished_at = ${dead ? new Date() : null} where id = ${job.id}`;
      if (dead) summary.dead++;
      else summary.failed++;
      await log(dead ? "error" : "warn", "jobs", `Tarefa ${job.type} falhou (tentativa ${job.attempts}/${job.max_attempts})`, { jobId: job.id, error: msg });
    }
  }
  return summary;
}

/** Reexecução manual pelo painel: mesma tarefa (mesma chave), sem duplicar efeitos. */
export async function retryJob(jobId: string) {
  const [r] = await db()<{ id: string }[]>`
    update public.jobs set status = 'queued', run_at = now(), attempts = 0, finished_at = null
    where id = ${jobId} and status in ('failed', 'dead', 'canceled') returning id`;
  return !!r;
}
