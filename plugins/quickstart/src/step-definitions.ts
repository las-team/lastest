import type { QuickstartStepId, QuickstartStepState } from "./types";

/**
 * Pure step-definition data + the initial-state builder, split out of
 * `actions.ts` (a `"use server"` module) because Next.js requires every
 * top-level export of a `"use server"` file to be an async function —
 * `buildInitialQsSteps` never had a reason to be one, it just builds a plain
 * array in memory.
 */
export const QS_STEP_DEFINITIONS: Array<{
  id: QuickstartStepId;
  label: string;
  description: string;
}> = [
  {
    id: "qs_preflight",
    label: "Preflight",
    description: "Verify repo, baseUrl, AI provider, and console-error mode",
  },
  {
    id: "qs_scout_public",
    label: "Public Scout",
    description: "Browse the landing page and classify the sign-up flow",
  },
  {
    id: "qs_auth_setup",
    label: "Auth Setup",
    description: "Register a demo user and capture the storage state",
  },
  {
    id: "qs_scout_authed",
    label: "Authed Scout",
    description: "Walk the in-app surface as the demo user",
  },
  {
    id: "qs_generate",
    label: "Generate Walkthrough",
    description: "Author the walkthrough test from scout results",
  },
  {
    id: "qs_run_and_notes",
    label: "Run & Notes",
    description: "Run the build with video and write demo notes",
  },
  {
    id: "qs_approve_baselines",
    label: "Approve Baselines",
    description: "Accept first-run baselines so the share looks clean",
  },
  {
    id: "qs_rerun_after_approval",
    label: "Rerun for Pairing",
    description:
      "Re-run walkthrough so authed shots pair with their own baselines",
  },
  {
    id: "qs_publish_share",
    label: "Publish Share",
    description: "Publish the founder-facing /r/<slug> share URL",
  },
];

export const QS_STEP_ORDER: QuickstartStepId[] = QS_STEP_DEFINITIONS.map(
  (s) => s.id,
);

// Used by integration tests to drive a quickstart run without a session —
// `startQuickstart` gates on `contextFor`, which needs a real request.
export function buildInitialQsSteps(): QuickstartStepState[] {
  return QS_STEP_DEFINITIONS.map((def) => ({
    id: def.id,
    status: "pending" as const,
    label: def.label,
    description: def.description,
  }));
}
