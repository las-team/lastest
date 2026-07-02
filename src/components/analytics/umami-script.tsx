import Script from "next/script";

export function UmamiScript({ nonce }: { nonce?: string }) {
  const websiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
  if (!websiteId) return null;

  const sampleRate = process.env.NEXT_PUBLIC_UMAMI_REPLAY_SAMPLE_RATE ?? "1.0";
  const maskLevel =
    process.env.NEXT_PUBLIC_UMAMI_REPLAY_MASK_LEVEL ?? "moderate";
  const maxDuration =
    process.env.NEXT_PUBLIC_UMAMI_REPLAY_MAX_DURATION ?? "600000";
  const enableRecorder =
    process.env.NEXT_PUBLIC_UMAMI_REPLAY_ENABLED !== "false";

  return (
    <>
      <Script
        src="/_umami/script.js"
        data-website-id={websiteId}
        data-host-url="/_umami"
        data-do-not-track="true"
        strategy="afterInteractive"
        nonce={nonce}
      />
      {enableRecorder && (
        <Script
          src="/_umami/recorder.js"
          data-website-id={websiteId}
          data-host-url="/_umami"
          data-sample-rate={sampleRate}
          data-mask-level={maskLevel}
          data-max-duration={maxDuration}
          strategy="lazyOnload"
          nonce={nonce}
        />
      )}
    </>
  );
}
