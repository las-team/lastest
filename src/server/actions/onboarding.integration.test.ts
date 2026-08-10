/**
 * §3 "Onboarding" (P1, not touched by this refactor).
 *
 * "New-team onboarding wizard completes and lands on the right first screen"
 * is fundamentally a rendered-React-wizard claim — there is no browser
 * automation tool available in this environment (see the test plan's §3
 * assignment), and the wizard's step sequencing / screen routing lives
 * entirely client-side with no API surface of its own. What's testable
 * without a browser is the one thing every wizard step actually persists
 * through: `queries.updateUser`'s `onboardingPath` / `onboardingCompletedAt`
 * columns, which `setOnboardingPath` / `completeOnboarding` /
 * `resetOnboarding` (src/server/actions/onboarding.ts) write.
 *
 * Those three actions aren't called directly here — like every other
 * `"use server"` action gated by `requireAuth()`, they throw outside a real
 * Next request scope (`next/headers()` — see this suite's sibling
 * `*.integration.test.ts` files for the same constraint). This test instead
 * confirms the query-layer round trip they all reduce to.
 *
 * Run with `pnpm test:integration`.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as queries from "@/lib/db/queries";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

let userId: string;

beforeAll(async () => {
  userId = randomUUID();
  await db.insert(users).values({
    id: userId,
    email: `onboarding-test-${userId}@example.test`,
    role: "owner",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

describe("onboarding wizard state (query-layer plumbing behind onboarding.ts)", () => {
  it("starts with the wizard un-started, as a fresh signup would", async () => {
    const user = await queries.getUserById(userId);
    expect(user?.onboardingCompletedAt).toBeNull();
    expect(user?.onboardingPath).toBeNull();
  });

  it("persists the chosen path, as setOnboardingPath() does per wizard step", async () => {
    await queries.updateUser(userId, { onboardingPath: "manual" });
    const user = await queries.getUserById(userId);
    expect(user?.onboardingPath).toBe("manual");
  });

  it("persists completion, as completeOnboarding() does when the wizard finishes", async () => {
    await queries.updateUser(userId, { onboardingCompletedAt: new Date() });
    const user = await queries.getUserById(userId);
    expect(user?.onboardingCompletedAt).not.toBeNull();
  });

  it("clears both fields on reset, as resetOnboarding() does", async () => {
    await queries.updateUser(userId, {
      onboardingCompletedAt: null,
      onboardingPath: null,
    });
    const user = await queries.getUserById(userId);
    expect(user?.onboardingCompletedAt).toBeNull();
    expect(user?.onboardingPath).toBeNull();
  });
});
