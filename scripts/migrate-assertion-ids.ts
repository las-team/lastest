/**
 * Assertion ID Migration Script
 *
 * Re-parses every test's `code` with the new content+occurrence-based
 * assertion id formula and rewrites:
 *   - `tests.assertions[].id`
 *   - `tests.step_criteria.rules[].params.assertionId` (under stepLabel
 *     `__assertions__`) — old → new mapping; entries with no mapping
 *     (assertion deleted from code) are dropped, but only if other rules
 *     under that stepLabel survive
 *   - `test_versions.step_criteria` — same, using each version's own code
 *
 * `test_results.assertion_results` is left alone — that column was
 * unpopulated before this change (the runner didn't emit AssertionResult[]),
 * so there's nothing to rewrite. New runs will populate correctly.
 *
 * Idempotent: re-running computes the same new ids and the rewrites no-op.
 *
 * The OLD parser is inlined here (in `oldParseAssertions`) so we can
 * reconstruct old assertion ids on each test's source — TestAssertion rows
 * don't store all the fields the old hash used (e.g. `'page'` literal for
 * waitForLoadState), so we can't recompute purely from the persisted row.
 *
 * Run with: pnpm tsx scripts/migrate-assertion-ids.ts
 */

import { db } from '../src/lib/db';
import { tests, testVersions } from '../src/lib/db/schema';
import { eq } from 'drizzle-orm';
import { createHash } from 'crypto';
import { parseAssertions } from '../src/lib/playwright/assertion-parser';
import type { StepCriterion, StepRule } from '../src/lib/db/schema';

/**
 * Old assertion id formula (orderIndex-keyed). Inlined so we can compute
 * old ids without reverting the live parser.
 */
function oldAssertionId(orderIndex: number, type: string, selector?: string, expected?: string): string {
  const input = `${orderIndex}:${type}:${selector ?? ''}:${expected ?? ''}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}

/**
 * Inline copy of the OLD parser's id-emitting logic.
 *
 * Walks `code` and produces just the array of OLD ids in source order —
 * paired by orderIndex with the new parser's TestAssertion[]. That gives
 * us a (oldId, newId) tuple per assertion without trying to reconstruct
 * fields that weren't persisted on TestAssertion.
 *
 * Mirrors src/lib/playwright/assertion-parser.ts pre-migration. Kept in
 * sync with the patterns the old parser matched (1-6).
 */
function oldParseAssertionIds(code: string): string[] {
  const ids: string[] = [];
  const lines = code.split('\n');
  let orderIndex = 0;

  const extractStringArg = (argStr: string): string | undefined => {
    const str = argStr.trim();
    if (!str) return undefined;
    const m = str.match(/^['"](.*)['"]$/);
    if (m) return m[1];
    const bu = str.match(/buildUrl\(baseUrl,\s*['"]([^'"]+)['"]\)/);
    if (bu) return bu[1];
    const re = str.match(/^\/(.+)\/([gimsuy]*)$/);
    if (re) return `/${re[1]}/${re[2]}`;
    const num = str.match(/^(\d+(?:\.\d+)?)$/);
    if (num) return num[1];
    return str;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Pattern 1: Element assertion block
    const elementCommentMatch = trimmed.match(/^\/\/ (?:Element|Hard) assertion: (\w+)/);
    if (elementCommentMatch) {
      const assertionType = elementCommentMatch[1];
      let targetSelector: string | undefined;
      let expectedValue: string | undefined;
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const l = lines[j].trim();
        const sm = l.match(/locateWithFallback\(page,\s*(\[.*?\])/);
        if (sm) {
          try {
            const arr = JSON.parse(sm[1]) as Array<{ type: string; value: string }>;
            if (arr && arr.length > 0) targetSelector = `${arr[0].type}: ${arr[0].value}`;
          } catch { /* ignore */ }
        }
        const em = l.match(/await\s+expect\(el\)\.(not\.)?(\w+)\((.*)?\)/);
        if (em) {
          const args = em[3] ?? '';
          if (assertionType === 'toHaveAttribute') {
            const am = args.match(/['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]/);
            if (am) expectedValue = am[2];
          } else {
            expectedValue = extractStringArg(args);
          }
          break;
        }
        if (l === '}') break;
      }
      ids.push(oldAssertionId(orderIndex, assertionType, targetSelector, expectedValue));
      orderIndex++;
      continue;
    }

    // Pattern 2: await expect(page).matcher()
    const pageAssertionMatch = trimmed.match(/await\s+expect\(page\)\.(not\.)?(\w+)\((.*)?\)/);
    if (pageAssertionMatch) {
      const type = pageAssertionMatch[2];
      const expected = extractStringArg(pageAssertionMatch[3] ?? '');
      ids.push(oldAssertionId(orderIndex, type, 'page', expected));
      orderIndex++;
      continue;
    }

    // Pattern 3a: await expect(varName).matcher()
    const inlineElMatch = trimmed.match(/await\s+expect\((\w+)\)\.(not\.)?(\w+)\((.*)?\)/);
    if (inlineElMatch && inlineElMatch[1] !== 'page') {
      const type = inlineElMatch[3];
      const expected = extractStringArg(inlineElMatch[4] ?? '');
      ids.push(oldAssertionId(orderIndex, type, inlineElMatch[1], expected));
      orderIndex++;
      continue;
    }

    // Pattern 3b: await expect(page.locator/getByRole/etc).matcher()
    const locatorElMatch = trimmed.match(/await\s+expect\((page\.\w+\([^)]*\)(?:\.\w+\([^)]*\))*)\)\.(not\.)?(\w+)\((.*)?\)/);
    if (locatorElMatch) {
      const target = locatorElMatch[1];
      const type = locatorElMatch[3];
      const expected = extractStringArg(locatorElMatch[4] ?? '');
      ids.push(oldAssertionId(orderIndex, type, target, expected));
      orderIndex++;
      continue;
    }

    // Pattern 4: bare expect(varName).matcher()
    const genericMatch = trimmed.match(/expect\(([^)]+)\)\.(not\.)?(\w+)\((.*)?\)/);
    if (genericMatch && !trimmed.includes('await') && !genericMatch[1].match(/^(page|el|element)$/)) {
      const type = genericMatch[3];
      const expected = extractStringArg(genericMatch[4] ?? '');
      ids.push(oldAssertionId(orderIndex, type, genericMatch[1], expected));
      orderIndex++;
      continue;
    }

    // Pattern 5: download assertion (recorder-emitted comment)
    const downloadCommentMatch = trimmed.match(/^\/\/ Download assertion:\s*(.+)?$/);
    if (downloadCommentMatch) {
      const filename = downloadCommentMatch[1]?.trim();
      ids.push(oldAssertionId(orderIndex, 'fileDownloaded', 'download', filename));
      orderIndex++;
      continue;
    }

    // Pattern 6: await page.waitForLoadState(state)
    if (trimmed.match(/await\s+page\.waitForLoadState\(/)) {
      const sm = trimmed.match(/waitForLoadState\(['"](\w+)['"]\)/);
      const state = sm?.[1] ?? 'load';
      ids.push(oldAssertionId(orderIndex, 'waitForLoadState', 'page', state));
      orderIndex++;
      continue;
    }
  }

  return ids;
}

/**
 * Build a Map<oldId, newId> by running both parsers on the same code and
 * pairing by orderIndex. Both walks produce assertions in source order with
 * the same orderIndex sequence, so position N in `oldIds` corresponds to
 * position N in `newAssertions`.
 *
 * Note: the new parser added a "bare download" pattern (waitForAny without
 * the `// Download assertion:` comment) that the old parser missed. If the
 * counts don't match we abort the rewrite for that row and log — better to
 * skip than mis-pair ids.
 */
function buildIdMap(code: string, newAssertionIds: string[]): Map<string, string> | null {
  const oldIds = oldParseAssertionIds(code);
  if (oldIds.length !== newAssertionIds.length) {
    return null;
  }
  const map = new Map<string, string>();
  for (let i = 0; i < oldIds.length; i++) {
    map.set(oldIds[i], newAssertionIds[i]);
  }
  return map;
}

/**
 * Rewrite stepCriteria so any `assertion_failed` rule under stepLabel
 * `__assertions__` swaps its old `params.assertionId` for the new id.
 * Rules whose old id has no mapping are kept as-is (defensive — a stale
 * rule is better than silently dropping the user's pinned state). Other
 * stepLabels (e.g. `Step 3` with `screenshot_changed`) are passed through
 * unchanged.
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
      if (!oldId) { newRules.push(r); continue; }
      const newId = idMap.get(oldId);
      if (!newId) {
        // Keep the rule with the original id — user can re-toggle manually
        // if it's stale. Dropping silently is more destructive.
        newRules.push(r);
        continue;
      }
      if (newId === oldId) { newRules.push(r); continue; }
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
  let testsParserMismatch = 0;
  let criteriaRewrites = 0;
  let versionsUpdated = 0;

  const allTests = await db.select().from(tests);
  console.log(`Found ${allTests.length} tests to scan`);

  for (const t of allTests) {
    if (!t.code || t.code.trim() === '') { testsSkipped++; continue; }

    const newAssertions = parseAssertions(t.code);
    const newIds = newAssertions.map(a => a.id);
    const idMap = buildIdMap(t.code, newIds);

    if (!idMap) {
      // Old vs new parser disagree on assertion count for this code — can't
      // safely map ids. Update assertions but leave step_criteria alone.
      testsParserMismatch++;
      const assertionsChanged = JSON.stringify(t.assertions ?? []) !== JSON.stringify(newAssertions);
      if (assertionsChanged) {
        await db.update(tests).set({ assertions: newAssertions }).where(eq(tests.id, t.id));
        testsUpdated++;
      }
      continue;
    }

    const oldCriteria = t.stepCriteria;
    const newCriteria = rewriteStepCriteria(oldCriteria, idMap);

    const stepCriteriaChanged = JSON.stringify(oldCriteria) !== JSON.stringify(newCriteria);
    const assertionsChanged = JSON.stringify(t.assertions ?? []) !== JSON.stringify(newAssertions);

    if (stepCriteriaChanged) criteriaRewrites++;

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

  console.log(`✓ Tests updated: ${testsUpdated} (${testsSkipped} skipped — no code, ${testsParserMismatch} parser-count mismatch — assertions only)`);
  console.log(`✓ Step criteria rewrites: ${criteriaRewrites}`);

  const allVersions = await db.select().from(testVersions);
  console.log(`\nFound ${allVersions.length} test versions to scan`);

  for (const v of allVersions) {
    if (!v.code || !v.stepCriteria || v.stepCriteria.length === 0) continue;
    const versionAssertions = parseAssertions(v.code);
    const idMap = buildIdMap(v.code, versionAssertions.map(a => a.id));
    if (!idMap) continue;
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
