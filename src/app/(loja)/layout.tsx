import { StoreHeader } from "@/components/store/header";
import { StoreFooter } from "@/components/store/footer";

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Pular para o conteúdo</a>
      <StoreHeader />
      <main id="conteudo" className="flex-1">{children}</main>
      <StoreFooter />
    </>
  );
}
