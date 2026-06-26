"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Rocket,
  Loader2,
  Check,
  CheckCircle2,
  CircleDot,
  Circle,
  X,
  AlertTriangle,
  ChevronDown,
  KeyRound,
  Share2,
  Copy,
  ExternalLink,
  Lock,
  RotateCw,
  Terminal,
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
  /** Repo's resolved (non-local) base URL — surfaced in the header so the
   *  founder sees exactly what the demo runs against. */
  baseUrl?: string | null;
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

/** Strip protocol + trailing slash for a compact host display. */
function hostOf(url?: string | null): string | null {
  if (!url) return null;
  return url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

/** Small mono uppercase section label, used like the design's eyebrows. */
function Eyebrow({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`font-mono text-[10.5px] font-medium uppercase tracking-[0.09em] text-muted-foreground ${className}`}
    >
      {children}
    </span>
  );
}

/** Pulsing "live" dot (info = agent working, destructive = live stream). */
function LiveDot({ tone }: { tone: "info" | "destructive" }) {
  const bg = tone === "info" ? "bg-info" : "bg-destructive";
  return (
    <span className="relative flex size-[7px]">
      <span
        className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${bg}`}
      />
      <span className={`relative inline-flex size-[7px] rounded-full ${bg}`} />
    </span>
  );
}

/** Circular pipeline step marker. */
function StepCircle({ status }: { status: QuickstartStep["status"] }) {
  const base =
    "mt-0.5 flex size-[22px] shrink-0 items-center justify-center rounded-full";
  if (status === "active")
    return (
      <span className={`${base} bg-info/15 text-info`}>
        <Loader2 className="size-3 animate-spin" strokeWidth={3} />
      </span>
    );
  if (status === "completed")
    return (
      <span className={`${base} bg-success/15 text-success`}>
        <Check className="size-3" strokeWidth={3} />
      </span>
    );
  if (status === "failed")
    return (
      <span className={`${base} bg-destructive/15 text-destructive`}>
        <X className="size-3" strokeWidth={3} />
      </span>
    );
  if (status === "skipped")
    return (
      <span className={`${base} bg-muted text-muted-foreground`}>
        <CircleDot className="size-3" />
      </span>
    );
  return (
    <span className={`${base} bg-muted text-muted-foreground/50`}>
      <Circle className="size-2.5" />
    </span>
  );
}

/** Browser-chrome frame (traffic lights + URL pill) wrapping live/preview content. */
function Chrome({
  url,
  trailing,
  children,
}: {
  url?: string | null;
  trailing?: "reload" | "external";
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-md border bg-card shadow-sm">
      <div className="flex h-[38px] items-center gap-2.5 border-b bg-muted/60 px-3">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-[#E96A5E]" />
          <span className="size-2.5 rounded-full bg-[#E0A93B]" />
          <span className="size-2.5 rounded-full bg-[#5FB98E]" />
        </div>
        <div className="flex h-6 flex-1 items-center gap-1.5 overflow-hidden rounded-full border bg-card px-3 font-mono text-[11px] text-muted-foreground">
          <Lock className="size-3 shrink-0" />
          <span className="truncate">{url ?? "—"}</span>
        </div>
        {trailing === "reload" && (
          <RotateCw className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        {trailing === "external" && (
          <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
        )}
      </div>
      {children}
    </div>
  );
}

/** Founder-facing demo notes — the qualitative report body. */
function NotesBody({
  notes,
}: {
  notes: NonNullable<QuickstartSessionView["metadata"]["demoNotes"]>;
}) {
  return (
    <div className="space-y-3 p-3.5">
      {notes.uxSummary && (
        <p className="text-xs leading-relaxed text-foreground/90">
          {notes.uxSummary}
        </p>
      )}
      {notes.highlights.length > 0 && (
        <div className="space-y-1.5">
          <Eyebrow className="text-[9px]">Highlights</Eyebrow>
          <ul className="space-y-1">
            {notes.highlights.slice(0, 4).map((h, i) => (
              <li key={`h-${i}`} className="flex gap-1.5 text-[11px]">
                <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-success" />
                <span>
                  <span className="font-medium">{h.label}</span>
                  {h.note ? ` — ${h.note}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {notes.frictionPoints.length > 0 && (
        <div className="space-y-1.5">
          <Eyebrow className="text-[9px]">Friction</Eyebrow>
          <ul className="space-y-1">
            {notes.frictionPoints.slice(0, 3).map((f, i) => (
              <li key={`f-${i}`} className="flex gap-1.5 text-[11px]">
                <CircleDot className="mt-0.5 size-3 shrink-0 text-warning" />
                <span>
                  <span className="font-medium">{f.label}</span>
                  {f.note ? ` — ${f.note}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Brand marks (lucide dropped its brand icons, so inline the SVGs). */
function XLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      fill="currentColor"
      className={className}
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
function LinkedInLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      fill="currentColor"
      className={className}
    >
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z" />
    </svg>
  );
}

/** X/Twitter-style link unfurl — mirrors how the published /r/ share appears
 *  when pasted into a social timeline: OG card image + domain + title + blurb. */
function ShareEmbed({
  shareUrl,
  shareSlug,
  title,
  description,
}: {
  shareUrl: string;
  shareSlug?: string;
  title: string;
  description?: string;
}) {
  const domain = hostOf(shareUrl) ?? "lastest.cloud";
  return (
    <a
      href={shareUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="flex overflow-hidden rounded-md border bg-card shadow-sm transition-shadow hover:shadow-md"
    >
      {shareSlug && (
        // Twitter "summary"-card layout: a ~1/2-width thumbnail on the left,
        // text on the right (not the full-bleed banner).
        <div className="w-1/2 shrink-0 self-stretch border-r bg-muted">
          {/* The exact OG card the share serves — same image a social unfurl
              renders. Plain <img>: the OG route is a public, already-optimized
              1200×630 PNG, so next/image would just add an optimizer hop. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/og/share/${shareSlug}`}
            alt={`${title} preview`}
            className="size-full object-cover"
            loading="lazy"
          />
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-0.5 p-3">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground">
          {domain}
        </div>
        <div className="truncate text-sm font-semibold text-foreground">
          {title}
        </div>
        {description && (
          <div className="line-clamp-3 text-xs text-muted-foreground">
            {description}
          </div>
        )}
      </div>
    </a>
  );
}

export function QuickstartPanel({
  repositoryId,
  enabled,
  reason,
  baseUrl,
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

  const [showCreds, setShowCreds] = useState(false);
  const [appEmail, setAppEmail] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [baseUrlInput, setBaseUrlInput] = useState("");
  const [savingBaseUrl, setSavingBaseUrl] = useState(false);
  const [editingUrl, setEditingUrl] = useState(false);
  const handleStart = () =>
    start(appEmail && appPassword ? { appEmail, appPassword } : undefined);

  // Inline base-URL entry for the no_base_url empty state — saves to the repo's
  // default-branch key (the one the gate reads) and refreshes so the server
  // re-evaluates the gate and renders the live panel without a sidebar detour.
  const canInlineBaseUrl = !!repositoryId && !!defaultBranch;
  const saveBaseUrl = async (): Promise<boolean> => {
    if (!repositoryId || !defaultBranch) return false;
    let url = baseUrlInput.trim();
    if (!url) return false;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    setSavingBaseUrl(true);
    try {
      await saveBranchBaseUrl(repositoryId, defaultBranch, url);
      toast.success("Base URL saved — QuickStart unlocked");
      router.refresh();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save base URL");
      return false;
    } finally {
      setSavingBaseUrl(false);
    }
  };

  const host = hostOf(baseUrl);

  if (!enabled) {
    // Only render the disabled hint when the team IS early-adopter but baseUrl is missing —
    // otherwise hide entirely to keep the home page uncluttered.
    if (reason !== "no_base_url") return null;
    return (
      <Card className="gap-0 overflow-hidden border-dashed py-0">
        <div className="flex items-center gap-4 p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-foreground">
            <Rocket className="size-5 text-background" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold">QuickStart</div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {canInlineBaseUrl
                ? "Point QuickStart at your app to generate a live walkthrough + shareable report. localhost URLs are skipped."
                : "Set a non-local base URL for this repo in the sidebar to enable the QuickStart agent. localhost URLs are skipped."}
            </p>
          </div>
        </div>
        {canInlineBaseUrl && (
          <div className="flex flex-col gap-2 border-t bg-muted/20 p-4 sm:flex-row">
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
              className="h-9 shrink-0"
            >
              {savingBaseUrl ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Rocket className="mr-1.5 size-3.5" />
              )}
              Save &amp; enable
            </Button>
          </div>
        )}
      </Card>
    );
  }

  const status = session?.status;
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
  const activeStep = session?.steps.find((s) => s.status === "active");

  // Pipeline progress counters.
  const totalSteps = session?.steps.length ?? 0;
  const doneSteps =
    session?.steps.filter(
      (s) => s.status === "completed" || s.status === "skipped",
    ).length ?? 0;
  const activeIdx =
    session?.steps.findIndex((s) => s.status === "active") ?? -1;
  const stepNum = activeIdx >= 0 ? activeIdx + 1 : doneSteps;

  // Right column shows the live browser whenever a run is live or a stream is
  // attached; otherwise the report preview (terminal) or a failure card.
  const showLive = !!session && (isActive || !!streamUrl);

  const copyShare = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Share link copied");
    } catch {
      toast.error("Couldn't copy — select and copy manually");
    }
  };

  // ── Header bits ──────────────────────────────────────────────────────────
  const tileClass =
    status === "completed"
      ? "bg-primary"
      : status === "failed"
        ? "bg-destructive"
        : "bg-foreground";
  const TileIcon =
    status === "completed"
      ? Check
      : status === "failed"
        ? AlertTriangle
        : Rocket;

  const statusPill = session && (
    <>
      {isActive && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-info/12 px-2.5 py-1 text-[11.5px] font-semibold text-info">
          <LiveDot tone="info" />
          Agent working · step {stepNum} of {totalSteps}
        </span>
      )}
      {status === "completed" && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/12 px-2.5 py-1 text-[11.5px] font-semibold text-success">
          <CheckCircle2 className="size-3" />
          Demo ready · {doneSteps} of {totalSteps}
        </span>
      )}
      {status === "failed" && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/12 px-2.5 py-1 text-[11.5px] font-semibold text-destructive">
          <AlertTriangle className="size-3" />
          Stopped · step {Math.max(stepNum, 1)} of {totalSteps}
        </span>
      )}
      {status === "cancelled" && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11.5px] font-semibold text-muted-foreground">
          Cancelled
        </span>
      )}
    </>
  );

  const subtitle = (() => {
    const target = host ? (
      <span className="font-mono text-xs text-foreground">{host}</span>
    ) : (
      "your app's base URL"
    );
    if (status === "completed")
      return <>2-test demo built on {target} — pipeline complete.</>;
    if (status === "failed")
      return <>Run stopped — see the pipeline below for where it stalled.</>;
    if (isActive)
      return (
        <>
          Spinning up a 2-test demo on {target} — auth setup, walkthrough, video
          &amp; notes.
        </>
      );
    return (
      <>
        Spin up a 2-test demo on {target} — auth setup, walkthrough, video &amp;
        notes.
      </>
    );
  })();

  // ── Pipeline column ──────────────────────────────────────────────────────
  const pipelineColumn = session && (
    <div className="min-w-0 border-b bg-muted/20 p-5 lg:border-b-0 lg:border-r">
      <div className="mb-1.5 flex items-center justify-between">
        <Eyebrow>Pipeline</Eyebrow>
        <Eyebrow
          className={
            status === "completed" ? "text-success" : "text-foreground/40"
          }
        >
          {doneSteps} / {totalSteps}
        </Eyebrow>
      </div>
      <ol>
        {session.steps.map((step) => {
          const label = STEP_LABELS[step.id] ?? step.label;
          const pending = step.status === "pending";
          return (
            <li key={step.id} className="flex items-start gap-3 py-[7px]">
              <StepCircle status={step.status} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={
                      pending
                        ? "text-[13.5px] text-muted-foreground/70"
                        : step.status === "active"
                          ? "text-[13.5px] font-medium text-info"
                          : "text-[13.5px] font-medium text-foreground"
                    }
                  >
                    {label}
                  </span>
                  {step.id === "qs_scout_public" &&
                    publicScout?.classification &&
                    step.status === "completed" && (
                      <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                        {publicScout.classification.replace(/_/g, " ")}
                      </span>
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
                {step.status === "active" && step.id === "qs_auth_setup" && (
                  <div className="mt-0.5 text-xs leading-snug text-muted-foreground">
                    Filling credentials &amp; submitting login form…
                  </div>
                )}
                {step.status === "failed" && step.error && (
                  <p className="mt-0.5 line-clamp-3 text-[11px] text-destructive">
                    {step.error}
                  </p>
                )}
                {step.id === "qs_auth_setup" &&
                  authSetup?.captured === false &&
                  authSetup?.failureReason && (
                    <p className="mt-0.5 line-clamp-3 break-words text-[11px] text-warning/90">
                      {authSetup.failureReason}
                    </p>
                  )}
              </div>
            </li>
          );
        })}
      </ol>
      {usedEmail && (
        <div className="mt-3 truncate border-t pt-3 font-mono text-[10px] text-muted-foreground">
          as {usedEmail}
        </div>
      )}
    </div>
  );

  // ── Content column (live browser / report preview / failure) ─────────────
  const contentColumn = session && (
    <div className="flex min-w-0 flex-col gap-3 bg-muted/40 p-5">
      {showLive ? (
        <>
          <div className="flex items-center justify-between">
            <Eyebrow>Live browser stream</Eyebrow>
            <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-destructive">
              <LiveDot tone="destructive" />
              Live
            </span>
          </div>
          <Chrome url={host} trailing="reload">
            {streamUrl ? (
              // `fit` scales the 1280×720 canvas to the column width inside a
              // fixed 16:9 box — no layout shift vs. the placeholder.
              <BrowserViewer
                streamUrl={streamUrl}
                initialViewport={{ width: 1280, height: 720 }}
                interactive={false}
                fit
                hideToolbar
                hideStatusBar
                className="aspect-video w-full"
              />
            ) : queuedForBrowser ? (
              <div className="flex aspect-video items-center justify-center gap-2 text-[11px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Waiting for a browser from the pool…
              </div>
            ) : (
              <div className="flex aspect-video items-center justify-center px-4 text-center text-[11px] text-muted-foreground/70">
                The live browser appears here while the agent is driving it.
              </div>
            )}
          </Chrome>
          {activeStep && (
            <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
              <Terminal className="size-3 shrink-0" />↳{" "}
              {STEP_LABELS[activeStep.id] ?? activeStep.label}…
            </div>
          )}
        </>
      ) : shareUrl || demoNotes ? (
        <>
          <Eyebrow>Report preview</Eyebrow>
          {shareUrl ? (
            <ShareEmbed
              shareUrl={shareUrl}
              shareSlug={shareSlug}
              title={host ? `${host} · Lastest` : "Lastest visual QA report"}
              description={
                demoNotes?.uxSummary ??
                "Visual QA baseline — screenshots, layer checks, and demo notes."
              }
            />
          ) : (
            demoNotes && (
              <div className="overflow-hidden rounded-md border bg-card shadow-sm">
                <div className="max-h-[360px] overflow-auto">
                  <NotesBody notes={demoNotes} />
                </div>
              </div>
            )
          )}
          {(buildId || walkthroughTestId) && (
            <div className="flex flex-wrap items-center gap-2">
              {buildId && (
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/builds/${buildId}`}>Open build</Link>
                </Button>
              )}
              {walkthroughTestId && (
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/tests/${walkthroughTestId}`}>
                    Walkthrough test
                  </Link>
                </Button>
              )}
            </div>
          )}
        </>
      ) : status === "failed" ? (
        <>
          <Eyebrow>What happened</Eyebrow>
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-destructive">
              <AlertTriangle className="size-4" />
              Stopped at{" "}
              {failedStep
                ? (STEP_LABELS[failedStep.id] ?? failedStep.label)
                : "an early step"}
            </div>
            {failedStep?.error && (
              <p className="mt-2 text-xs leading-relaxed text-foreground/80">
                {failedStep.error}
              </p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Use <span className="font-medium">Retry</span> above to run again,
              or dismiss.
            </p>
          </div>
          {(buildId || walkthroughTestId) && (
            <div className="flex flex-wrap items-center gap-2">
              {buildId && (
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/builds/${buildId}`}>Open build</Link>
                </Button>
              )}
              {walkthroughTestId && (
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/tests/${walkthroughTestId}`}>
                    Walkthrough test
                  </Link>
                </Button>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <Eyebrow>Report preview</Eyebrow>
          <div className="flex aspect-video items-center justify-center rounded-md border border-dashed text-center text-[11px] text-muted-foreground/70">
            The run finished — open the build for full results.
          </div>
        </>
      )}
    </div>
  );

  // ── Footer ───────────────────────────────────────────────────────────────
  const footer = session && (
    <>
      {shareUrl ? (
        <div className="flex flex-wrap items-center gap-4 border-t bg-destructive/[0.03] p-4">
          <div className="min-w-0 flex-1">
            <Eyebrow className="flex items-center gap-1.5 text-destructive">
              <Share2 className="size-3" />
              Founder share ready
            </Eyebrow>
            <div className="mt-1.5 truncate font-mono text-xs text-foreground/80">
              {shareSlug
                ? `${host ?? "lastest.cloud"}/r/${shareSlug}`
                : shareUrl}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={copyShare}>
              <Copy className="mr-1.5 size-3.5" />
              Copy link
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a
                href={`https://x.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(host ? `Visual QA report for ${host}` : "Visual QA report")}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Share on X"
              >
                <XLogo className="mr-1.5 size-3" />
                Share on X
              </a>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a
                href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Share on LinkedIn"
              >
                <LinkedInLogo className="mr-1.5 size-3" />
                LinkedIn
              </a>
            </Button>
            <Button size="sm" asChild>
              <a href={shareUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-1.5 size-3.5" />
                Open report
              </a>
            </Button>
          </div>
        </div>
      ) : isActive ? (
        <div className="flex items-center gap-3 border-t bg-muted/20 p-4">
          <Share2 className="size-4 shrink-0 text-muted-foreground/50" />
          <span className="text-[12.5px] text-muted-foreground">
            Your founder share link &amp; report preview will appear here when
            the run finishes.
          </span>
          <div className="flex-1" />
          <div className="h-1.5 w-40 animate-pulse rounded-full bg-muted-foreground/20" />
        </div>
      ) : null}
    </>
  );

  return (
    <Card className="gap-0 overflow-hidden py-0">
      {/* Header */}
      <div className="flex items-center gap-4 border-b p-5">
        <div
          className={`flex size-[42px] shrink-0 items-center justify-center rounded-md ${tileClass}`}
        >
          <TileIcon
            className="size-5 text-background"
            strokeWidth={status === "completed" ? 3 : 2}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[17px] font-semibold text-foreground">
              QuickStart
            </span>
            {statusPill}
          </div>
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            {subtitle}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!session && (
            <Button
              size="sm"
              onClick={handleStart}
              disabled={loading || !repositoryId}
            >
              {loading ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Rocket className="mr-1.5 size-3.5" />
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
          {session && isTerminal && status !== "completed" && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleStart}
              disabled={loading || !repositoryId}
              title="Dismiss this run and start a fresh one"
            >
              {loading ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Rocket className="mr-1.5 size-3.5" />
              )}
              Retry
            </Button>
          )}
          {session && isTerminal && (
            <Button
              size="icon"
              variant="ghost"
              onClick={dismiss}
              title="Dismiss"
              className="size-8"
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      {session ? (
        <div className="grid lg:grid-cols-[340px_minmax(0,1fr)]">
          {pipelineColumn}
          {contentColumn}
        </div>
      ) : (
        // Pre-run: target URL (visible + editable) + optional app-login config.
        <div className="space-y-3 p-5">
          {/* Target URL — what QuickStart runs against. Editable inline so the
              user can see/change it without a sidebar detour. */}
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <Eyebrow>Target URL</Eyebrow>
                <div className="mt-0.5 truncate text-[13px]">
                  {host ? (
                    <>
                      QuickStart will run against{" "}
                      <span className="font-mono text-foreground">{host}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      No base URL set
                    </span>
                  )}
                </div>
              </div>
              {canInlineBaseUrl && !editingUrl && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0"
                  onClick={() => {
                    setBaseUrlInput(host ?? "");
                    setEditingUrl(true);
                  }}
                >
                  {host ? "Change" : "Set URL"}
                </Button>
              )}
            </div>
            {canInlineBaseUrl && editingUrl && (
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <Input
                  type="url"
                  inputMode="url"
                  placeholder="your-app.com"
                  aria-label="App base URL"
                  value={baseUrlInput}
                  onChange={(e) => setBaseUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      saveBaseUrl().then((ok) => ok && setEditingUrl(false));
                  }}
                  disabled={savingBaseUrl}
                  className="h-8"
                  autoFocus
                />
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    className="h-8"
                    onClick={() =>
                      saveBaseUrl().then((ok) => ok && setEditingUrl(false))
                    }
                    disabled={savingBaseUrl || !baseUrlInput.trim()}
                  >
                    {savingBaseUrl ? (
                      <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    ) : null}
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8"
                    onClick={() => setEditingUrl(false)}
                    disabled={savingBaseUrl}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowCreds((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <KeyRound className="size-3" />
            Use my app login (optional)
            <ChevronDown
              className={`size-3 transition-transform ${showCreds ? "rotate-180" : ""}`}
            />
          </button>
          {showCreds && (
            <div className="space-y-2 pt-1">
              <p className="text-[11px] text-muted-foreground">
                QuickStart runs against your app&rsquo;s base URL. Provide a
                working login to capture an authenticated walkthrough; leave
                blank to register a throwaway demo account instead. Credentials
                stay on your team and are never shown on the public share.
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
          )}
        </div>
      )}

      {footer}

      {error && (
        <p className="border-t px-5 py-3 text-xs text-destructive">{error}</p>
      )}
    </Card>
  );
}
