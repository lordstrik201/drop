"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Activity, BarChart3, CreditCard, Factory, FileText, Folder, Gauge, History, Megaphone, Menu, MessageSquare, Package, Plug, Receipt, Send, Settings, Shield, Star, Users, Wallet, X,
} from "lucide-react";

const ICONS = { gauge: Gauge, receipt: Receipt, send: Send, package: Package, folder: Folder, factory: Factory, users: Users, message: MessageSquare, star: Star, wallet: Wallet, chart: BarChart3, megaphone: Megaphone, file: FileText, settings: Settings, plug: Plug, shield: Shield, activity: Activity, history: History, card: CreditCard };

type Item = { href: string; label: string; icon: string; group: string };

export function AdminNav({ items, storeName }: { items: Item[]; storeName: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const groups = Array.from(new Set(items.map((i) => i.group)));
  const nav = (
    <nav aria-label="Painel" className="flex flex-col gap-4 p-3 text-sm">
      {groups.map((g) => (
        <div key={g}>
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{g}</p>
          <ul>
            {items.filter((i) => i.group === g).map((i) => {
              const Icon = ICONS[i.icon as keyof typeof ICONS] ?? Gauge;
              const active = i.href === "/admin" ? path === "/admin" : path.startsWith(i.href);
              return (
                <li key={i.href}>
                  <Link href={i.href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2 ${active ? "bg-white/10 font-semibold text-white" : "text-zinc-300 hover:bg-white/5 hover:text-white"}`}>
                    <Icon size={16} aria-hidden /> {i.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
  return (
    <>
      <button onClick={() => setOpen(true)} className="fixed left-3 top-3 z-40 rounded-lg border border-line bg-surface p-1.5 lg:hidden" aria-label="Abrir menu"><Menu size={18} /></button>
      {open && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-50 w-60 overflow-y-auto bg-zinc-900 transition-transform lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-14 items-center justify-between border-b border-white/10 px-4">
          <Link href="/admin" className="truncate font-bold text-white">{storeName}</Link>
          <button onClick={() => setOpen(false)} className="text-zinc-400 lg:hidden" aria-label="Fechar menu"><X size={18} /></button>
        </div>
        {nav}
      </aside>
    </>
  );
}
