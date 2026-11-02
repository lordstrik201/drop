import { NextResponse } from "next/server";
import { isAuthConfigured, supabaseServer } from "@/lib/auth/supabase";

export async function POST(request: Request) {
  if (isAuthConfigured()) await (await supabaseServer()).auth.signOut();
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
