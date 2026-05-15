/**
 * Generate demo notes for a QuickStart run from facts captured during the
 * scout phases + the build outcome. Pass facts in, get prose out — never
 * invent observations.
 */

import * as queries from '@/lib/db/queries';
import { generateWithAI } from '@/lib/ai';
import { getAIConfig } from '@/lib/playwright/agent-context';
import type {
  DemoNotes,
  DemoNoteItem,
  DemoNoteSkippedRoute,
  QuickstartPublicScout,
  QuickstartAuthedScout,
  QuickstartAuthSetupMeta,
} from '@/lib/db/schema';

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
}

const SYSTEM_PROMPT = `You are summarising a Lastest visual-regression baseline run for a SaaS product. Generate the demo notes.

RULES:
- Pass facts only. Do NOT invent features the input did not mention.
- uxSummary: 2-3 sentences, conversational, in your own words. Lead with the product's concept (from publicScout.concept). Mention one strong UX signal if present.
- highlights: 2-4 items the founder would be proud of (clear pricing, polished empty state, fast load, etc.). Safe-for-outreach quality.
- frictionPoints: 1-3 UX issues observed during the walk. Cookie banner overlap, slow blog index, console-noisy analytics, that kind of thing.
- testingStruggles: 0-3 items. Captcha, verify-email gates, OAuth-only flows, OTP, hung networkidle. Empty array if none.
- skippedRoutes: 0-N items. Routes the agent intended to visit but didn't (auth blocked, 404, hang).

OUTPUT STRICT JSON, no markdown, exactly this shape:
{
  "uxSummary": "string",
  "highlights": [{ "label": "string", "note": "string" }],
  "frictionPoints": [{ "label": "string", "note": "string" }],
  "testingStruggles": [{ "label": "string", "note": "string" }],
  "skippedRoutes": [{ "path": "string", "reason": "string" }]
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
    if (!raw || typeof raw !== 'object') continue;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.label !== 'string' || typeof obj.note !== 'string') continue;
    out.push({ label: obj.label, note: obj.note });
  }
  return out;
}

function asSkippedRoutes(value: unknown): DemoNoteSkippedRoute[] {
  if (!Array.isArray(value)) return [];
  const out: DemoNoteSkippedRoute[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.path !== 'string' || typeof obj.reason !== 'string') continue;
    out.push({ path: obj.path, reason: obj.reason });
  }
  return out;
}

function buildFactsBlock(input: GenerateDemoNotesInput): string {
  const facts: Record<string, unknown> = {
    productName: input.productName,
    concept: input.publicScout.concept ?? null,
    tagline: input.publicScout.tagline ?? null,
    authClassification: input.publicScout.classification,
    authAutomatable: input.publicScout.authAutomatable,
    publicNavRoutes: input.publicScout.navLinks.map(n => n.path),
    cookieBannerSeen: !!input.publicScout.cookieBannerSelectorHint,
    publicFriction: input.publicScout.friction ?? [],
    authedNavRoutes: input.authedScout?.inAppNavLinks.map(n => n.path) ?? [],
    authedObservedRoutes: input.authedScout?.observedRoutes ?? [],
    safeCtas: input.authedScout?.safeCtaCandidates.map(c => c.label) ?? [],
    authedFriction: input.authedScout?.friction ?? [],
    authSetupCaptured: input.authSetup?.captured ?? false,
    authSetupFailureReason: input.authSetup?.failureReason ?? null,
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
      actionType: 'agent_discover',
      onLogCreated: options?.onLogCreated,
      responseFormat: 'json_object',
    });
    const fence = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const json = JSON.parse((fence?.[1] ?? response).trim());
    if (json && typeof json === 'object') parsed = json as Record<string, unknown>;
    modelId = config.openrouterModel ?? config.anthropicModel ?? config.openaiModel ?? config.provider;
  } catch {
    // Defensive: keep going with what we have so the build still gets notes.
  }

  const fallbackTesting: DemoNoteItem[] = [];
  if (input.authSetup && !input.authSetup.captured && input.authSetup.failureReason) {
    fallbackTesting.push({
      label: 'Auth setup blocked',
      note: input.authSetup.failureReason,
    });
  }
  if (!input.publicScout.authAutomatable && input.publicScout.classification !== 'no_public_register') {
    fallbackTesting.push({
      label: `Sign-up flow: ${input.publicScout.classification.replace(/_/g, ' ')}`,
      note: 'Walkthrough ran in public-only mode — no in-app surface captured.',
    });
  }

  const summary = typeof parsed.uxSummary === 'string' && parsed.uxSummary.length > 0
    ? parsed.uxSummary
    : input.publicScout.concept
      ? `${input.productName}: ${input.publicScout.concept}`
      : `${input.productName}: ${input.runFacts.passedCount} test${input.runFacts.passedCount === 1 ? '' : 's'} passed, ${input.runFacts.changesDetected} screenshots captured.`;

  return {
    uxSummary: summary,
    highlights: dedupeItems(asNoteItems(parsed.highlights)).slice(0, 4),
    frictionPoints: dedupeItems(asNoteItems(parsed.frictionPoints)).slice(0, 4),
    testingStruggles: dedupeItems([...asNoteItems(parsed.testingStruggles), ...fallbackTesting]).slice(0, 4),
    skippedRoutes: asSkippedRoutes(parsed.skippedRoutes).slice(0, 6),
    generatedAt: new Date().toISOString(),
    modelId,
  };
}
