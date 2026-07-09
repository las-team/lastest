import Link from "next/link";
import type { TeamPlan } from "@/lib/db/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Bot,
  CheckCircle2,
  FileCode,
  LayoutDashboard,
  Loader2,
  Lock,
  Sparkles,
  Zap,
} from "lucide-react";

// Locked view shown on /qa-agent to teams below the required plan. It sells the
// feature by previewing exactly what a run looks like — the live agent flow and
// the coverage dashboard it produces — rendered as a static, non-interactive
// snapshot behind the upgrade CTA. The real UI lives in qa-agent-client.tsx;
// this mirrors its visual language so the preview reads as the genuine article.

const AGENT_BADGE_STYLES: Record<string, string> = {
  orchestrator: "bg-primary/10 text-primary border-primary/30",
  planner: "bg-info/10 text-info border-info/30",
  scout: "bg-success/10 text-success border-success/30",
  ranger: "bg-success/10 text-success border-success/30",
  generator: "bg-warning/10 text-warning border-warning/30",
  healer: "bg-destructive/10 text-destructive border-destructive/30",
};

type PreviewState = "completed" | "active" | "pending";

const PREVIEW_PHASES: Array<{
  label: string;
  state: PreviewState;
  lock?: boolean;
}> = [
  { label: "Preflight", state: "completed" },
  { label: "Login", state: "completed", lock: true },
  { label: "Discover", state: "completed" },
  { label: "Plan", state: "completed" },
  { label: "Review", state: "completed" },
  { label: "Generate", state: "active" },
  { label: "Execute", state: "pending" },
  { label: "Heal", state: "pending" },
  { label: "Summary", state: "pending" },
];

const PREVIEW_SUBSTEPS: Array<{
  agent: string;
  label: string;
  detail: string;
  state: "done" | "running";
}> = [
  {
    agent: "scout",
    label: "Static route scan",
    detail: "42 routes (Next.js) · branch main",
    state: "done",
  },
  {
    agent: "ranger",
    label: "Live crawl",
    detail: "6 pages mapped, 18 API calls observed, logged in",
    state: "done",
  },
  {
    agent: "planner",
    label: "Test plan designed",
    detail: "5 journeys, 24 test items across 6 groups",
    state: "done",
  },
  {
    agent: "generator",
    label: "Generating “Checkout — place order” smoke test…",
    detail: "18 of 24 items generated",
    state: "running",
  },
];

const PREVIEW_STATS: Array<{ label: string; value: number }> = [
  { label: "Planned", value: 24 },
  { label: "Covered", value: 5 },
  { label: "Generated", value: 19 },
  { label: "Passing", value: 17 },
  { label: "Gaps", value: 0 },
];

const PREVIEW_GROUPS: Array<{ label: string; detail: string }> = [
  { label: "Business journeys", detail: "4/4 generated · 4 passing" },
  { label: "Smoke", detail: "6/6 generated · 6 passing" },
  { label: "UI", detail: "5/5 generated · 4 passing" },
  { label: "API", detail: "3/3 generated · 3 passing" },
  { label: "Accessibility", detail: "2 covered · 1/1 generated" },
];

const PREVIEW_TESTS: Array<{ name: string; status: "passed" | "generated" }> = [
  { name: "Sign up → onboard → reach dashboard", status: "passed" },
  { name: "Checkout — place order end to end", status: "passed" },
  { name: "Invite teammate and accept invite", status: "generated" },
];

function PreviewDot({ state }: { state: PreviewState }) {
  if (state === "completed")
    return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (state === "active")
    return <Loader2 className="h-4 w-4 text-info animate-spin" />;
  return (
    <span className="block h-4 w-4 rounded-full border border-muted-foreground/30" />
  );
}

/** Static replica of the live agent flow (PhaseTimeline). */
function FlowPreview() {
  return (
    <Card>
      <CardContent className="space-y-4 pt-4">
        <div className="flex items-start gap-0 overflow-x-auto pb-1">
          {PREVIEW_PHASES.map((phase, i) => (
            <div key={phase.label} className="flex min-w-0 items-start">
              {i > 0 && (
                <div
                  className={`mt-2 h-px w-5 shrink-0 sm:w-8 ${
                    phase.state === "pending" ? "bg-border" : "bg-success/50"
                  }`}
                />
              )}
              <div className="flex min-w-14 flex-col items-center gap-1 px-1">
                <PreviewDot state={phase.state} />
                <span
                  className={`text-center text-[11px] leading-tight ${
                    phase.state === "active"
                      ? "font-medium text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {phase.lock && (
                    <Lock className="mr-0.5 inline h-3 w-3 align-[-1px]" />
                  )}
                  {phase.label}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-1 rounded-md border bg-muted/30 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Loader2 className="h-4 w-4 animate-spin text-info" />
            Generate
            <span className="text-xs font-normal text-muted-foreground">
              Generate tests per plan item with live selector verification
            </span>
          </div>
          <div>
            {PREVIEW_SUBSTEPS.map((substep) => (
              <div
                key={substep.label}
                className="flex items-start gap-2 py-0.5 text-sm"
              >
                <span className="mt-0.5 shrink-0">
                  {substep.state === "running" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-info" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  )}
                </span>
                <Badge
                  variant="outline"
                  className={`shrink-0 px-1.5 text-[10px] ${AGENT_BADGE_STYLES[substep.agent] ?? ""}`}
                >
                  {substep.agent}
                </Badge>
                <span className="min-w-0">
                  <span className="truncate">{substep.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {substep.detail}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Static replica of the finished-run coverage dashboard (QaSummaryPanel). */
function DoneScreenPreview() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <LayoutDashboard className="h-4 w-4" />
          Coverage dashboard
          <span className="text-xs font-normal text-muted-foreground">
            — what a completed run leaves behind
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {PREVIEW_STATS.map((stat) => (
            <div key={stat.label} className="rounded-md border p-3 text-center">
              <div className="text-2xl font-semibold">{stat.value}</div>
              <div className="text-xs text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>

        <div className="space-y-1">
          <h4 className="text-sm font-medium">By group</h4>
          <div className="divide-y rounded-md border">
            {PREVIEW_GROUPS.map((group) => (
              <div
                key={group.label}
                className="flex items-center justify-between px-3 py-1.5 text-sm"
              >
                <span>{group.label}</span>
                <span className="text-xs text-muted-foreground">
                  {group.detail}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <h4 className="flex items-center gap-2 text-sm font-medium">
            <FileCode className="h-4 w-4" />
            Generated tests
          </h4>
          <div className="space-y-1">
            {PREVIEW_TESTS.map((test) => (
              <div
                key={test.name}
                className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
              >
                <Badge
                  variant="outline"
                  className={`shrink-0 gap-1 px-1.5 text-[10px] ${
                    test.status === "passed"
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-border bg-muted text-muted-foreground"
                  }`}
                >
                  {test.status === "passed" ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : (
                    <FileCode className="h-3 w-3" />
                  )}
                  {test.status === "passed" ? "Passed" : "Generated"}
                </Badge>
                <span className="flex-1 truncate">{test.name}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function QaAgentUpgradeGate({
  currentPlanName,
  requiredPlanName,
}: {
  /** Display name of the team's current plan (e.g. "Free"). */
  currentPlanName: string;
  /** Display name of the plan required to unlock (e.g. "Pro"). */
  requiredPlanName: string;
}) {
  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Bot className="h-6 w-6" />
            QA Agent
          </h1>
          <p className="text-sm text-muted-foreground">
            An orchestrated agent team — scout, planner, generator, healer —
            that discovers your app, plans coverage against testing best
            practices, and builds a complete E2E suite you can watch and steer.
          </p>
        </header>

        {/* Upgrade CTA */}
        <Card className="overflow-hidden border-primary/30">
          <CardContent className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-3">
              <Badge
                variant="outline"
                className="gap-1.5 border-primary/30 bg-primary/10 text-primary"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {requiredPlanName} feature
              </Badge>
              <div className="space-y-1">
                <h2 className="text-xl font-semibold">
                  Unlock the QA Agent with {requiredPlanName}
                </h2>
                <p className="max-w-xl text-sm text-muted-foreground">
                  Your team is on the {currentPlanName} plan. Upgrade to{" "}
                  {requiredPlanName} to let the agent crawl your app, design a
                  best-practices test plan, and generate, run, and heal a full
                  E2E suite — all from a single target URL.
                </p>
              </div>
              <ul className="grid gap-1.5 text-sm text-muted-foreground sm:grid-cols-2">
                {[
                  "Auto-discovers pages, forms & API endpoints",
                  "Risk-prioritized plan you approve before it builds",
                  "Generates journey, smoke, UI, API & a11y tests",
                  "Runs the suite and self-heals failing tests",
                ].map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:w-48">
              <Button asChild size="lg" className="w-full">
                <Link href="/settings/billing">
                  <Zap className="h-4 w-4" />
                  Upgrade to {requiredPlanName}
                </Link>
              </Button>
              <Button asChild variant="ghost" size="sm" className="w-full">
                <Link href="/settings/billing">Compare all plans</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Preview of the real experience */}
        <div aria-hidden className="pointer-events-none select-none space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Preview
            </span>
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">
              A sample run — not your data
            </span>
          </div>
          <FlowPreview />
          <DoneScreenPreview />
        </div>
      </div>
    </div>
  );
}
