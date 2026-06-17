"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  Share2,
  Copy,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { saveBranchBaseUrl } from "@/server/actions/environment";
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
  /** Repo's default branch — the key the QuickStart gate reads a base URL from.
   *  When present, the no_base_url empty state offers inline URL entry instead
   *  of sending the user off to the sidebar. */
  defaultBranch?: string | null;
}

const STEP_LABELS: Record<string, string> = {
  qs_preflight: "Preflight",
  qs_scout_public: "Public scout",
  qs_auth_setup: "Auth setup",
  qs_scout_authed: "Authed scout",
  qs_generate: "Generate walkthrough",
  qs_run_and_notes: "Run & notes",
  qs_approve_baselines: "Approve baselines",
  qs_rerun_after_approval: "Re-run for pairing",
  qs_publish_share: "Publish share",
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

/** Founder-facing share — the payoff. Surfaced prominently once the
 *  qs_publish_share step writes the public /r/<slug> URL. */
function ShareBlock({
  shareUrl,
  shareSlug,
}: {
  shareUrl: string;
  shareSlug?: string;
}) {
  const pretty = shareSlug ? `/r/${shareSlug}` : shareUrl;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Share link copied");
    } catch {
      toast.error("Couldn't copy — select and copy manually");
    }
  };
  return (
    <div className="rounded-md border border-pink-500/30 bg-pink-500/5 p-3 space-y-2">
      <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-pink-600 dark:text-pink-400">
        <Share2 className="size-3" />
        Founder share ready
      </p>
      <code className="block truncate rounded bg-background/60 px-2 py-1 text-[11px] text-foreground/90">
        {pretty}
      </code>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" asChild>
          <a href={shareUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-3.5 mr-1.5" />
            Open report
          </a>
        </Button>
        <Button size="sm" variant="outline" onClick={copy}>
          <Copy className="size-3.5 mr-1.5" />
          Copy link
        </Button>
      </div>
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
  defaultBranch,
}: QuickstartPanelProps) {
  const router = useRouter();
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
  const [baseUrlInput, setBaseUrlInput] = useState("");
  const [savingBaseUrl, setSavingBaseUrl] = useState(false);
  const handleStart = () =>
    start(appEmail && appPassword ? { appEmail, appPassword } : undefined);

  // Inline base-URL entry for the no_base_url empty state — saves to the repo's
  // default-branch key (the one the gate reads) and refreshes so the server
  // re-evaluates the gate and renders the live panel without a sidebar detour.
  const canInlineBaseUrl = !!repositoryId && !!defaultBranch;
  const saveBaseUrl = async () => {
    if (!repositoryId || !defaultBranch) return;
    let url = baseUrlInput.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    setSavingBaseUrl(true);
    try {
      await saveBranchBaseUrl(repositoryId, defaultBranch, url);
      toast.success("Base URL saved — QuickStart unlocked");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save base URL");
    } finally {
      setSavingBaseUrl(false);
    }
  };

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
          </CardTitle>
          <CardDescription>
            {canInlineBaseUrl
              ? "Point QuickStart at your app to generate a live walkthrough + shareable report. localhost URLs are skipped."
              : "Set a non-local base URL for this repo in the sidebar to enable the QuickStart agent. localhost URLs are skipped."}
          </CardDescription>
        </CardHeader>
        {canInlineBaseUrl && (
          <CardContent className="pt-0">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="url"
                inputMode="url"
                placeholder="your-app.com"
                aria-label="App base URL"
                value={baseUrlInput}
                onChange={(e) => setBaseUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveBaseUrl();
                }}
                disabled={savingBaseUrl}
                className="h-9"
              />
              <Button
                size="sm"
                onClick={saveBaseUrl}
                disabled={savingBaseUrl || !baseUrlInput.trim()}
                className="shrink-0"
              >
                {savingBaseUrl ? (
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Rocket className="size-3.5 mr-1.5" />
                )}
                Save &amp; enable
              </Button>
            </div>
          </CardContent>
        )}
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
  const shareUrl = session?.metadata.shareUrl;
  const shareSlug = session?.metadata.shareSlug;
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

      {shareUrl && <ShareBlock shareUrl={shareUrl} shareSlug={shareSlug} />}

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
