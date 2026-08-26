/**
 * Thrown by `ownedSession` in `actions.ts` for "missing" and "someone else's"
 * session alike — the difference is itself information about another team's
 * data. Lives outside `actions.ts` because that file has `"use server"` at
 * the top, and Next.js only allows async function exports from a file with
 * that directive — a class export (or a re-export, per that file's own
 * comment) silently breaks the server-action manifest.
 *
 * Callers must catch only this class to map to "not found"; anything else (a
 * DB error, a runtime failure) is a real 500 and must not be swallowed as if
 * the session simply didn't exist.
 */
export class ExplorerSessionNotFoundError extends Error {
  constructor() {
    super("Explorer session not found");
    this.name = "ExplorerSessionNotFoundError";
  }
}
