/**
 * DOM Diff Engine — compares two DOM snapshots and produces a structured diff.
 *
 * Matches elements by selector stability (data-testid > id > role+text > css-path),
 * then by bounding box proximity for unmatched elements. Produces added/removed/changed
 * lists with bounding boxes for overlay positioning on the diff viewer.
 */

import type { DomSnapshotData, DomSnapshotElement, DomDiffResult } from '@/lib/db/schema';

// Selector types ordered by stability (most stable first)
const SELECTOR_PRIORITY = ['data-testid', 'id', 'label', 'role-name', 'aria-label', 'text', 'name'];

/** Tags considered "interactive" for verdict scoring — these are the ones
 *  that user research consistently shows produce real regressions when they
 *  appear/disappear. Decorative DOM churn (divs, spans without role) is
 *  excluded because in modern frameworks it's typical and noisy. */
const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'option', 'form', 'label']);

function isInteractive(el: DomSnapshotElement): boolean {
  if (INTERACTIVE_TAGS.has(el.tag.toLowerCase())) return true;
  // Anything with a `role-name` selector is exposed to assistive tech
  return el.selectors.some(s => s.type === 'role-name' || s.type === 'aria-label');
}

/**
 * Get the best stable identifier for an element.
 * Returns the first selector value found in priority order, or null.
 */
function getStableKey(element: DomSnapshotElement): string | null {
  for (const type of SELECTOR_PRIORITY) {
    const sel = element.selectors.find(s => s.type === type);
    if (sel) return `${type}::${sel.value}`;
  }
  return null;
}

/**
 * Compute bounding box distance between two elements (center-to-center).
 */
function bboxDistance(a: DomSnapshotElement, b: DomSnapshotElement): number {
  const aCenterX = a.boundingBox.x + a.boundingBox.width / 2;
  const aCenterY = a.boundingBox.y + a.boundingBox.height / 2;
  const bCenterX = b.boundingBox.x + b.boundingBox.width / 2;
  const bCenterY = b.boundingBox.y + b.boundingBox.height / 2;
  return Math.sqrt((aCenterX - bCenterX) ** 2 + (aCenterY - bCenterY) ** 2);
}

/**
 * Detect what changed between two matched elements.
 */
function detectChanges(
  baseline: DomSnapshotElement,
  current: DomSnapshotElement,
): ('text' | 'position' | 'size' | 'selector')[] {
  const changes: ('text' | 'position' | 'size' | 'selector')[] = [];

  // Text change
  if ((baseline.textContent || '') !== (current.textContent || '')) {
    changes.push('text');
  }

  // Position change (threshold: 5px)
  const dx = Math.abs(baseline.boundingBox.x - current.boundingBox.x);
  const dy = Math.abs(baseline.boundingBox.y - current.boundingBox.y);
  if (dx > 5 || dy > 5) {
    changes.push('position');
  }

  // Size change (threshold: 5px)
  const dw = Math.abs(baseline.boundingBox.width - current.boundingBox.width);
  const dh = Math.abs(baseline.boundingBox.height - current.boundingBox.height);
  if (dw > 5 || dh > 5) {
    changes.push('size');
  }

  // Selector change — compare selector sets
  const baseSelectors = new Set(baseline.selectors.map(s => `${s.type}::${s.value}`));
  const currSelectors = new Set(current.selectors.map(s => `${s.type}::${s.value}`));
  const selectorDiff = [...baseSelectors].some(s => !currSelectors.has(s)) ||
                       [...currSelectors].some(s => !baseSelectors.has(s));
  if (selectorDiff) {
    changes.push('selector');
  }

  return changes;
}

interface DomDiffOptions {
  /** When true, exclude non-interactive elements (decorative divs/spans without
   *  ARIA role) from the diff. This is the right setting for verdict scoring —
   *  "a div moved 6px" is rarely a real regression. */
  interactiveOnly?: boolean;
}

/**
 * Compare two DOM snapshots and produce a structured diff.
 */
export function computeDomDiff(
  baseline: DomSnapshotData,
  current: DomSnapshotData,
  options: DomDiffOptions = {},
): DomDiffResult {
  // Apply interactive-only filter at the input layer so the matching algorithm
  // operates on a smaller, higher-signal element set.
  if (options.interactiveOnly) {
    baseline = { ...baseline, elements: baseline.elements.filter(isInteractive) };
    current = { ...current, elements: current.elements.filter(isInteractive) };
  }
  const added: DomSnapshotElement[] = [];
  const removed: DomSnapshotElement[] = [];
  const changed: DomDiffResult['changed'] = [];
  let unchangedCount = 0;

  // Phase 1: Match by stable selector key
  const baselineByKey = new Map<string, DomSnapshotElement>();
  const unmatchedBaseline: DomSnapshotElement[] = [];

  for (const el of baseline.elements) {
    const key = getStableKey(el);
    if (key && !baselineByKey.has(key)) {
      baselineByKey.set(key, el);
    } else {
      unmatchedBaseline.push(el);
    }
  }

  const matchedBaselineKeys = new Set<string>();
  const unmatchedCurrent: DomSnapshotElement[] = [];

  for (const el of current.elements) {
    const key = getStableKey(el);
    if (key && baselineByKey.has(key) && !matchedBaselineKeys.has(key)) {
      // Matched by key
      matchedBaselineKeys.add(key);
      const baseEl = baselineByKey.get(key)!;
      const changes = detectChanges(baseEl, el);
      if (changes.length > 0) {
        changed.push({ baseline: baseEl, current: el, changes });
      } else {
        unchangedCount++;
      }
    } else {
      unmatchedCurrent.push(el);
    }
  }

  // Collect unmatched baseline elements (those not matched by key)
  for (const [key, el] of baselineByKey) {
    if (!matchedBaselineKeys.has(key)) {
      unmatchedBaseline.push(el);
    }
  }

  // Phase 2: Match remaining by tag + bounding box proximity
  const stillUnmatchedBaseline = [...unmatchedBaseline];
  const matchedBaselineIndices = new Set<number>();

  for (const currEl of unmatchedCurrent) {
    let bestIdx = -1;
    let bestDist = Infinity;

    for (let i = 0; i < stillUnmatchedBaseline.length; i++) {
      if (matchedBaselineIndices.has(i)) continue;
      const baseEl = stillUnmatchedBaseline[i];
      // Must be same tag to match by proximity
      if (baseEl.tag !== currEl.tag) continue;
      const dist = bboxDistance(baseEl, currEl);
      // Max distance threshold: 200px
      if (dist < bestDist && dist < 200) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      matchedBaselineIndices.add(bestIdx);
      const baseEl = stillUnmatchedBaseline[bestIdx];
      const changes = detectChanges(baseEl, currEl);
      if (changes.length > 0) {
        changed.push({ baseline: baseEl, current: currEl, changes });
      } else {
        unchangedCount++;
      }
    } else {
      added.push(currEl);
    }
  }

  // Remaining unmatched baseline elements are removed
  for (let i = 0; i < stillUnmatchedBaseline.length; i++) {
    if (!matchedBaselineIndices.has(i)) {
      removed.push(stillUnmatchedBaseline[i]);
    }
  }

  return { added, removed, changed, unchangedCount };
}

/**
 * Summarize a DOM diff for AI context (compact text description).
 */
export function summarizeDomDiff(diff: DomDiffResult): string {
  const parts: string[] = [];

  if (diff.removed.length > 0) {
    parts.push(`REMOVED elements (${diff.removed.length}):`);
    for (const el of diff.removed.slice(0, 10)) {
      const sel = el.selectors[0];
      parts.push(`  - <${el.tag}> ${sel ? `${sel.type}="${sel.value}"` : ''} ${el.textContent ? `"${el.textContent.slice(0, 50)}"` : ''}`);
    }
    if (diff.removed.length > 10) parts.push(`  ... and ${diff.removed.length - 10} more`);
  }

  if (diff.added.length > 0) {
    parts.push(`ADDED elements (${diff.added.length}):`);
    for (const el of diff.added.slice(0, 10)) {
      const sel = el.selectors[0];
      parts.push(`  + <${el.tag}> ${sel ? `${sel.type}="${sel.value}"` : ''} ${el.textContent ? `"${el.textContent.slice(0, 50)}"` : ''}`);
    }
    if (diff.added.length > 10) parts.push(`  ... and ${diff.added.length - 10} more`);
  }

  if (diff.changed.length > 0) {
    parts.push(`CHANGED elements (${diff.changed.length}):`);
    for (const c of diff.changed.slice(0, 10)) {
      const sel = c.current.selectors[0];
      parts.push(`  ~ <${c.current.tag}> ${sel ? `${sel.type}="${sel.value}"` : ''} changes: [${c.changes.join(', ')}]`);
      if (c.changes.includes('text')) {
        parts.push(`    text: "${c.baseline.textContent?.slice(0, 30) ?? ''}" → "${c.current.textContent?.slice(0, 30) ?? ''}"`);
      }
      if (c.changes.includes('selector')) {
        const oldSels = c.baseline.selectors.map(s => `${s.type}=${s.value}`).join(', ');
        const newSels = c.current.selectors.map(s => `${s.type}=${s.value}`).join(', ');
        parts.push(`    selectors: [${oldSels}] → [${newSels}]`);
      }
    }
    if (diff.changed.length > 10) parts.push(`  ... and ${diff.changed.length - 10} more`);
  }

  parts.push(`Unchanged: ${diff.unchangedCount} elements`);

  return parts.join('\n');
}
