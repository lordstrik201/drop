import type { Metadata } from "next";
import { TrackForm } from "@/components/store/track-form";

export const metadata: Metadata = { title: "Acompanhar pedido" };

export default function TrackPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-2xl font-bold">Acompanhar pedido</h1>
      <p className="mt-1 text-sm text-muted">Informe o número do pedido e o e-mail usado na compra.</p>
      <div className="mt-6 rounded-2xl border border-line bg-surface p-6"><TrackForm /></div>
    </div>
  );
}
