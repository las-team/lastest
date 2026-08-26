/**
 * Thrown for "missing" and "someone else's" session alike — the difference is
 * itself information about another team's data. Lives outside `actions.ts`
 * for the same reason `plugins/explorer/src/errors.ts` does: that file has
 * `"use server"` at the top, and a class export from it silently breaks the
 * server-action manifest.
 */
export class RangerSessionNotFoundError extends Error {
  constructor() {
    super("Ranger session not found");
    this.name = "RangerSessionNotFoundError";
  }
}
