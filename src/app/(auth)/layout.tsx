import Link from "next/link";
import { getSetting } from "@/lib/settings";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const identity = await getSetting("store.identity");
  return (
    <div className="flex min-h-dvh flex-col items-center bg-bg px-4 py-10">
      <Link href="/" className="mb-6 text-2xl font-extrabold tracking-tight text-brand">{identity.logo_url ? <img src={identity.logo_url} alt={identity.name} className="h-10" /> : identity.name}</Link>
      <main className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">{children}</main>
    </div>
  );
}
