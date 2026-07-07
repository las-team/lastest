"use client";

import { Button } from "@/components/ui/button";

export function VercelLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 76 65"
      fill="currentColor"
      aria-hidden
    >
      <path d="M37.59.25l36.95 64H.64l36.95-64z" />
    </svg>
  );
}

/**
 * Kicks off the Vercel Marketplace install/OAuth flow. Unlike GitHub (which
 * uses better-auth social sign-in), this is a custom OAuth route, so it's a
 * plain navigation — mirrors the GitLab connect anchor.
 */
export function ConnectVercelButton({
  label = "Connect Vercel",
}: {
  label?: string;
}) {
  return (
    <Button
      variant="outline"
      onClick={() => {
        window.location.href = "/api/connect/vercel";
      }}
    >
      <VercelLogo className="w-4 h-4" />
      {label}
    </Button>
  );
}
