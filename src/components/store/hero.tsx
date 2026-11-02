"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Banner = { id: string; title: string; subtitle: string | null; cta_label: string | null; link_url: string | null; image_url: string | null; mobile_image_url: string | null; background_color: string | null };

const safeHref = (u: string | null) => (u && (u.startsWith("/") || /^https:\/\//.test(u)) ? u : null);

export function HeroCarousel({ banners }: { banners: Banner[] }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (banners.length < 2 || paused) return;
    const t = setInterval(() => setI((x) => (x + 1) % banners.length), 6000);
    return () => clearInterval(t);
  }, [banners.length, paused]);
  const b = banners[i];
  const href = safeHref(b.link_url);
  const content = (
    <div className="relative flex min-h-[220px] items-center overflow-hidden rounded-2xl sm:min-h-[340px]" style={{ background: b.background_color ?? "var(--brand)" }}>
      {b.image_url && (
        <picture>
          {b.mobile_image_url && <source media="(max-width: 640px)" srcSet={b.mobile_image_url} />}
          <img src={b.image_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
        </picture>
      )}
      <div className="relative z-10 max-w-xl px-6 py-10 text-white sm:px-12 [text-shadow:0_1px_8px_rgba(0,0,0,.35)]">
        <h2 className="text-2xl font-extrabold tracking-tight sm:text-4xl">{b.title}</h2>
        {b.subtitle && <p className="mt-2 text-sm sm:text-lg">{b.subtitle}</p>}
        {b.cta_label && href && <span className="mt-5 inline-flex h-11 items-center rounded-lg bg-accent px-6 font-semibold text-ink [text-shadow:none]">{b.cta_label}</span>}
      </div>
    </div>
  );
  return (
    <section className="relative" aria-roledescription="carrossel" aria-label="Destaques" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      {href ? <Link href={href}>{content}</Link> : content}
      {banners.length > 1 && (
        <>
          <button type="button" onClick={() => setI((i - 1 + banners.length) % banners.length)} className="absolute left-2 top-1/2 z-20 -translate-y-1/2 rounded-full bg-white/80 p-2 text-ink shadow" aria-label="Banner anterior"><ChevronLeft size={18} /></button>
          <button type="button" onClick={() => setI((i + 1) % banners.length)} className="absolute right-2 top-1/2 z-20 -translate-y-1/2 rounded-full bg-white/80 p-2 text-ink shadow" aria-label="Próximo banner"><ChevronRight size={18} /></button>
          <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 gap-1.5">
            {banners.map((x, k) => (
              <button key={x.id} type="button" onClick={() => setI(k)} aria-label={`Banner ${k + 1}`} aria-current={k === i} className={`h-2 rounded-full transition-all ${k === i ? "w-6 bg-white" : "w-2 bg-white/60"}`} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
