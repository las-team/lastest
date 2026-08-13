/**
 * Error-response helpers for the public board APIs (`/api/v1/playground`).
 *
 * Split out of `src/lib/launch/api-shared.ts` when `launch` became a plugin.
 * The *identity* half of that module went to `@/lib/auth/board-actor` because
 * it is a boundary; these two are not — they are `NextResponse.json` with a
 * fixed body shape, and the shape is part of each board API's own contract
 * with its own frontend.
 *
 * The launch plugin therefore declares its own copy
 * (`plugins/launch/src/api/responses.ts`) rather than reaching back across the
 * package boundary for these six lines. That is deliberate: the failure codes
 * the launch frontend switches on are launch's business, the playground's are
 * the playground's, and a single shared `fail()` whose doc comment had to
 * enumerate both was the smell that said so.
 */

import { NextResponse } from "next/server";

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
