import Link from "next/link";
import { getSetting } from "@/lib/settings";
import { formatCNPJ } from "@/lib/validation/br";

export async function StoreFooter() {
  const [identity, company, social] = await Promise.all([getSetting("store.identity"), getSetting("store.company"), getSetting("store.social")]);
  const socials = Object.entries(social).filter(([, v]) => v && /^https:\/\//.test(v));
  const label: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube" };
  return (
    <footer className="mt-16 border-t border-line bg-surface text-sm">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-base font-bold">{identity.name}</p>
          {identity.tagline && <p className="mt-2 text-muted">{identity.tagline}</p>}
        </div>
        <div>
          <p className="font-semibold">Ajuda</p>
          <ul className="mt-3 space-y-2 text-muted">
            <li><Link href="/rastreio" className="hover:text-ink">Acompanhar pedido</Link></li>
            <li><Link href="/contato" className="hover:text-ink">Fale conosco</Link></li>
            <li><Link href="/institucional/trocas-e-devolucoes" className="hover:text-ink">Trocas e devoluções</Link></li>
          </ul>
        </div>
        <div>
          <p className="font-semibold">Institucional</p>
          <ul className="mt-3 space-y-2 text-muted">
            <li><Link href="/institucional/sobre" className="hover:text-ink">Sobre nós</Link></li>
            <li><Link href="/institucional/politica-de-privacidade" className="hover:text-ink">Política de privacidade</Link></li>
            <li><Link href="/institucional/termos-de-uso" className="hover:text-ink">Termos de uso</Link></li>
          </ul>
        </div>
        <div>
          <p className="font-semibold">Atendimento</p>
          <ul className="mt-3 space-y-2 text-muted">
            {company.email && <li><a href={`mailto:${company.email}`} className="hover:text-ink">{company.email}</a></li>}
            {company.phone && <li>{company.phone}</li>}
            {socials.map(([k, v]) => (
              <li key={k}><a href={v} target="_blank" rel="noopener noreferrer" className="hover:text-ink">{label[k] ?? k}</a></li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted">Pagamento processado com segurança pelo Mercado Pago: Pix, cartão de crédito e débito.</p>
        </div>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto max-w-7xl px-4 py-4 text-xs text-muted">
          © {new Date().getFullYear()} {company.legal_name || identity.name}
          {company.cnpj && ` · CNPJ ${formatCNPJ(company.cnpj)}`}
          {company.address && ` · ${company.address}`}
        </div>
      </div>
    </footer>
  );
}
