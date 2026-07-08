import type { TreeEntry } from "@/lib/github/content";

/**
 * QA Agent code check — static analysis of the connected repo that feeds the
 * planner with facts the live crawl cannot see: API endpoints DECLARED in
 * code (vs merely observed on the wire), the framework/auth stack, and
 * dependency-derived testing implications. Extraction is deterministic
 * (tree + regex over a capped set of files); the AI summary layer stays in
 * the planner.
 */

export interface QaDeclaredEndpoint {
  method: string;
  path: string;
  /** Source file the handler was found in (repo-relative). */
  file: string;
}

export interface QaCodeCheck {
  framework?: string;
  authMechanism?: string;
  apiLayer?: string;
  projectDescription?: string;
  /** Dependency/testing notes from codebase intelligence. */
  testingNotes: string[];
  declaredEndpoints: QaDeclaredEndpoint[];
}

const MAX_ROUTE_FILES = 20;
const MAX_FILE_CHARS = 6000;
const MAX_ENDPOINTS = 60;

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

// Next.js App Router: app/<segments>/route.ts(x|js) → URL path from the dirs.
function appRouterPath(filePath: string): string | null {
  const match = filePath.match(/(?:^|\/)app\/(.*)\/route\.(?:ts|tsx|js|mjs)$/);
  if (!match) return null;
  const segments = match[1]
    .split("/")
    // Route groups "(group)" and parallel routes "@slot" don't affect the URL.
    .filter(
      (s) => !(s.startsWith("(") && s.endsWith(")")) && !s.startsWith("@"),
    )
    .map((s) =>
      s
        .replace(/^\[\[\.\.\.(.+)\]\]$/, ":$1*")
        .replace(/^\[\.\.\.(.+)\]$/, ":$1*")
        .replace(/^\[(.+)\]$/, ":$1"),
    );
  return "/" + segments.join("/");
}

/** Next.js Pages Router: pages/api/** → URL path from the file path. */
function pagesApiPath(filePath: string): string | null {
  const match = filePath.match(
    /(?:^|\/)pages\/(api\/.*?)(?:\/index)?\.(?:ts|tsx|js|mjs)$/,
  );
  if (!match) return null;
  const segments = match[1].split("/").map((s) =>
    s
      .replace(/^\[\[\.\.\.(.+)\]\]$/, ":$1*")
      .replace(/^\[\.\.\.(.+)\]$/, ":$1*")
      .replace(/^\[(.+)\]$/, ":$1"),
  );
  return "/" + segments.join("/");
}

export function isApiRouteFile(path: string): boolean {
  return appRouterPath(path) !== null || pagesApiPath(path) !== null;
}

/** Pick the API route files worth reading, smallest-path-first for stability. */
export function selectApiRouteFiles(tree: TreeEntry[]): TreeEntry[] {
  return tree
    .filter((e) => e.type === "blob" && isApiRouteFile(e.path))
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(0, MAX_ROUTE_FILES);
}

/** Extract the HTTP methods a route file declares. App Router exports
 *  `export async function GET/POST/...` (or const arrow equivalents);
 *  Pages Router handlers switch on `req.method === "POST"` etc. */
export function extractMethodsFromSource(source: string): string[] {
  const methods = new Set<string>();
  for (const method of HTTP_METHODS) {
    if (
      new RegExp(
        `export\\s+(?:async\\s+)?(?:function\\s+${method}\\b|const\\s+${method}\\s*=)`,
      ).test(source) ||
      new RegExp(
        `\\breq(?:uest)?\\.method\\s*===?\\s*["'\`]${method}["'\`]`,
      ).test(source)
    ) {
      methods.add(method);
    }
  }
  // A pages/api file with no explicit method check handles everything — call
  // that GET for planning purposes rather than exploding the matrix.
  return methods.size > 0 ? [...methods] : ["GET"];
}

/**
 * Walk the repo tree, read the (capped) API route files, and produce the
 * declared-endpoint list. `getContent` abstracts the GitHub blob fetch so the
 * extraction logic stays pure and unit-testable.
 */
export async function extractDeclaredEndpoints(
  tree: TreeEntry[],
  getContent: (path: string) => Promise<string | null>,
): Promise<QaDeclaredEndpoint[]> {
  const endpoints: QaDeclaredEndpoint[] = [];
  for (const entry of selectApiRouteFiles(tree)) {
    if (endpoints.length >= MAX_ENDPOINTS) break;
    const urlPath = appRouterPath(entry.path) ?? pagesApiPath(entry.path);
    if (!urlPath) continue;
    const source = await getContent(entry.path).catch(() => null);
    if (!source) continue;
    for (const method of extractMethodsFromSource(
      source.slice(0, MAX_FILE_CHARS),
    )) {
      endpoints.push({ method, path: urlPath, file: entry.path });
      if (endpoints.length >= MAX_ENDPOINTS) break;
    }
  }
  return endpoints;
}

const MAX_DIGEST_ENDPOINTS = 40;

/** Planner-digest section for the code check. */
export function buildCodeCheckDigest(check: QaCodeCheck): string {
  const lines: string[] = ["## Code analysis (from the connected repository)"];
  const facts = [
    check.framework && `Framework: ${check.framework}`,
    check.authMechanism && `Auth: ${check.authMechanism}`,
    check.apiLayer && `API layer: ${check.apiLayer}`,
  ].filter(Boolean);
  if (facts.length) lines.push(facts.join(" · "));
  if (check.projectDescription) {
    lines.push(`About: ${check.projectDescription}`);
  }
  if (check.testingNotes.length) {
    lines.push(
      "Testing implications:",
      ...check.testingNotes.slice(0, 8).map((n) => `- ${n}`),
    );
  }
  if (check.declaredEndpoints.length) {
    lines.push(
      "API endpoints declared in code (may not all appear during a crawl):",
      ...check.declaredEndpoints
        .slice(0, MAX_DIGEST_ENDPOINTS)
        .map((e) => `- ${e.method} ${e.path}`),
    );
  }
  return lines.join("\n");
}
