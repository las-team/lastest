"use client";

import { connectGithub } from "@/components/settings/connect-github-button";

/**
 * Recovery affordance for a verify surface that hit `GITHUB_NOT_CONNECTED`.
 *
 * Filing an issue is the whole point of the case the reviewer is looking at, so
 * the failure has to be actionable in place. Connecting is a full OAuth
 * round-trip that leaves the page, hence the returnTo: it lands the reviewer
 * back on the exact case rather than on Settings.
 */
export function ConnectGithubInline({ className }: { className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() =>
        connectGithub(
          typeof window === "undefined"
            ? undefined
            : window.location.pathname + window.location.search,
        )
      }
    >
      Connect GitHub
    </button>
  );
}
