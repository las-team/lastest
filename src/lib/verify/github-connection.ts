/**
 * Machine-readable marker for "this team has no GitHub account attached".
 *
 * The verify surfaces key off this to offer a Connect GitHub link that returns
 * the reviewer to the case they were on, rather than dead-ending on the message
 * text. Lives here rather than in `server/actions/verify-issues.ts` because a
 * `"use server"` module may only export async functions.
 */
export const GITHUB_NOT_CONNECTED = "github_not_connected";

export const githubNotConnected = {
  ok: false as const,
  code: GITHUB_NOT_CONNECTED,
  error: "GitHub not connected for this team",
};
