import Script from "next/script";

/**
 * Dev-only polyfill for a react-dom@19.2.x bug where performance.measure
 * calls with negative durations (from async SERVER component error paths)
 * throw a DOMException. Swallows only that specific error.
 *
 * Uses next/script with afterInteractive so the inline script renders on
 * the client after hydration, avoiding the nonce attribute mismatch between
 * server render (has nonce) and client hydration (no nonce header).
 */
export function DevPerformancePolyfill({ nonce }: { nonce?: string }) {
  if (process.env.NODE_ENV === "production") return null;

  return (
    <Script
      id="dev-performance-polyfill"
      nonce={nonce}
      strategy="afterInteractive"
      dangerouslySetInnerHTML={{
        __html: `(()=>{const o=performance.measure.bind(performance);performance.measure=function(){try{return o.apply(performance,arguments)}catch(e){if(e&&typeof e.message==='string'&&e.message.indexOf('negative time stamp')!==-1)return;throw e}};})();`,
      }}
    />
  );
}
