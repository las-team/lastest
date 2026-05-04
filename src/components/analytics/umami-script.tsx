import Script from "next/script";

export function UmamiScript() {
  const websiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
  if (!websiteId) return null;

  return (
    <Script
      src="/_umami/script.js"
      data-website-id={websiteId}
      data-host-url="/_umami"
      data-do-not-track="true"
      strategy="afterInteractive"
    />
  );
}
