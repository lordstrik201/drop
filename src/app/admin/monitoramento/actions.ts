"use server";

import { assertPermission } from "@/lib/auth/session";
import { runAdmin, str } from "@/lib/admin/action";
import { audit } from "@/lib/audit";
import { retryJob, runDueJobs } from "@/lib/jobs/queue";
import { jobHandlers } from "@/lib/jobs/handlers";
import { db } from "@/lib/db/client";

const BACK = "/admin/monitoramento";

export async function retryJobAction(f: FormData) {
  return runAdmin(BACK, async () => {
    const u = await assertPermission("monitoring.retry");
    const ok = await retryJob(str(f, "jobId"));
    if (!ok) throw new Error("Só tarefas com falha, mortas ou canceladas podem ser reexecutadas.");
    await audit(u, "job.retry", "job", str(f, "jobId"));
    return "Tarefa reenfileirada (mesma chave, sem duplicar efeitos).";
  });
}

export async function cancelJobAction(f: FormData) {
  return runAdmin(BACK, async () => {
    const u = await assertPermission("monitoring.retry");
    const [r] = await db()`update public.jobs set status = 'canceled', finished_at = now() where id = ${str(f, "jobId")} and status in ('queued', 'failed', 'dead') returning id`;
    if (!r) throw new Error("Tarefa não pode ser cancelada (em execução ou concluída).");
    await audit(u, "job.cancel", "job", str(f, "jobId"));
    return "Tarefa cancelada.";
  });
}

/** Processa a fila agora (útil sem agendador ou para destravar após corrigir credenciais). */
export async function runJobsNowAction() {
  return runAdmin(BACK, async () => {
    const u = await assertPermission("monitoring.retry");
    const s = await runDueJobs(jobHandlers, { limit: 25, workerId: `painel:${u.id}`, types: Object.keys(jobHandlers).filter((t) => t !== "supplier.sync") });
    await audit(u, "jobs.run_now", "job", null, { after: s });
    return `Fila processada: ${s.processed} tarefa(s), ${s.succeeded} ok, ${s.failed} com falha, ${s.dead} esgotada(s).`;
  });
}
