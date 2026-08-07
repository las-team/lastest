"use client";

import { Button } from "@/components/ui/button";
import { Github } from "lucide-react";
import { authClient } from "@/lib/auth/auth-client";

// Same rule as the /login returnTo: same-origin relative paths only, no open redirect.
function safeReturnTo(returnTo?: string | null) {
  return returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")
    ? returnTo
    : null;
}

/**
 * Attach GitHub to the signed-in user.
 *
 * This must stay `linkSocial` — NOT `signIn.social`. `signIn.social` runs the
 * sign-IN path, which resolves the GitHub profile to a user by email and then
 * refuses to attach the account unless the LOCAL user's email is verified
 * (better-auth's `account.accountLinking.requireLocalEmailVerified`, default
 * true). Nothing in this app ever sets `users.emailVerified`, so that rejected
 * every password-signup user with `account_not_linked` — and better-auth's
 * error page 302s to `/?error=...` in production, which surfaced as "Connect
 * GitHub silently drops me on the dashboard". `linkSocial` binds the account to
 * the current session, which has no email-verification gate.
 */
export function connectGithub(returnTo?: string | null) {
  return authClient.linkSocial({
    provider: "github",
    callbackURL: safeReturnTo(returnTo) ?? "/settings?success=github_connected",
    // Without this, failures land on better-auth's error page, which in
    // production redirects to `/` and drops the reason on the floor.
    errorCallbackURL: "/settings",
  });
}

export function ConnectGithubButton({ returnTo }: { returnTo?: string }) {
  return (
    <Button variant="outline" onClick={() => connectGithub(returnTo)}>
      <Github className="w-5 h-5" />
      Connect GitHub
    </Button>
  );
}

export function ReconnectGithubLink({ returnTo }: { returnTo?: string }) {
  return (
    <button
      onClick={() => connectGithub(returnTo)}
      className="text-sm text-primary hover:underline"
    >
      Reconnect
    </button>
  );
}
