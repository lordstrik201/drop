import Script from "next/script";

const ID = { ga4: /^G-[A-Z0-9]{4,15}$/, gtm: /^GTM-[A-Z0-9]{4,10}$/, pixel: /^\d{8,20}$/ };

/**
 * Ferramentas de análise, carregadas somente quando configuradas no painel
 * (Configurações → Integrações de análise). IDs são validados para impedir
 * injeção de script.
 */
export function Analytics({ ga4Id, gtmId, metaPixelId }: { ga4Id?: string; gtmId?: string; metaPixelId?: string }) {
  const ga = ga4Id && ID.ga4.test(ga4Id) ? ga4Id : null;
  const gtm = gtmId && ID.gtm.test(gtmId) ? gtmId : null;
  const px = metaPixelId && ID.pixel.test(metaPixelId) ? metaPixelId : null;
  return (
    <>
      {gtm && (
        <Script id="gtm" strategy="afterInteractive">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtm}');`}
        </Script>
      )}
      {ga && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${ga}`} strategy="afterInteractive" />
          <Script id="ga4" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;gtag('js',new Date());gtag('config','${ga}');`}
          </Script>
        </>
      )}
      {px && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${px}');fbq('track','PageView');`}
        </Script>
      )}
    </>
  );
}

/** Dispara evento de conversão nas ferramentas configuradas (lado do cliente). */
export const trackEventScript = (event: string, data: Record<string, unknown>) =>
  `try{window.gtag&&window.gtag('event',${JSON.stringify(event)},${JSON.stringify(data)});window.fbq&&window.fbq('track',${JSON.stringify(event === "purchase" ? "Purchase" : event)},${JSON.stringify(data)});window.dataLayer&&window.dataLayer.push(Object.assign({event:${JSON.stringify(event)}},${JSON.stringify(data)}));}catch(e){}`;
