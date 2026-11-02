import type { Metadata } from "next";
import { getSetting } from "@/lib/settings";
import { ContactForm } from "@/components/store/contact-form";

export const metadata: Metadata = { title: "Fale conosco" };

export default async function ContactPage() {
  const company = await getSetting("store.company");
  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 md:grid-cols-[1fr_280px]">
      <div>
        <h1 className="text-2xl font-bold">Fale conosco</h1>
        <p className="mt-1 text-sm text-muted">Responderemos pelo e-mail informado.</p>
        <div className="mt-6 rounded-2xl border border-line bg-surface p-6"><ContactForm /></div>
      </div>
      <aside className="text-sm">
        <h2 className="font-bold">Outros canais</h2>
        <ul className="mt-3 space-y-2 text-muted">
          {company.email && <li>E-mail: <a className="text-brand underline" href={`mailto:${company.email}`}>{company.email}</a></li>}
          {company.phone && <li>Telefone: {company.phone}</li>}
          {company.whatsapp && <li>WhatsApp: <a className="text-brand underline" href={`https://wa.me/${company.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer">{company.whatsapp}</a></li>}
          {!company.email && !company.phone && !company.whatsapp && <li>Use o formulário ao lado.</li>}
        </ul>
      </aside>
    </div>
  );
}
