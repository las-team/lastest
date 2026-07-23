import type { KnowledgeMatchKind } from "@/lib/db/schema";

/**
 * URL-pattern matching for agent_knowledge notes. Patterns match against the
 * page's pathname (plus search for exact/prefix when the pattern includes one).
 *
 *   exact  — "/login" matches /login only ("*" matches everything)
 *   prefix — "/admin/*" matches /admin and anything under it; a bare "/admin"
 *            behaves like "/admin/*" (prefix is the forgiving default)
 *   regex  — pattern is a RegExp tested against the full path (invalid
 *            patterns never match — bad user input must not break the loop)
 */
export function matchUrlPattern(
  pattern: string,
  matchKind: KnowledgeMatchKind,
  url: string,
): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  if (trimmed === "*") return true;

  let path: string;
  try {
    const u = new URL(url);
    path = u.pathname.replace(/\/+$/, "") || "/";
  } catch {
    path = url;
  }

  if (matchKind === "regex") {
    try {
      return new RegExp(trimmed).test(path);
    } catch {
      return false;
    }
  }

  const cleaned = trimmed.replace(/\/+$/, "") || "/";

  if (matchKind === "exact") {
    return path === cleaned;
  }

  // prefix (default): "/admin/*" or bare "/admin" match /admin + subpaths.
  const base = cleaned.endsWith("/*") ? cleaned.slice(0, -2) || "/" : cleaned;
  return path === base || path.startsWith(base === "/" ? "/" : `${base}/`);
}
