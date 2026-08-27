/**
 * Deterministic clustering pre-pass.
 *
 * The Triage agent does NOT hand the LLM a flat list of failures and ask it to
 * find the structure. It runs this pass first — pure, cheap, explainable — and
 * hands the LLM the resulting clusters to name, narrate and refine. That keeps
 * the expensive step to judgement, and keeps the grouping reproducible when the
 * model is unavailable (a `skipped` triage run still gets usable groups).
 *
 * Three passes, in order. Every candidate is claimed by at most one:
 *   1. identical failing assertion / error signature (normalized),
 *   2. overlapping changed regions (transitively — a union-find over boxes),
 *   3. same spec file + same browser-set.
 * Anything still alone lands in `ungrouped`.
 */

import type { TriageCaseStatus, TriageRegion } from "./types";

/** One failed / review-required case, narrowed to what clustering can use. */
export interface TriageCandidate {
  /** Stable id of the case (the caller's key — a step-comparison or diff id). */
  id: string;
  testId: string;
  testName?: string | null;
  /** Spec file the test lives in, when known. Drives the third pass. */
  specFile?: string | null;
  stepLabel?: string | null;
  status: TriageCaseStatus;
  browser?: string | null;
  /** Assertion text or runtime error. Normalized before comparison. */
  errorMessage?: string | null;
  /** Percentage of pixels changed, when this case came from a visual diff. */
  diffPercentage?: number | null;
  /** Changed-region bounding boxes from the diff. Drives the second pass. */
  changedRegions?: TriageRegion[] | null;
  /** Check layers that flagged, e.g. ["visual","dom"]. */
  layers?: string[] | null;
  /** Prior-run context, used for evidence rather than for grouping. */
  history?: TriageCandidateHistory | null;
}

export interface TriageCandidateHistory {
  /** Earliest build this case was observed in — powers "present since run 2". */
  firstSeenBuildId?: string | null;
  /** How many recent builds this case appeared in. */
  buildsSeen?: number | null;
  /** Consecutive failing builds up to and including this one. */
  consecutiveFailures?: number | null;
  /** 0..1 — how often this case flipped between pass and fail recently. */
  flakyRate?: number | null;
}

/** Which pass claimed a cluster. Surfaced so the LLM (and the UI) can say why. */
export type TriageClusterReason =
  | "error_signature"
  | "shared_regions"
  | "spec_and_browsers";

export interface ClusterGroup {
  /** Deterministic slug-ish key, unique within the result. */
  key: string;
  reason: TriageClusterReason;
  /** Candidate ids, in input order. */
  candidateIds: string[];
  /** Union of the group's changed regions (merged where they overlap). */
  sharedRegions: TriageRegion[];
  /** Sorted unique browsers the group spans. */
  browsers: string[];
  /** Sorted unique layers the group's cases flagged. */
  layers: string[];
  /** Sorted unique spec files the group's cases live in. */
  specFiles: string[];
  /** The normalized error signature, when the first pass produced this group. */
  errorSignature?: string;
}

export interface ClusterResult {
  groups: ClusterGroup[];
  /** Ids of candidates no pass could pair with anything. */
  ungrouped: string[];
}

// ─── normalization ──────────────────────────────────────────────────────────

/**
 * Reduce an error message to the shape that repeats across cases: drop the
 * volatile parts (numbers, quoted literals, urls, hex ids, timing) so
 * "expected 4 got 5" and "expected 7 got 9" collapse to one signature.
 */
export function normalizeErrorSignature(message: string): string {
  return message
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\b[0-9a-f]{8,}\b/g, "<hex>")
    .replace(/["'`][^"'`]*["'`]/g, "<str>")
    .replace(/\b\d+(\.\d+)?(ms|s|px|%)?\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

// ─── region geometry ────────────────────────────────────────────────────────

function overlaps(a: TriageRegion, b: TriageRegion): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

function regionsOverlap(a: TriageRegion[], b: TriageRegion[]): boolean {
  for (const ra of a) for (const rb of b) if (overlaps(ra, rb)) return true;
  return false;
}

function unionBox(a: TriageRegion, b: TriageRegion): TriageRegion {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** Merge overlapping boxes into their bounding boxes, repeatedly until stable. */
export function mergeRegions(regions: TriageRegion[]): TriageRegion[] {
  const out: TriageRegion[] = [];
  for (const r of regions) {
    let merged = { ...r };
    let i = 0;
    while (i < out.length) {
      if (overlaps(out[i], merged)) {
        merged = unionBox(out.splice(i, 1)[0], merged);
        i = 0;
      } else {
        i++;
      }
    }
    out.push(merged);
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

// ─── clustering ─────────────────────────────────────────────────────────────

function sortedUnique(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))].sort();
}

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "group";
}

function buildGroup(
  members: TriageCandidate[],
  reason: TriageClusterReason,
  keySeed: string,
  used: Set<string>,
  errorSignature?: string,
): ClusterGroup {
  let key = slugify(keySeed);
  if (used.has(key)) {
    let n = 2;
    while (used.has(`${key}-${n}`)) n++;
    key = `${key}-${n}`;
  }
  used.add(key);
  return {
    key,
    reason,
    candidateIds: members.map((m) => m.id),
    sharedRegions: mergeRegions(members.flatMap((m) => m.changedRegions ?? [])),
    browsers: sortedUnique(members.map((m) => m.browser)),
    layers: sortedUnique(members.flatMap((m) => m.layers ?? [])),
    specFiles: sortedUnique(members.map((m) => m.specFile)),
    ...(errorSignature ? { errorSignature } : {}),
  };
}

/**
 * The pre-pass. Pure and total: same input, same output, no I/O.
 *
 * Groups are emitted largest-first, ties broken by the input position of their
 * first member, so the ordering is stable across runs.
 */
export function clusterDeterministically(
  candidates: TriageCandidate[],
): ClusterResult {
  const groups: ClusterGroup[] = [];
  const usedKeys = new Set<string>();
  const claimed = new Set<string>();
  const position = new Map<string, number>();
  candidates.forEach((c, i) => position.set(c.id, i));

  const remaining = () => candidates.filter((c) => !claimed.has(c.id));
  const claim = (members: TriageCandidate[]) =>
    members.forEach((m) => claimed.add(m.id));

  // Pass 1 — identical normalized error signature.
  const bySignature = new Map<string, TriageCandidate[]>();
  for (const c of candidates) {
    const raw = c.errorMessage?.trim();
    if (!raw) continue;
    const sig = normalizeErrorSignature(raw);
    if (!sig) continue;
    const bucket = bySignature.get(sig);
    if (bucket) bucket.push(c);
    else bySignature.set(sig, [c]);
  }
  for (const [sig, members] of bySignature) {
    if (members.length < 2) continue;
    groups.push(buildGroup(members, "error_signature", sig, usedKeys, sig));
    claim(members);
  }

  // Pass 2 — transitively overlapping changed regions (union-find over boxes).
  const withRegions = remaining().filter(
    (c) => (c.changedRegions ?? []).length,
  );
  const parent = new Map<string, string>();
  withRegions.forEach((c) => parent.set(c.id, c.id));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = id;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      // Keep the earlier-positioned id as the root so keys stay stable.
      const [keep, drop] =
        position.get(ra)! <= position.get(rb)! ? [ra, rb] : [rb, ra];
      parent.set(drop, keep);
    }
  };
  for (let i = 0; i < withRegions.length; i++) {
    for (let j = i + 1; j < withRegions.length; j++) {
      if (
        regionsOverlap(
          withRegions[i].changedRegions!,
          withRegions[j].changedRegions!,
        )
      ) {
        union(withRegions[i].id, withRegions[j].id);
      }
    }
  }
  const byRoot = new Map<string, TriageCandidate[]>();
  for (const c of withRegions) {
    const root = find(c.id);
    const bucket = byRoot.get(root);
    if (bucket) bucket.push(c);
    else byRoot.set(root, [c]);
  }
  for (const members of byRoot.values()) {
    if (members.length < 2) continue;
    const box = mergeRegions(members.flatMap((m) => m.changedRegions ?? []))[0];
    const seed = box
      ? `region-${Math.round(box.x)}-${Math.round(box.y)}`
      : "region";
    groups.push(buildGroup(members, "shared_regions", seed, usedKeys));
    claim(members);
  }

  // Pass 3 — same spec file + same browser-set. A test's browser-set is every
  // browser it appears under anywhere in the input, so a layout break that hits
  // chromium+webkit clusters apart from one that only hits firefox.
  const browserSetByTest = new Map<string, string>();
  for (const testId of new Set(candidates.map((c) => c.testId))) {
    browserSetByTest.set(
      testId,
      sortedUnique(
        candidates.filter((c) => c.testId === testId).map((c) => c.browser),
      ).join(","),
    );
  }
  const bySpec = new Map<string, TriageCandidate[]>();
  for (const c of remaining()) {
    if (!c.specFile) continue;
    const key = `${c.specFile}::${browserSetByTest.get(c.testId) ?? ""}`;
    const bucket = bySpec.get(key);
    if (bucket) bucket.push(c);
    else bySpec.set(key, [c]);
  }
  for (const [key, members] of bySpec) {
    if (members.length < 2) continue;
    groups.push(buildGroup(members, "spec_and_browsers", key, usedKeys));
    claim(members);
  }

  groups.sort(
    (a, b) =>
      b.candidateIds.length - a.candidateIds.length ||
      position.get(a.candidateIds[0])! - position.get(b.candidateIds[0])!,
  );

  return {
    groups,
    ungrouped: candidates.filter((c) => !claimed.has(c.id)).map((c) => c.id),
  };
}
