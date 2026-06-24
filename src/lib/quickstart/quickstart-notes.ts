/**
 * Generate demo notes for a QuickStart run from facts captured during the
 * scout phases + the build outcome. Pass facts in, get prose out — never
 * invent observations.
 */

import * as queries from "@/lib/db/queries";
import { generateWithAI } from "@/lib/ai";
import { getAIConfig } from "@/lib/playwright/agent-context";
import type {
  DemoNotes,
  DemoNoteItem,
  DemoNoteSkippedRoute,
  QuickstartPublicScout,
  QuickstartAuthedScout,
  QuickstartAuthSetupMeta,
} from "@/lib/db/schema";

export interface QuickstartRunFacts {
  passedCount: number;
  failedCount: number;
  changesDetected: number;
  testNames: string[];
  consoleErrors: string[];
  failedSteps: Array<{ test: string; step: string; error: string }>;
}

export interface GenerateDemoNotesInput {
  repositoryId: string;
  productName: string;
  publicScout: QuickstartPublicScout;
  authedScout?: QuickstartAuthedScout;
  authSetup?: QuickstartAuthSetupMeta;
  runFacts: QuickstartRunFacts;
  /** True when the captured login session was successfully captured but did NOT
   *  replay as authenticated on the test runner, so the walkthrough was
   *  downgraded to public-only. Distinct from authSetup.captured=false (capture
   *  itself failed). Surfaced as a testingStruggles item. */
  authVerificationFailed?: boolean;
}

const SYSTEM_PROMPT = `You are writing the demo notes for a Lastest visual-regression baseline run of a SaaS product. These notes are the qualitative counterpart to the screenshots — the part that says "we actually looked, here's what we noticed." The founder reads them on a public share, so they must be specific, accurate, and genuinely useful.

QUALITY BAR (this is what separates good notes from generic ones):
- Specific over generic. "Three pricing tiers, each with one differentiator headline, no 'contact sales' tier" beats "clear pricing". Name the actual route, element, label, or count whenever the facts contain it (publicNavRoutes, businessInteraction, safeCtas, friction notes).
- Quantify when the facts allow it (screenshot count, route count, a timing a friction note mentions). NEVER invent a number, route, or feature.
- Where a friction point has an obvious one-line fix, say it (e.g. "/signup 404s but /sign-up works — add a redirect").
- Conversational and concrete. No marketing fluff, no hedging, no filler.

RULES:
- Pass facts ONLY. Do NOT invent features, routes, timings, or issues the input did not contain. If a section has little real signal, return fewer items (or an empty array) — do not pad.
- uxSummary: 2-3 sentences. Lead with what the product actually does (from concept / businessInteraction — the primary input + CTA tell you the core job). Then point to the single strongest UX signal in the facts.
- highlights: 1-4 things the founder should be proud of, each tied to a concrete observation and safe to quote in outreach.
- frictionPoints: 0-3 real UX issues observed (cookie-banner overlap, slow route, console-noisy analytics, confusing empty state, guessable-URL 404). Product-facing — never shown in outreach.
- testingStruggles: 0-3 things that made automated testing hard (captcha, verify-email gate, OAuth-only, OTP, hung networkidle, an auth session that wouldn't replay). Empty array if the run was clean.
- skippedRoutes: 0-N routes the agent meant to visit but couldn't, each with the reason.

OUTPUT STRICT JSON, no markdown, exactly this shape:
{
  "uxSummary": "string",
  "highlights": [{ "label": "string", "note": "string" }],
  "frictionPoints": [{ "label": "string", "note": "string" }],
  "testingStruggles": [{ "label": "string", "note": "string" }],
  "skippedRoutes": [{ "path": "string", "reason": "string" }]
}

EXAMPLE — match this specificity and voice, do NOT copy its content:
{
  "uxSummary": "Postbox is a transactional-email API for indie developers; the hero leads with a strong 'send your first email in 4 lines' tagline. The pricing table is unusually clean for an indie product, and the register page is a single minimal column.",
  "highlights": [
    { "label": "Pricing clarity", "note": "Three tiers, each with one differentiator headline and no 'contact sales' tier — a strong signal for an indie audience." },
    { "label": "Empty-state copy", "note": "The /dashboard zero-state ships with working sample data, so a new user skips the 'now what?' moment." }
  ],
  "frictionPoints": [
    { "label": "Cookie banner overlap", "note": "The consent banner covers the hero CTA on first paint; dismissed before the screenshot." }
  ],
  "testingStruggles": [
    { "label": "Captcha on register", "note": "An hCaptcha iframe rendered after submit, so the auth phase fell back to public-only." }
  ],
  "skippedRoutes": [
    { "path": "/dashboard", "reason": "Couldn't authenticate past the captcha." }
  ]
}`;

function dedupeItems(items: DemoNoteItem[]): DemoNoteItem[] {
  const seen = new Set<string>();
  const out: DemoNoteItem[] = [];
  for (const item of items) {
    const key = item.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function asNoteItems(value: unknown): DemoNoteItem[] {
  if (!Array.isArray(value)) return [];
  const out: DemoNoteItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.label !== "string" || typeof obj.note !== "string") continue;
    out.push({ label: obj.label, note: obj.note });
  }
  return out;
}

function asSkippedRoutes(value: unknown): DemoNoteSkippedRoute[] {
  if (!Array.isArray(value)) return [];
  const out: DemoNoteSkippedRoute[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.path !== "string" || typeof obj.reason !== "string")
      continue;
    out.push({ path: obj.path, reason: obj.reason });
  }
  return out;
}

function buildFactsBlock(input: GenerateDemoNotesInput): string {
  const facts: Record<string, unknown> = {
    productName: input.productName,
    concept: input.publicScout.concept ?? null,
    tagline: input.publicScout.tagline ?? null,
    // The primary input + CTA the product is built around — the single best
    // "what does this actually do" signal for the uxSummary lead sentence.
    businessInteraction: input.publicScout.businessInteraction ?? null,
    authClassification: input.publicScout.classification,
    authAutomatable: input.publicScout.authAutomatable,
    publicNavRoutes: input.publicScout.navLinks.map((n) => n.path),
    cookieBannerSeen: !!input.publicScout.cookieBannerSelectorHint,
    publicFriction: input.publicScout.friction ?? [],
    authedNavRoutes: input.authedScout?.inAppNavLinks.map((n) => n.path) ?? [],
    authedObservedRoutes: input.authedScout?.observedRoutes ?? [],
    safeCtas: input.authedScout?.safeCtaCandidates.map((c) => c.label) ?? [],
    authedFriction: input.authedScout?.friction ?? [],
    authSetupCaptured: input.authSetup?.captured ?? false,
    authSetupMode: input.authSetup?.mode ?? null,
    authSetupFailureReason: input.authSetup?.failureReason ?? null,
    authVerificationFailed: input.authVerificationFailed ?? false,
    runResults: {
      passed: input.runFacts.passedCount,
      failed: input.runFacts.failedCount,
      changesDetected: input.runFacts.changesDetected,
      tests: input.runFacts.testNames,
    },
    consoleErrors: input.runFacts.consoleErrors.slice(0, 5),
    failedSteps: input.runFacts.failedSteps.slice(0, 5),
  };
  return JSON.stringify(facts, null, 2);
}

export async function generateDemoNotes(
  input: GenerateDemoNotesInput,
  options?: { onLogCreated?: (logId: string) => void },
): Promise<DemoNotes> {
  const settings = await queries.getAISettings(input.repositoryId);
  const config = getAIConfig(settings);

  const prompt = `Facts captured for ${input.productName}:

\`\`\`json
${buildFactsBlock(input)}
\`\`\`

Produce the demo notes JSON.`;

  let parsed: Record<string, unknown> = {};
  let modelId: string | undefined;
  try {
    const response = await generateWithAI(config, prompt, SYSTEM_PROMPT, {
      repositoryId: input.repositoryId,
      actionType: "agent_discover",
      onLogCreated: options?.onLogCreated,
      responseFormat: "json_object",
    });
    const fence = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const json = JSON.parse((fence?.[1] ?? response).trim());
    if (json && typeof json === "object")
      parsed = json as Record<string, unknown>;
    modelId =
      config.openrouterModel ??
      config.anthropicModel ??
      config.openaiModel ??
      config.provider;
  } catch {
    // Defensive: keep going with what we have so the build still gets notes.
  }

  const fallbackTesting: DemoNoteItem[] = [];
  if (
    input.authSetup &&
    !input.authSetup.captured &&
    input.authSetup.failureReason
  ) {
    fallbackTesting.push({
      label: "Auth setup blocked",
      note: input.authSetup.failureReason,
    });
  }
  if (input.authVerificationFailed) {
    fallbackTesting.push({
      label: "Login session could not be verified",
      note: "The captured login session did not replay as authenticated on the test runner, so the walkthrough ran in public-only mode. This usually means the session expired or is stored where replay can't reach it (e.g. IndexedDB). Re-run, or supply working login credentials for the app.",
    });
  }
  if (
    !input.publicScout.authAutomatable &&
    input.publicScout.classification !== "no_public_register"
  ) {
    fallbackTesting.push({
      label: `Sign-up flow: ${input.publicScout.classification.replace(/_/g, " ")}`,
      note: "Walkthrough ran in public-only mode — no in-app surface captured.",
    });
  }

  const summary =
    typeof parsed.uxSummary === "string" && parsed.uxSummary.length > 0
      ? parsed.uxSummary
      : input.publicScout.concept
        ? `${input.productName}: ${input.publicScout.concept}`
        : `${input.productName}: ${input.runFacts.passedCount} test${input.runFacts.passedCount === 1 ? "" : "s"} passed, ${input.runFacts.changesDetected} screenshots captured.`;

  return {
    uxSummary: summary,
    highlights: dedupeItems(asNoteItems(parsed.highlights)).slice(0, 4),
    frictionPoints: dedupeItems(asNoteItems(parsed.frictionPoints)).slice(0, 4),
    testingStruggles: dedupeItems([
      ...asNoteItems(parsed.testingStruggles),
      ...fallbackTesting,
    ]).slice(0, 4),
    skippedRoutes: asSkippedRoutes(parsed.skippedRoutes).slice(0, 6),
    generatedAt: new Date().toISOString(),
    modelId,
  };
}
