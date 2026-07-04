"use client";

import { useState } from "react";

// Real copy-to-clipboard for the share's social row — the previous markup was
// a plain <a href={shareUrl}> that navigated to the page instead of copying.
export function CopyLinkButton({
  url,
  className,
}: {
  url: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard API unavailable (http, permissions) — degrade to a
          // selectable prompt so the link is still obtainable.
          window.prompt("Copy this link", url);
        }
      }}
    >
      {copied ? "Copied ✓" : "Copy link"}
    </button>
  );
}
