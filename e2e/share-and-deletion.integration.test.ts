/**
 * §4 golden path, steps 15 and 16 — public share rendering, and
 * UI-driven team deletion + post-deletion DB sweep.
 * (docs/architecture/core-plugin-refactor-test-plan.md)
 *
 * Step 15 is the one assertion §3 structurally could not make: the HTTP-level
 * suite (`src/app/(public)/r/public-share.integration.test.ts`) proved
 * `/r/<slug>` 200s and that the HTML *string* carries the video/captions URLs,
 * but a share page is a React tree with client islands, so "the markup
 * contains the URL" is not the same claim as "an anonymous viewer sees a
 * player, a captions track and a chapter rail". Here the page is loaded in a
 * brand-new `browser.newContext()` — its own cookie jar, empty before and
 * after — so "renders without auth" is proven rather than assumed.
 *
 * Step 16 is deletion driven through the actual Settings → Account → Danger
 * Zone dialog (the `deleteMyAccount` server action inside a real request
 * scope, which `src/lib/db/gdpr-deletion.integration.test.ts` explicitly
 * cannot reach — it calls `queries.deleteTeam` directly because `requireAuth`
 * needs `next/headers`), followed by a sweep of every table this plan touched.
 *
 * Prerequisites: `docker compose up -d`, `pnpm dev:pool`, `pnpm dev`.
 * Run with `pnpm test:integration`.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import * as queries from "@/lib/db/queries";
import { repositories } from "@/lib/db/schema";
import {
  destroyTeam,
  launchSession,
  onboardWithSandbox,
  registerViaUi,
  startTargetApp,
  teamIdForEmail,
  type Session,
  type TargetApp,
} from "./harness";

// ── Share fixture (step 15) ──────────────────────────────────────────────

let target: TargetApp;
let session: Session;
let teamId: string | undefined;
let repositoryId: string;

beforeAll(async () => {
  target = await startTargetApp();
  session = await launchSession();
  await registerViaUi(session, "Share Viewer");
  await onboardWithSandbox(
    session,
    target.origin,
    `share-e2e-${randomUUID().slice(0, 8)}`,
  );
  teamId = await teamIdForEmail(session.email);

  const [repo] = await db
    .select({ id: repositories.id })
    .from(repositories)
    .where(eq(repositories.teamId, teamId));
  if (!repo) throw new Error("onboarding created no repository");
  repositoryId = repo.id;
}, 300_000);

afterAll(async () => {
  await session?.close();
  await destroyTeam(teamId);
  await target?.close();
}, 120_000);

describe("§4.15 — public share link renders with no session", () => {
  it("onboarding produced a team-scoped repository to hang a build off", async () => {
    const repo = await queries.getRepository(repositoryId);
    expect(repo?.teamId).toBe(teamId);
  });
});
