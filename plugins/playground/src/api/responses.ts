import { NextResponse } from "next/server";

/**
 * The board's HTTP error shapes.
 *
 * Moved here from `@/lib/http/board-responses`, which is now deleted: it
 * existed only for this route, having itself been split out of
 * `src/lib/launch/api-shared.ts` when `launch` became a plugin. Its own doc
 * comment had already worked out the answer — a single shared `fail()` whose
 * comment has to enumerate two features' failure codes is the shape of a
 * module that should have been two. A response body is part of an API's
 * contract with its own frontend, and this one belongs to the playground.
 *
 * `plugins/launch/src/api/responses.ts` is the near-identical twin. The
 * duplication is the point.
 */

export function err(
  status: number,
  error: string,
  extra?: Record<string, unknown>,
  headers?: HeadersInit,
) {
  return NextResponse.json({ error, ...extra }, { status, headers });
}

/**
 * Machine-readable failure: the frontend switches on `code` (snake_case) and
 * falls back to `error` for the message. Keep both in sync.
 *
 * Codes the playground frontend understands: `insufficient_scope`,
 * `email_unverified`, `velocity_exceeded`.
 */
export function fail(
  status: number,
  code: string,
  extra?: Record<string, unknown>,
  headers?: HeadersInit,
) {
  return NextResponse.json(
    { code, error: code, ...extra },
    { status, headers },
  );
}
