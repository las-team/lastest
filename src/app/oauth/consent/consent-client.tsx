"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, X, ShieldAlert } from "lucide-react";

interface Props {
  consentCode: string;
  clientName: string;
  clientId: string;
  registered: boolean;
  canWrite: boolean;
  userEmail: string;
  teamName: string | null;
}

/** What the connection will be able to do, in plain language. */
function grants(canWrite: boolean): string[] {
  const read = [
    "Read your projects, tests, builds and visual diffs",
    "Read coverage, verification results and QA insights",
  ];
  if (!canWrite) return read;
  return [
    ...read,
    "Run tests and start verification builds",
    "Create and update tests, areas and setup scripts",
    "Approve or reject visual changes (this rewrites baselines)",
  ];
}

const NEVER = [
  "Delete tests, areas, setup scripts or stored logins",
  "Publish a public share link, or revoke an existing one",
  "Read or change your billing, team members or API keys",
];

export function ConsentClient({
  consentCode,
  clientName,
  clientId,
  registered,
  canWrite,
  userEmail,
  teamName,
}: Props) {
  const [busy, setBusy] = useState<"accept" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(accept: boolean) {
    setBusy(accept ? "accept" : "deny");
    setError(null);
    try {
      const res = await fetch("/api/auth/oauth2/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accept, consent_code: consentCode }),
      });
      const body = (await res.json()) as { redirectURI?: string };
      if (!res.ok || !body.redirectURI) {
        throw new Error(
          "The authorization request expired or is no longer valid. Start the connection again.",
        );
      }
      window.location.href = body.redirectURI;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold tracking-tight">
          Connect {clientName} to Lastest?
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Signed in as {userEmail}
          {teamName ? ` · ${teamName}` : ""}
        </p>

        {!registered && (
          <div className="mt-4 flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              This app registered itself moments ago and has not been verified
              by anyone. Only continue if you started this connection.
            </span>
          </div>
        )}

        <section className="mt-5">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            It will be able to
          </h2>
          <ul className="mt-2 space-y-1.5 text-sm">
            {grants(canWrite).map((g) => (
              <li key={g} className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span>{g}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-5">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            It will never be able to
          </h2>
          <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
            {NEVER.map((n) => (
              <li key={n} className="flex gap-2">
                <X className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </section>

        <p className="mt-5 break-all font-mono text-[10px] text-muted-foreground">
          client_id: {clientId}
        </p>

        {error && (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <div className="mt-6 flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={busy !== null}
            onClick={() => decide(false)}
          >
            {busy === "deny" ? "Cancelling…" : "Cancel"}
          </Button>
          <Button
            className="flex-1"
            disabled={busy !== null}
            onClick={() => decide(true)}
          >
            {busy === "accept" ? "Connecting…" : "Allow"}
          </Button>
        </div>
      </div>
    </main>
  );
}
