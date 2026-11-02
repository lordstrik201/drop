import { safeEqual } from "./crypto";

/** Endpoints de tarefas agendadas exigem "Authorization: Bearer <CRON_SECRET>". */
export function isAuthorizedCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const h = req.headers.get("authorization") ?? "";
  return safeEqual(h, `Bearer ${secret}`);
}
