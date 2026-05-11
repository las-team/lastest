'use server';

import * as queries from '@/lib/db/queries';
import { requireRepoAccess } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { createPlaceholderTestCase, createStandaloneSpec } from './specs';

interface CoverAreaInput {
  areaId: string;
  /** Optional — when provided, build's change-map narrative is folded into the
   *  drafted spec so the new test directly targets the suspected regression. */
  buildId?: string;
  /** Optional reviewer hint ("the new banner should also test scrolled state"). */
  hint?: string;
}

export interface CoverAreaResult {
  ok: boolean;
  error?: string;
  /** Created spec id — the verify UI deep-links to /specs/<id> for editing. */
  specId?: string;
  /** Created placeholder test id when a test was scaffolded. */
  testId?: string;
  /** Drafted title surfaced in toast confirmation. */
  title?: string;
}

/**
 * "Cover this area" — drafts a new test spec for an area flagged by the Change
 * Map as risky-but-uncovered. Creates a placeholder test + spec pair so the
 * verify UI can surface it immediately; the actual Playwright code is filled
 * in on the next user click ("Generate test from spec").
 *
 * Inputs the spec gets seeded with, in priority order:
 *   1. The area's existing agentPlan (canonical "what's in this area")
 *   2. Build's change-map AI narrative for this area (when buildId given)
 *   3. Reviewer's free-text hint
 *
 * The drafted spec leans on existing infrastructure — no new prompting path —
 * so the UX is consistent with the planner-generated specs that already exist.
 */
export async function coverArea(input: CoverAreaInput): Promise<CoverAreaResult> {
  const area = await queries.getFunctionalArea(input.areaId);
  if (!area) return { ok: false, error: 'Area not found' };
  if (!area.repositoryId) return { ok: false, error: 'Area is not bound to a repository' };
  const repositoryId = area.repositoryId;
  await requireRepoAccess(repositoryId);

  // Pull the build's change-map narrative if available — gives the spec a
  // concrete "what changed and why this might break" framing.
  let narrative: string[] = [];
  let intentSummary = '';
  if (input.buildId) {
    const map = await queries.getBuildChangeMap(input.buildId).catch(() => null);
    const areaEntry = map?.areas.find((a) => a.areaId === input.areaId);
    if (areaEntry) narrative = areaEntry.aiNarrative ?? [];
    intentSummary = map?.intentSummary ?? '';
  }

  // Drafted title prefers existing covered-tests gap framing if we have one.
  const existingTests = await queries.getTestsByFunctionalArea(input.areaId);
  const gapNumber = existingTests.length + 1;
  const title = `${area.name} — coverage gap #${gapNumber}`;

  // Spec body is a structured markdown blob so the test-from-spec prompt has
  // clear sections to work with. Mirrors what the planner agent writes today.
  const body = buildSpecBody({
    areaName: area.name,
    agentPlan: area.agentPlan ?? null,
    narrative,
    intentSummary,
    hint: input.hint ?? null,
  });

  // Create the placeholder test + spec pair. createPlaceholderTestCase already
  // links the two and writes the PLACEHOLDER_CODE stub the user can fill in.
  const { testId } = await createPlaceholderTestCase(
    repositoryId,
    input.areaId,
    title,
    body,
  );

  // The placeholder's spec was created inline by createPlaceholderTestCase —
  // pull it out so the caller can deep-link to it. createStandaloneSpec is the
  // fallback if we ever decouple test+spec creation.
  let specId: string | undefined;
  const linked = await queries.getTestSpec(testId).catch(() => null);
  if (linked) specId = linked.id;
  if (!specId) {
    // Belt-and-braces — never let coverArea silently fail to surface anything
    // in the UI. createStandaloneSpec is idempotent w.r.t. duplicate titles.
    specId = await createStandaloneSpec(repositoryId, input.areaId, title, body);
  }

  revalidatePath(`/areas`);
  if (input.buildId) revalidatePath(`/verify/${input.buildId}`);

  return { ok: true, specId, testId, title };
}

interface SpecBodyInput {
  areaName: string;
  agentPlan: string | null;
  narrative: string[];
  intentSummary: string;
  hint: string | null;
}

function buildSpecBody(input: SpecBodyInput): string {
  const lines: string[] = [];
  lines.push(`# Coverage gap: ${input.areaName}`, '');
  if (input.intentSummary) {
    lines.push('## Build intent', '', input.intentSummary, '');
  }
  if (input.narrative.length > 0) {
    lines.push('## Why this area is suspect', '');
    for (const n of input.narrative) lines.push(`- ${n}`);
    lines.push('');
  }
  if (input.hint) {
    lines.push('## Reviewer hint', '', input.hint, '');
  }
  if (input.agentPlan && input.agentPlan.trim().length > 0) {
    lines.push('## Area plan (existing)', '', input.agentPlan.trim(), '');
  }
  lines.push(
    '## Acceptance',
    '',
    '- The new test exercises the path described above end-to-end.',
    '- Add assertions for any state the build intent says should change.',
    '- Capture a baseline screenshot at each meaningful state transition.',
  );
  return lines.join('\n');
}
