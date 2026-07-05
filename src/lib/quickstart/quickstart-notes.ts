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
  /** Top axe rule violations, pre-formatted "rule-id (offending nodes)" e.g.
   *  "color-contrast (8)". Lets the notes cite the SAME evidence the share's
   *  WCAG panel shows, so findings in prose and UI tell one story (spec §3.6). */
  a11yTopRules?: string[];
}

export interface GenerateDemoNotesInput {
  repositoryId: string;
  productName: string;
  /** Absent in reduced-facts mode (standalone notes for a non-QuickStart build,
   *  where no scout ever ran). The prompt then leans on run results, visited
   *  routes, and console errors only. */
  publicScout?: QuickstartPublicScout;
  authedScout?: QuickstartAuthedScout;
  authSetup?: QuickstartAuthSetupMeta;
  runFacts: QuickstartRunFacts;
  /** Reduced-facts mode only: routes/steps actually visited, recovered from the
   *  run's step labels — the scout-less stand-in for publicNavRoutes. */
  routesVisited?: string[];
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

VOICE — write TO the founder, not about the site:
- Second person for their product: "your pricing page", "your onboarding", "your empty state". Never "the site's pricing page".
- "We" for Lastest's actions: "we recorded", "we noticed", "we couldn't get past". Never passive "it was observed".

RULES:
- Pass facts ONLY. Do NOT invent features, routes, timings, or issues the input did not contain. If a section has little real signal, return fewer items (or an empty array) — do not pad.
- When scoutRan is false (reduced-facts mode), base everything on runResults, routesVisited, and consoleErrors — do not speculate about what the product does beyond its name.
- uxSummary: 2-3 sentences. Lead with what the product actually does (from concept / businessInteraction — the primary input + CTA tell you the core job). Then point to the single strongest UX signal in the facts.
- highlights: 1-4 things the founder should be proud of, each tied to a concrete observation and safe to quote in outreach.
- frictionPoints: max 2 real UX issues. These ARE public on the share and read by the founder — findings build credibility. Each MUST come with a one-line fix, written in a "fixable, not embarrassing" tone (e.g. "/signup 404s but /sign-up works — add a redirect"). Nothing security-sensitive, nothing that reads as public shaming.
- testingStruggles: 0-3 things that made automated testing hard (captcha, verify-email gate, OAuth-only, OTP, hung networkidle, an auth session that wouldn't replay). Empty array if the run was clean.
- skippedRoutes: 0-N routes the agent meant to visit but couldn't, each with the reason.
- outreachHook: ONE sentence, max 200 characters, leading with the single most striking SPECIFIC observation — it becomes the first line of the X reply/DM to the founder. It MUST reference a concrete route, label, or number from the facts. NO marketing adjectives (no "amazing", "sleek", "beautiful").

OUTPUT STRICT JSON, no markdown, exactly this shape:
{
  "uxSummary": "string",
  "highlights": [{ "label": "string", "note": "string" }],
  "frictionPoints": [{ "label": "string", "note": "string" }],
  "testingStruggles": [{ "label": "string", "note": "string" }],
  "skippedRoutes": [{ "path": "string", "reason": "string" }],
  "outreachHook": "string"
}

EXAMPLE — match this specificity and voice, do NOT copy its content:
{
  "uxSummary": "Postbox is a transactional-email API for indie developers; your hero leads with a strong 'send your first email in 4 lines' tagline. Your pricing table is unusually clean for an indie product, and the register page is a single minimal column.",
  "highlights": [
    { "label": "Pricing clarity", "note": "Three tiers, each with one differentiator headline and no 'contact sales' tier — a strong signal for an indie audience." },
    { "label": "Empty-state copy", "note": "Your /dashboard zero-state ships with working sample data, so a new user skips the 'now what?' moment." }
  ],
  "frictionPoints": [
    { "label": "Cookie banner overlap", "note": "The consent banner covers your hero CTA on first paint — anchoring it bottom-left (or delaying it a beat) frees the CTA." }
  ],
  "testingStruggles": [
    { "label": "Captcha on register", "note": "An hCaptcha iframe rendered after submit, so the auth phase fell back to public-only." }
  ],
  "skippedRoutes": [
    { "path": "/dashboard", "reason": "Couldn't authenticate past the captcha." }
  ],
  "outreachHook": "We ran your signup + all 5 nav routes on postbox.dev — the /dashboard zero-state with live sample data was the standout; one fixable snag on the hero CTA."
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
  const scout = input.publicScout;
  const facts: Record<string, unknown> = {
    productName: input.productName,
    // Reduced-facts mode (no scout): the model must lean on run results,
    // visited routes, and console errors only — flag it so it doesn't try to
    // infer a concept that was never observed.
    scoutRan: !!scout,
    concept: scout?.concept ?? null,
    tagline: scout?.tagline ?? null,
    // The primary input + CTA the product is built around — the single best
    // "what does this actually do" signal for the uxSummary lead sentence.
    businessInteraction: scout?.businessInteraction ?? null,
    productArchetype: scout?.productArchetype ?? null,
    authClassification: scout?.classification ?? null,
    authAutomatable: scout?.authAutomatable ?? false,
    publicNavRoutes: scout?.navLinks.map((n) => n.path) ?? [],
    routesVisited: input.routesVisited ?? [],
    cookieBannerSeen: !!scout?.cookieBannerSelectorHint,
    publicFriction: scout?.friction ?? [],
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
    // Top accessibility rule violations (rule-id + occurrence count). Only cite
    // these if a frictionPoint genuinely traces to them — never manufacture an
    // a11y complaint the founder didn't ask about.
    accessibilityTopRules: input.runFacts.a11yTopRules?.slice(0, 3) ?? [],
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
    input.publicScout &&
    !input.publicScout.authAutomatable &&
    input.publicScout.classification !== "no_public_register"
  ) {
    fallbackTesting.push({
      label: `Sign-up flow: ${input.publicScout.classification.replace(/_/g, " ")}`,
      note: "Walkthrough ran in public-only mode — no in-app surface captured.",
    });
  }

  const aiSummary =
    typeof parsed.uxSummary === "string" && parsed.uxSummary.length > 0
      ? parsed.uxSummary
      : null;
  const summary =
    aiSummary ??
    (input.publicScout?.concept
      ? `${input.productName}: ${input.publicScout.concept}`
      : `${input.productName}: ${input.runFacts.passedCount} test${input.runFacts.passedCount === 1 ? "" : "s"} passed, ${input.runFacts.changesDetected} screenshots captured.`);

  const outreachHook =
    typeof parsed.outreachHook === "string" && parsed.outreachHook.length > 0
      ? parsed.outreachHook.slice(0, 200)
      : undefined;

  return {
    uxSummary: summary,
    highlights: dedupeItems(asNoteItems(parsed.highlights)).slice(0, 4),
    // Friction is public + founder-read: cap at 2 (matches the prompt) so the
    // panel reads as "two fixable observations", never a defect list.
    frictionPoints: dedupeItems(asNoteItems(parsed.frictionPoints)).slice(0, 2),
    testingStruggles: dedupeItems([
      ...asNoteItems(parsed.testingStruggles),
      ...fallbackTesting,
    ]).slice(0, 4),
    skippedRoutes: asSkippedRoutes(parsed.skippedRoutes).slice(0, 6),
    outreachHook,
    // Marks the deterministic fallback summary so the share-readiness gate can
    // tell a real AI write-up from boilerplate.
    fallbackSummary: !aiSummary || undefined,
    generatedAt: new Date().toISOString(),
    modelId,
  };
}
