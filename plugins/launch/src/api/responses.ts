import { NextResponse } from "next/server";

/**
 * The board's HTTP error shapes.
 *
 * A near-identical pair lives in `@/lib/http/board-responses` for
 * `/api/v1/playground`. That is deliberate rather than an oversight: the two
 * used to be one function whose doc comment had to enumerate both features'
 * failure codes, which is the shape of a module that should have been two.
 * A response body is part of an API's contract with its own frontend, and this
 * one belongs to the launch board.
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
 * Codes the launch frontend understands: `already_voted`, `account_too_new`,
 * `email_unverified`, `velocity_exceeded`, `voting_closed`, `dup_domain`,
 * `insufficient_scope`.
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
