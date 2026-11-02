import { Fragment } from "react";

/**
 * Renderiza conteúdo de páginas institucionais em um Markdown simples e SEGURO
 * (sem HTML bruto): títulos (## / ###), listas (- ), parágrafos, **negrito** e
 * links [texto](https://...). Variáveis {{loja}}, {{cnpj}}, {{email}} etc.
 * são substituídas pelos dados da empresa.
 */
export function renderPageContent(src: string, vars: Record<string, string>) {
  const text = src.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] || `[${k}]`);
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  return blocks.map((b, i) => {
    const t = b.trim();
    if (t.startsWith("### ")) return <h3 key={i}>{inline(t.slice(4))}</h3>;
    if (t.startsWith("## ")) return <h2 key={i}>{inline(t.slice(3))}</h2>;
    if (t.split("\n").every((l) => l.trim().startsWith("- "))) return <ul key={i}>{t.split("\n").map((l, j) => <li key={j}>{inline(l.trim().slice(2))}</li>)}</ul>;
    return <p key={i}>{t.split("\n").map((l, j, arr) => <Fragment key={j}>{inline(l)}{j < arr.length - 1 && <br />}</Fragment>)}</p>;
  });
}

function inline(s: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https:\/\/[^\s)]+|\/[^\s)]*|mailto:[^\s)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1]) out.push(<strong key={k++}>{m[1]}</strong>);
    else out.push(<a key={k++} href={m[3]} rel="noopener noreferrer">{m[2]}</a>);
    last = re.lastIndex;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
