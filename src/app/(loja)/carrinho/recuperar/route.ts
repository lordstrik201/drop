import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { setCartCookie } from "@/lib/cart/cart";
import { verifyToken } from "@/lib/marketing/abandoned";
import { env } from "@/lib/env";

/** Link do e-mail de carrinho esquecido: reabre o carrinho neste navegador. */
export async function GET(req: Request) {
  const site = env().NEXT_PUBLIC_SITE_URL;
  const id = verifyToken("cart", new URL(req.url).searchParams.get("t"));
  if (!id) return NextResponse.redirect(new URL("/carrinho?aviso=link-invalido", site));
  const [c] = await db()<{ status: string }[]>`select status from public.carts where id = ${id}`;
  if (!c || c.status !== "open") return NextResponse.redirect(new URL("/carrinho?aviso=carrinho-finalizado", site));
  await setCartCookie(id);
  return NextResponse.redirect(new URL("/carrinho?utm_source=email&utm_medium=lembrete&utm_campaign=carrinho", site));
}
