/**
 * Assertion ID Migration Script
 *
 * Re-parses every test's `code` with the new content+occurrence-based
 * assertion id formula and rewrites:
 *   - `tests.assertions[].id`
 *   - `tests.step_criteria.rules[].params.assertionId` (under stepLabel
 *     `__assertions__`) — old → new mapping; entries with no mapping
 *     (assertion deleted from code) are dropped
 *   - `test_versions.step_criteria` — same, using each version's own code
 *
 * `test_results.assertion_results` is left alone — that column was
 * unpopulated before this change (the runner didn't emit AssertionResult[]),
 * so there's nothing to rewrite. New runs will populate correctly.
 *
 * Idempotent: re-running computes the same new ids and the rewrites no-op.
 *
 * Run with: pnpm tsx scripts/migrate-assertion-ids.ts
 */

import { db } from '../src/lib/db';
import { tests, testVersions } from '../src/lib/db/schema';
import { eq } from 'drizzle-orm';
import { createHash } from 'crypto';
import { parseAssertions } from '../src/lib/playwright/assertion-parser';
import type { StepCriterion, StepRule, TestAssertion } from '../src/lib/db/schema';

/**
 * Old assertion id formula — matches the pre-migration version of
 * `assertionId` in src/lib/playwright/assertion-parser.ts:12-15.
 * Inlined here so we can compute old ids for mapping without reverting
 * the live parser.
 */
function oldAssertionId(orderIndex: number, type: string, selector?: string, expected?: string): string {
  const input = `${orderIndex}:${type}:${selector ?? ''}:${expected ?? ''}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}

/**
 * Re-derive the OLD id for each parsed assertion. We use the same
 * `(type, targetSelector, expectedValue)` tuple the new parser captured,
 * keyed by the assertion's current `orderIndex` (which the new parser
 * still preserves on each TestAssertion). Returns a Map<oldId, newId>.
 */
function buildIdMap(parsed: TestAssertion[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of parsed) {
    const oldId = oldAssertionId(a.orderIndex, a.assertionType, a.targetSelector, a.expectedValue);
    map.set(oldId, a.id);
  }
  return map;
}

/**
 * Rewrite stepCriteria so any `assertion_failed` rule under stepLabel
 * `__assertions__` swaps its old `params.assertionId` for the new id.
 * Rules whose old id has no mapping (assertion deleted from current code)
 * are dropped.
 */
function rewriteStepCriteria(criteria: StepCriterion[] | null, idMap: Map<string, string>): StepCriterion[] | null {
  if (!criteria || criteria.length === 0) return criteria;
  const out: StepCriterion[] = [];
  for (const c of criteria) {
    if (c.stepLabel !== '__assertions__') {
      out.push(c);
      continue;
    }
    const newRules: StepRule[] = [];
    for (const r of c.rules) {
      if (r.kind !== 'assertion_failed') { newRules.push(r); continue; }
      const oldId = (r.params as { assertionId?: string } | undefined)?.assertionId;
      if (!oldId) { newRules.push(r); continue; }  // legacy global rule, no scoping
      const newId = idMap.get(oldId);
      if (!newId) continue;  // assertion no longer exists, drop the rule
      if (newId === oldId) { newRules.push(r); continue; }  // already migrated
      newRules.push({ ...r, params: { ...(r.params ?? {}), assertionId: newId } });
    }
    if (newRules.length > 0) out.push({ ...c, rules: newRules });
  }
  return out;
}

async function migrate() {
  console.log('Starting assertion-id migration...\n');

  let testsUpdated = 0;
  let testsSkipped = 0;
  let criteriaRewrites = 0;
  let droppedRules = 0;
  let versionsUpdated = 0;

  const allTests = await db.select().from(tests).all();
  console.log(`Found ${allTests.length} tests to scan`);

  for (const t of allTests) {
    if (!t.code || t.code.trim() === '') { testsSkipped++; continue; }

    const newAssertions = parseAssertions(t.code);
    const idMap = buildIdMap(newAssertions);

    // Rewrite step_criteria using old→new mapping
    const oldCriteria = t.stepCriteria;
    const newCriteria = rewriteStepCriteria(oldCriteria, idMap);

    const stepCriteriaChanged = JSON.stringify(oldCriteria) !== JSON.stringify(newCriteria);
    const assertionsChanged = JSON.stringify(t.assertions ?? []) !== JSON.stringify(newAssertions);

    if (stepCriteriaChanged) {
      // Count dropped rules for visibility
      const oldRuleCount = (oldCriteria ?? []).flatMap(c => c.rules.filter(r => r.kind === 'assertion_failed')).length;
      const newRuleCount = (newCriteria ?? []).flatMap(c => c.rules.filter(r => r.kind === 'assertion_failed')).length;
      if (newRuleCount < oldRuleCount) droppedRules += oldRuleCount - newRuleCount;
      criteriaRewrites++;
    }

    if (assertionsChanged || stepCriteriaChanged) {
      await db.update(tests)
        .set({
          assertions: newAssertions,
          ...(stepCriteriaChanged ? { stepCriteria: newCriteria } : {}),
        })
        .where(eq(tests.id, t.id));
      testsUpdated++;
    }
  }

  console.log(`✓ Tests updated: ${testsUpdated} (${testsSkipped} skipped — no code)`);
  console.log(`✓ Step criteria rewrites: ${criteriaRewrites} (${droppedRules} rules dropped — assertion no longer in code)`);

  // testVersions hold historical snapshots. Each version has its own `code`
  // and `stepCriteria`. Re-parse with the snapshot's own code so a restored
  // version's pinned criteria still resolve to working assertions.
  const allVersions = await db.select().from(testVersions).all();
  console.log(`\nFound ${allVersions.length} test versions to scan`);

  for (const v of allVersions) {
    if (!v.code || !v.stepCriteria || v.stepCriteria.length === 0) continue;
    const versionAssertions = parseAssertions(v.code);
    const idMap = buildIdMap(versionAssertions);
    const newCriteria = rewriteStepCriteria(v.stepCriteria, idMap);
    if (JSON.stringify(v.stepCriteria) === JSON.stringify(newCriteria)) continue;
    await db.update(testVersions)
      .set({ stepCriteria: newCriteria })
      .where(eq(testVersions.id, v.id));
    versionsUpdated++;
  }

  console.log(`✓ Test versions updated: ${versionsUpdated}`);
  console.log('\nDone.');
}

migrate()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
