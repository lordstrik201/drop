"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";

export function Gallery({ images, name }: { images: { url: string; alt: string | null }[]; name: string }) {
  const [i, setI] = useState(0);
  if (!images.length) {
    return <div className="flex aspect-square items-center justify-center rounded-xl bg-bg text-muted"><ImageOff aria-hidden /><span className="sr-only">Produto sem imagem</span></div>;
  }
  const cur = images[Math.min(i, images.length - 1)];
  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row">
      {images.length > 1 && (
        <ul className="flex gap-2 overflow-x-auto sm:max-h-[520px] sm:flex-col sm:overflow-y-auto" aria-label="Miniaturas">
          {images.map((im, k) => (
            <li key={im.url + k}>
              <button type="button" onClick={() => setI(k)} aria-label={`Ver imagem ${k + 1}`} aria-current={k === i}
                className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 bg-white ${k === i ? "border-brand" : "border-line"}`}>
                <img src={im.url} alt="" className="h-full w-full object-contain" loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative aspect-square flex-1 overflow-hidden rounded-xl bg-white">
        <img src={cur.url} alt={cur.alt ?? name} className="h-full w-full object-contain" />
      </div>
    </div>
  );
}
