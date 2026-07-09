import type {
  QaGeneratedTest,
  QaPrChangedFile,
  QaPrChanges,
  QaPrCoverage,
  QaPrCoverageEntry,
  QaPrEndpoint,
  QaPrSymbol,
  QaTestPlan,
} from "@/lib/db/schema";
import type { CompareResult } from "@/lib/github/content";
import { apiRouteUrlPath, type QaDeclaredEndpoint } from "./code-check";

/**
 * QA Agent PR check — branch-aware static analysis. Diffs the working branch
 * against the base branch and extracts the specific functions, components,
 * and API endpoints the branch adds or modifies, so the planner can target
 * them and the summary can report whether each one ended up covered by a
 * test. Extraction is deterministic (regex over unified-diff hunks), matching
 * the code-check module's style — no AST, no AI.
 */

const MAX_FILES = 60;
const MAX_SYMBOLS = 60;
const MAX_ENDPOINTS = 40;

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

/** Declaration patterns matched at column 0 of an added diff line. Nested
 *  helpers are indented in real code, so anchoring to column 0 keeps the
 *  extraction to top-level (usually exported) declarations. */
const DECLARATION_PATTERNS: RegExp[] = [
  /^export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
  /^export\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=/,
  /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
  /^class\s+([A-Za-z_$][\w$]*)/,
];

/** GitHub/git hunk headers carry the enclosing declaration as context:
 *  `@@ -10,6 +10,8 @@ export async function createInvoice(...)`. */
const HUNK_CONTEXT = /^@@ [^@]+@@ (.+)$/;

const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function symbolKind(
  name: string,
  file: string,
): QaPrSymbol["kind"] | "endpoint-method" {
  if (HTTP_METHODS.has(name)) return "endpoint-method";
  if (/^[A-Z]/.test(name) && /\.(tsx|jsx)$/.test(file)) return "component";
  return "function";
}

function matchDeclaration(
  line: string,
): { name: string; isClass: boolean } | null {
  for (const pattern of DECLARATION_PATTERNS) {
    const m = line.match(pattern);
    if (m) return { name: m[1], isClass: /\bclass\s/.test(line) };
  }
  return null;
}

interface PatchSymbols {
  added: Map<string, boolean>; // name → isClass
  modified: Map<string, boolean>;
  /** HTTP-method handlers touched (route files): method → added|modified. */
  methods: Map<string, "added" | "modified">;
}

/** Extract top-level declarations a unified-diff patch adds (`+` lines) or
 *  modifies (hunk-header context lines). */
export function parsePatchSymbols(patch: string): PatchSymbols {
  const added = new Map<string, boolean>();
  const modified = new Map<string, boolean>();
  const methods = new Map<string, "added" | "modified">();
  for (const raw of patch.split("\n")) {
    let decl: { name: string; isClass: boolean } | null = null;
    let change: "added" | "modified" | null = null;
    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      decl = matchDeclaration(raw.slice(1));
      change = "added";
    } else {
      const ctx = raw.match(HUNK_CONTEXT);
      if (ctx) {
        decl = matchDeclaration(ctx[1]);
        change = "modified";
      }
    }
    if (!decl || !change) continue;
    if (HTTP_METHODS.has(decl.name)) {
      // Added wins over modified when a handler shows up both ways.
      if (change === "added" || !methods.has(decl.name)) {
        methods.set(decl.name, change);
      }
      continue;
    }
    if (change === "added") {
      added.set(decl.name, decl.isClass);
      modified.delete(decl.name);
    } else if (!added.has(decl.name)) {
      modified.set(decl.name, decl.isClass);
    }
  }
  return { added, modified, methods };
}

/** Canonical ref string for a symbol/endpoint — the join key between the
 *  planner digest, plan-item changeRefs, and the coverage report. */
export function symbolRef(s: QaPrSymbol): string {
  return s.name;
}

export function endpointRef(e: Pick<QaPrEndpoint, "method" | "path">): string {
  return `${e.method} ${e.path}`;
}

/**
 * Turn a branch comparison into the structured change set. `declaredEndpoints`
 * (from the code check, head-branch tree) refines endpoint methods for
 * changed route files whose patch didn't show the handler declaration.
 */
export function computePrChanges(
  compare: Pick<CompareResult, "files" | "baseBranch" | "headBranch">,
  declaredEndpoints: QaDeclaredEndpoint[] = [],
): QaPrChanges {
  const relevant = compare.files.filter((f) =>
    ["added", "modified", "removed", "renamed", "changed"].includes(f.status),
  );
  const files: QaPrChangedFile[] = relevant.slice(0, MAX_FILES).map((f) => ({
    path: f.filename,
    status:
      f.status === "added"
        ? "added"
        : f.status === "removed"
          ? "removed"
          : f.status === "renamed"
            ? "renamed"
            : "modified",
    additions: f.additions,
    deletions: f.deletions,
    ...(f.previousFilename ? { previousPath: f.previousFilename } : {}),
  }));

  const declaredByFile = new Map<string, QaDeclaredEndpoint[]>();
  for (const e of declaredEndpoints) {
    const list = declaredByFile.get(e.file) ?? [];
    list.push(e);
    declaredByFile.set(e.file, list);
  }

  const symbols: QaPrSymbol[] = [];
  const endpoints: QaPrEndpoint[] = [];
  const seenEndpoints = new Set<string>();
  const pushEndpoint = (e: QaPrEndpoint) => {
    const key = endpointRef(e);
    if (seenEndpoints.has(key) || endpoints.length >= MAX_ENDPOINTS) return;
    seenEndpoints.add(key);
    endpoints.push(e);
  };

  for (const f of relevant.slice(0, MAX_FILES)) {
    if (!SOURCE_FILE.test(f.filename)) continue;
    const routePath = apiRouteUrlPath(f.filename);
    const fileChange: QaPrEndpoint["change"] =
      f.status === "added"
        ? "added"
        : f.status === "removed"
          ? "removed"
          : "modified";
    const parsed = f.patch ? parsePatchSymbols(f.patch) : null;

    if (routePath) {
      // Route file: report endpoints, not raw GET/POST symbol names.
      const methods = new Map<string, QaPrEndpoint["change"]>();
      if (parsed) {
        for (const [method, change] of parsed.methods) {
          methods.set(method, f.status === "removed" ? "removed" : change);
        }
      }
      // Patch didn't show a handler declaration (body-only edit, no patch for
      // huge files) → fall back to the head tree's declared methods.
      if (methods.size === 0) {
        for (const d of declaredByFile.get(f.filename) ?? []) {
          methods.set(d.method, fileChange);
        }
      }
      if (methods.size === 0) methods.set("GET", fileChange);
      for (const [method, change] of methods) {
        pushEndpoint({ method, path: routePath, file: f.filename, change });
      }
      continue;
    }

    if (!parsed || f.status === "removed") continue;
    for (const [collection, change] of [
      [parsed.added, "added"],
      [parsed.modified, "modified"],
    ] as const) {
      for (const [name, isClass] of collection) {
        if (symbols.length >= MAX_SYMBOLS) break;
        // Skip re-reporting the same symbol from a rename's new file.
        if (symbols.some((s) => s.name === name && s.file === f.filename)) {
          continue;
        }
        symbols.push({
          name,
          kind: isClass
            ? "class"
            : (symbolKind(name, f.filename) as QaPrSymbol["kind"]),
          file: f.filename,
          change,
        });
      }
    }
  }

  return {
    baseBranch: compare.baseBranch,
    headBranch: compare.headBranch,
    files,
    symbols,
    endpoints,
    ...(relevant.length > MAX_FILES || symbols.length >= MAX_SYMBOLS
      ? { truncated: true }
      : {}),
  };
}

const MAX_DIGEST_FILES = 30;

/** Planner-digest section for the branch diff. Ref strings are emitted
 *  verbatim so the planner can copy them into items' changeRefs. */
export function buildPrChangesDigest(pr: QaPrChanges): string {
  const lines: string[] = [
    `## Changes on branch \`${pr.headBranch}\` vs \`${pr.baseBranch}\` (branch/PR diff — PRIORITIZE covering these)`,
  ];
  if (pr.files.length) {
    lines.push(
      `Files changed (${pr.files.length}${pr.truncated ? "+, truncated" : ""}): ` +
        pr.files
          .slice(0, MAX_DIGEST_FILES)
          .map(
            (f) => `${f.path} (${f.status}, +${f.additions}/−${f.deletions})`,
          )
          .join("; "),
    );
  }
  if (pr.symbols.length) {
    lines.push(
      "Functions/components this branch adds or modifies:",
      ...pr.symbols.map(
        (s) => `- [ref: ${symbolRef(s)}] ${s.change} ${s.kind} in ${s.file}`,
      ),
    );
  }
  if (pr.endpoints.length) {
    lines.push(
      "API endpoints this branch touches:",
      ...pr.endpoints.map(
        (e) => `- [ref: ${endpointRef(e)}] ${e.change} (${e.file})`,
      ),
    );
  }
  lines.push(
    'COVERAGE REQUIREMENT: every user-observable change listed above must be exercised by at least one plan item. On each covering item set "changeRefs" to the exact ref strings it covers (copy them verbatim from the [ref: …] tags). Changes with no user-facing surface (build config, internal refactors) may be left uncovered.',
  );
  return lines.join("\n");
}

const ENTRY_STATUS_RANK: Record<QaPrCoverageEntry["status"], number> = {
  passed: 4,
  covered: 3,
  generated: 2,
  planned: 1,
  uncovered: 0,
};

function ledgerStatus(entries: QaGeneratedTest[]): QaPrCoverageEntry["status"] {
  let best: QaPrCoverageEntry["status"] = "planned";
  for (const g of entries) {
    let s: QaPrCoverageEntry["status"];
    if (g.status === "passed" || g.status === "healed") s = "passed";
    else if (g.status === "covered") s = "covered";
    else if (g.testId) s = "generated";
    else s = "planned";
    if (ENTRY_STATUS_RANK[s] > ENTRY_STATUS_RANK[best]) best = s;
  }
  return best;
}

/** Strip `:param`/`:rest*` segments for endpoint-path comparison. */
function normalizeApiPath(path: string): string {
  return path
    .replace(/^https?:\/\/[^/]+/i, "")
    .split("?")[0]
    .replace(/\/+$/, "")
    .split("/")
    .map((seg) => (seg.startsWith(":") || /^\{.+\}$/.test(seg) ? ":p" : seg))
    .join("/")
    .toLowerCase();
}

/**
 * Join the branch changes against the plan + generation ledger and report,
 * per changed symbol/endpoint, whether a test covers it. Matching is by the
 * planner's explicit `changeRefs` first; endpoint entries additionally match
 * api-items whose api.path hits the same normalized path (fallback for plans
 * where the AI skipped the refs).
 */
export function computePrCoverage(
  pr: QaPrChanges,
  plan: QaTestPlan,
  ledger: QaGeneratedTest[],
): QaPrCoverage {
  const items = plan.items.filter((i) => i.enabled !== false);
  const ledgerByItem = new Map(ledger.map((g) => [g.planItemId, g]));

  const refsOf = (itemRefs: string[] | undefined) =>
    new Set((itemRefs ?? []).map((r) => r.trim().toLowerCase()));

  const entries: QaPrCoverageEntry[] = [];

  const collect = (
    ref: string,
    kind: QaPrCoverageEntry["kind"],
    file: string,
    change: QaPrCoverageEntry["change"],
    extraMatch?: (item: QaTestPlan["items"][number]) => boolean,
  ) => {
    const needle = ref.trim().toLowerCase();
    const matched = items.filter(
      (i) => refsOf(i.changeRefs).has(needle) || (extraMatch?.(i) ?? false),
    );
    const ledgerEntries = matched
      .map((i) => ledgerByItem.get(i.id))
      .filter((g): g is QaGeneratedTest => Boolean(g));
    entries.push({
      ref,
      kind,
      file,
      change,
      planItemIds: matched.map((i) => i.id),
      testIds: [
        ...new Set(
          ledgerEntries
            .map((g) => g.testId)
            .filter((t): t is string => Boolean(t)),
        ),
      ],
      status:
        matched.length === 0
          ? "uncovered"
          : ledgerEntries.length === 0
            ? "planned"
            : ledgerStatus(ledgerEntries),
    });
  };

  for (const s of pr.symbols) {
    collect(symbolRef(s), "symbol", s.file, s.change);
  }
  for (const e of pr.endpoints) {
    const normalized = normalizeApiPath(e.path);
    collect(endpointRef(e), "endpoint", e.file, e.change, (item) =>
      Boolean(
        item.api &&
        item.api.method === e.method &&
        normalizeApiPath(item.api.path) === normalized,
      ),
    );
  }

  return {
    baseBranch: pr.baseBranch,
    headBranch: pr.headBranch,
    coveredCount: entries.filter((e) =>
      ["passed", "covered", "generated"].includes(e.status),
    ).length,
    entries,
  };
}
