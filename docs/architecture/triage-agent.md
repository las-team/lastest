# Triage Agent (v1.15)

The Triage agent is the **single classifier** for build failures. It replaces the
two independent AI passes that used to run at build completion
(`src/lib/ai/diff-analyzer.ts` per diff, `src/lib/ai/failure-triage.ts` per
failed test) with one build-scoped agent that:

1. collects every failed / review-required case in a build,
2. clusters them by **root cause** (not by functional area),
3. writes a run-level narrative, per-group headline + note, and a suggested
   verdict per group,
4. populates the classification columns those two passes used to own, so
   downstream consumers (healer, RCA, verify board, diff UI) keep working.

Its UI is the **Run Results** screen, reached by drilling into the Triage row
on `/agents` — the same pattern as the QA agent and the Explorer.

## Placement

Core + pure model lib (mirrors the coverage split):

- `libs/triage-model/` — **pure**. Clustering heuristics, signal fusion,
  verdict-suggestion rules, group ordering, the run-summary shape. No DB, no
  clock, no AI client. Unit-testable in isolation.
- `src/lib/triage/` — **stateful**. Orchestration, persistence, agent-session
  lifecycle, the LLM calls, build-completion hook.
- `src/app/(app)/triage-agent/` — agent home + `[buildId]` Run Results screen.

Not a plugin: the agent's product is writing core-owned rows (`visual_diffs`,
`test_results`, `step_comparisons`, `baselines`), which a plugin cannot import.

## Gating

Pro plan only, via the existing `hasQaAgentAccess(team.plan, isBillingEnabled())`
— the same gate as `/agents` and `/qa-agent`. The auto-run **setting** is only
settable by teams that pass that gate; a team that downgrades keeps the row but
the setting reads as off.

## Trigger

Auto at build completion when:
- `failedCount > 0 || changesDetected > 0`, AND
- the repo's `triageAgentEnabled` setting is on, AND
- the team passes the Pro gate, AND
- in-product AI is enabled (`getInProductAiEnabled`).

Plus a manual "Re-triage this run" action.

## Verdict vocabulary

Reviewer verdicts on a case, in the shipped model's terms:

| Verdict | Mechanism |
|---|---|
| `bug` | `confirmCase('regression')` → typed GH issue `kind='bugfix'` |
| `improvement` | `confirmCase('improvement')` → typed GH issue `kind='improvement'` |
| `false_positive` | new — records the verdict, no issue |
| `flaky_retry` | new — records the verdict, queues a retry |
| `new_baseline` | existing approve-baseline path |
| snooze | `triageCaseVerdicts.snoozedUntil` |

There is **no assignment feature**. Ownership is expressed by filing or linking
a GitHub issue through the existing verify issue system
(`src/server/actions/verify-issues.ts`, `IssuePickerDialog`).

## Scope explicitly excluded

- Global "resolve all" across the whole run (per-group bulk only).
- A single concatenated failure video. The reel is a **queue** of the individual
  failed tests' recordings.
- Trimming clips to the failing moment.

## Contract between the parallel workstreams

`src/server/actions/triage.ts` is the single seam. Its signatures are fixed:

```ts
runTriageForBuild(buildId: string, opts?: { force?: boolean }): Promise<{ ok: boolean; triageRunId?: string; error?: string }>
recordTriageVerdict(input: { buildId; testId; stepLabel?: string | null; triageCaseId?: string; verdict: TriageVerdict; note?: string; snoozeDays?: number }): Promise<{ ok: boolean; error?: string }>
recordTriageGroupVerdict(input: { triageGroupId: string; verdict: TriageVerdict; note?: string }): Promise<{ ok: boolean; decided: number; error?: string }>
clearTriageVerdictAction(input: { buildId; testId; stepLabel?: string | null }): Promise<{ ok: boolean }>
retryFlakyCases(input: { buildId: string; testIds: string[] }): Promise<{ ok: boolean; buildId?: string; error?: string }>
setTriageAgentEnabled(repositoryId: string, enabled: boolean): Promise<{ ok: boolean; error?: string }>
```

`src/server/actions/triage-issues.ts` owns group-level GitHub filing and
delegates to the existing `src/server/actions/verify-issues.ts` primitives:

```ts
createIssueForTriageGroup(input: { triageGroupId: string; title?: string; reviewerNote?: string; includedLayers?: EvidenceLayer[] }): Promise<IssueResult>
linkIssueToTriageGroup(input: { triageGroupId: string; issueNumber: number }): Promise<IssueResult>
searchIssuesForTriageGroup(triageGroupId: string, query: string): Promise<{ ok: boolean; issues?: GitHubIssueListItem[]; error?: string }>
```

Ownership, to avoid collisions:

| Stream | Owns |
|---|---|
| Engine | `libs/triage-model/src/assess.ts`, `src/lib/triage/**`, `src/lib/ai/triage-agent/**`, bodies of `src/server/actions/triage.ts`, retirement of the two old classifiers |
| Console | `src/lib/agents/fleet.ts`, `src/components/agents/**`, `src/app/(app)/triage-agent/page.tsx`, `src/app/api/triage-agent/**`, nav + settings card |
| Run Results | `src/app/(app)/triage-agent/[buildId]/**`, `src/components/triage/**` except the two files below |
| Video + Issues | `src/components/triage/triage-video-queue.tsx`, `src/components/triage/triage-issue-actions.tsx`, `src/server/actions/triage-issues.ts` |

The Run Results stream mounts the Video+Issues components by these exact paths
and prop contracts:

```tsx
<TriageVideoQueue clips={TriageClip[]} initialIndex={number} onSelectCase={(caseId: string) => void} />
// TriageClip = { caseId, testId, title, src, posterSrc, durationMs, status, segments? }

<TriageIssueActions group={{ id, headline, githubIssueUrl, githubIssueNumber, githubIssueState, githubIssueKind }} caseCount={number} />
```
