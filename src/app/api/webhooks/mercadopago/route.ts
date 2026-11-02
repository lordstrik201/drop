import { NextResponse } from "next/server";
import { handleMercadoPagoWebhook } from "@/lib/payments/webhook";
import { rateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const ip = (request.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const rl = await rateLimit(`webhook:mp:${ip}`, 300, 60);
  if (!rl.allowed) return NextResponse.json({ error: "rate limited" }, { status: 429 });
  const r = await handleMercadoPagoWebhook(request);
  return NextResponse.json(r.body, { status: r.status });
}
