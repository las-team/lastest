"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Rocket,
  Loader2,
  CheckCircle2,
  XCircle,
  CircleDot,
  Circle,
  X,
  ChevronDown,
  KeyRound,
  Monitor,
} from "lucide-react";
import { BrowserViewer } from "@/components/embedded-browser/browser-viewer-client";
import {
  useQuickstart,
  type QuickstartStep,
  type QuickstartSessionView,
} from "./use-quickstart";

interface QuickstartPanelProps {
  repositoryId?: string | null;
  enabled: boolean;
  reason?: "no_team" | "not_early_adopter" | "no_base_url";
}

const STEP_LABELS: Record<string, string> = {
  qs_preflight: "Preflight",
  qs_scout_public: "Public scout",
  qs_auth_setup: "Auth setup",
  qs_scout_authed: "Authed scout",
  qs_generate: "Generate walkthrough",
  qs_run_and_notes: "Run & notes",
};

function StepIcon({ status }: { status: QuickstartStep["status"] }) {
  if (status === "active")
    return <Loader2 className="size-3.5 animate-spin text-info" />;
  if (status === "completed")
    return <CheckCircle2 className="size-3.5 text-success" />;
  if (status === "failed")
    return <XCircle className="size-3.5 text-destructive" />;
  if (status === "skipped")
    return <CircleDot className="size-3.5 text-muted-foreground/60" />;
  return <Circle className="size-3.5 text-muted-foreground/40" />;
}

/** Founder-facing demo notes, rendered inline once the run writes them. */
function NotesPanel({
  notes,
}: {
  notes: NonNullable<QuickstartSessionView["metadata"]["demoNotes"]>;
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Demo notes
      </p>
      {notes.uxSummary && (
        <p className="text-xs text-foreground/90">{notes.uxSummary}</p>
      )}
      {notes.highlights.length > 0 && (
        <ul className="space-y-1">
          {notes.highlights.slice(0, 4).map((h, i) => (
            <li key={`h-${i}`} className="flex gap-1.5 text-[11px]">
              <CheckCircle2 className="size-3 text-success shrink-0 mt-0.5" />
              <span>
                <span className="font-medium">{h.label}</span>
                {h.note ? ` — ${h.note}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      {notes.frictionPoints.length > 0 && (
        <ul className="space-y-1">
          {notes.frictionPoints.slice(0, 3).map((f, i) => (
            <li key={`f-${i}`} className="flex gap-1.5 text-[11px]">
              <CircleDot className="size-3 text-warning shrink-0 mt-0.5" />
              <span>
                <span className="font-medium">{f.label}</span>
                {f.note ? ` — ${f.note}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Live browser column — the scout, then the walkthrough run, drive this view. */
function BrowserColumn({
  streamUrl,
  queued,
}: {
  streamUrl?: string;
  queued?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="lg:sticky lg:top-4 space-y-1.5">
        <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          <Monitor className="size-3" />
          Live browser
        </p>
        {streamUrl ? (
          <div className="rounded-md overflow-hidden border">
            <BrowserViewer
              streamUrl={streamUrl}
              initialViewport={{ width: 1280, height: 720 }}
              interactive={false}
              hideControls
            />
          </div>
        ) : queued ? (
          <div className="flex aspect-video items-center justify-center gap-2 rounded-md border border-dashed text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Waiting for a browser from the pool&hellip;
          </div>
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-md border border-dashed px-4 text-center text-[11px] text-muted-foreground/70">
            The live browser appears here while the agent is driving it.
          </div>
        )}
      </div>
    </div>
  );
}

export function QuickstartPanel({
  repositoryId,
  enabled,
  reason,
}: QuickstartPanelProps) {
  const {
    session,
    loading,
    error,
    isActive,
    isTerminal,
    start,
    cancel,
    dismiss,
  } = useQuickstart(repositoryId);

  const [showCreds, setShowCreds] = useState(true);
  const [appEmail, setAppEmail] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const handleStart = () =>
    start(appEmail && appPassword ? { appEmail, appPassword } : undefined);

  if (!enabled) {
    // Only render the disabled hint when the team IS early-adopter but baseUrl is missing —
    // otherwise hide entirely to keep the home page uncluttered.
    if (reason !== "no_base_url") return null;
    return (
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Rocket className="size-4 text-pink-600 dark:text-pink-400" />
            QuickStart
            <Badge variant="outline" className="text-[10px]">
              early adopter
            </Badge>
          </CardTitle>
          <CardDescription>
            Set a non-local base URL for this repo in the sidebar to enable the
            QuickStart agent. localhost URLs are skipped.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const buildId = session?.metadata.buildId;
  const walkthroughTestId = session?.metadata.walkthroughTestId;
  const publicScout = session?.metadata.publicScout;
  const authSetup = session?.metadata.authSetup;
  const streamUrl = session?.metadata.streamUrl;
  const queuedForBrowser = session?.metadata.queuedForBrowser;
  const demoNotes = session?.metadata.demoNotes;
  const usedEmail = session?.metadata.quickstartEmail;
  const failedStep = session?.steps.find((s) => s.status === "failed");

  // The browser column is shown whenever a run is live or a stream is attached.
  const showBrowserColumn = !!session && (isActive || !!streamUrl);

  // Credentials block — open by default and always rendered (even mid-run, where
  // it degrades to a read-only summary of the account the agent is using).
  const credsBlock = (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setShowCreds((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <KeyRound className="size-3" />
        {session ? "App login" : "Use my app login (optional)"}
        <ChevronDown
          className={`size-3 transition-transform ${showCreds ? "rotate-180" : ""}`}
        />
      </button>
      {showCreds &&
        (session ? (
          <p className="text-[11px] text-muted-foreground pt-0.5">
            {usedEmail ? (
              <>
                Account in use:{" "}
                <span className="font-medium text-foreground">{usedEmail}</span>
              </>
            ) : (
              "Using a throwaway demo account on your app."
            )}
          </p>
        ) : (
          <div className="space-y-2 pt-1">
            <p className="text-[11px] text-muted-foreground">
              QuickStart runs against your app&rsquo;s base URL. Provide a
              working login to capture an authenticated walkthrough; leave blank
              to register a throwaway demo account instead. Credentials stay on
              your team and are never shown on the public share.
            </p>
            <Input
              type="email"
              autoComplete="off"
              placeholder="you@yourapp.com"
              aria-label="App login email"
              value={appEmail}
              onChange={(e) => setAppEmail(e.target.value)}
              className="h-8 text-sm"
            />
            <Input
              type="password"
              autoComplete="off"
              placeholder="App login password"
              aria-label="App login password"
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
        ))}
    </div>
  );

  const stepsList = session && (
    <ol className="space-y-1.5">
      {session.steps.map((step) => {
        const label = STEP_LABELS[step.id] ?? step.label;
        return (
          <li key={step.id} className="flex items-start gap-2 text-sm">
            <StepIcon status={step.status} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={
                    step.status === "pending" ? "text-muted-foreground/70" : ""
                  }
                >
                  {label}
                </span>
                {step.id === "qs_scout_public" &&
                  publicScout?.classification &&
                  step.status === "completed" && (
                    <Badge variant="secondary" className="text-[10px]">
                      {publicScout.classification.replace(/_/g, " ")}
                    </Badge>
                  )}
                {step.id === "qs_auth_setup" && step.status === "skipped" && (
                  <span className="text-[11px] text-muted-foreground/70">
                    not automatable
                  </span>
                )}
                {step.id === "qs_auth_setup" &&
                  authSetup?.captured === false &&
                  step.status === "completed" && (
                    <span className="text-[11px] text-warning">
                      auth rejected
                    </span>
                  )}
              </div>
              {step.status === "failed" && step.error && (
                <p className="text-[11px] text-destructive mt-0.5 line-clamp-3">
                  {step.error}
                </p>
              )}
              {step.id === "qs_auth_setup" &&
                authSetup?.captured === false &&
                authSetup?.failureReason && (
                  <p className="text-[11px] text-warning/90 mt-0.5 line-clamp-3 break-words">
                    {authSetup.failureReason}
                  </p>
                )}
            </div>
          </li>
        );
      })}
    </ol>
  );

  const leftColumn = session && (
    <div className="space-y-3 min-w-0">
      {stepsList}

      {demoNotes && <NotesPanel notes={demoNotes} />}

      {(buildId || walkthroughTestId) && (
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
          {buildId && (
            <Button size="sm" variant="outline" asChild>
              <Link href={`/builds/${buildId}`}>Open build</Link>
            </Button>
          )}
          {walkthroughTestId && (
            <Button size="sm" variant="outline" asChild>
              <Link href={`/tests/${walkthroughTestId}`}>Walkthrough test</Link>
            </Button>
          )}
        </div>
      )}

      {failedStep && session.status === "failed" && (
        <p className="text-xs text-muted-foreground">
          Stopped at{" "}
          <span className="font-medium">
            {STEP_LABELS[failedStep.id] ?? failedStep.label}
          </span>
          . Dismiss and start again to retry.
        </p>
      )}
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Rocket className="size-4 text-pink-600 dark:text-pink-400" />
              QuickStart
              <Badge variant="outline" className="text-[10px]">
                early adopter
              </Badge>
            </CardTitle>
            <CardDescription>
              Spin up a 2-test demo (auth setup + app walkthrough) on this
              repo&rsquo;s base URL, run with video, write demo notes.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!session && (
              <Button
                size="sm"
                onClick={handleStart}
                disabled={loading || !repositoryId}
              >
                {loading ? (
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Rocket className="size-3.5 mr-1.5" />
                )}
                Start QuickStart
              </Button>
            )}
            {session && isActive && (
              <Button
                size="sm"
                variant="outline"
                onClick={cancel}
                disabled={loading}
              >
                Cancel
              </Button>
            )}
            {session && isTerminal && (
              <Button
                size="sm"
                variant="ghost"
                onClick={dismiss}
                title="Dismiss"
              >
                <X className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-3">
        {credsBlock}

        {session &&
          (showBrowserColumn ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
              {leftColumn}
              <BrowserColumn streamUrl={streamUrl} queued={queuedForBrowser} />
            </div>
          ) : (
            leftColumn
          ))}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
