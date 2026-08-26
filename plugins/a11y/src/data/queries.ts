import { and, eq } from "drizzle-orm";

import {
  a11yBaselines,
  type A11yBaseline,
  type NewA11yBaseline,
} from "../schema";
import type { A11yDb } from "./db";

/**
 * Every read and write a11y performs, against its own table through the
 * handle `ctx.data` supplied. Ported from the a11y slice of
 * `src/lib/db/queries/layer-baselines.ts`, which shared one `db` handle with
 * every table in the app; the six sibling layer-baseline tables stay there,
 * still core-owned.
 */

export async function listActiveA11yBaselines(
  db: A11yDb,
  testId: string,
  branch: string,
): Promise<A11yBaseline[]> {
  return db
    .select()
    .from(a11yBaselines)
    .where(
      and(
        eq(a11yBaselines.testId, testId),
        eq(a11yBaselines.branch, branch),
        eq(a11yBaselines.isActive, true),
      ),
    );
}

export async function createA11yBaseline(
  db: A11yDb,
  input: Omit<NewA11yBaseline, "id" | "isActive" | "approvedAt" | "createdAt">,
): Promise<A11yBaseline> {
  const id = crypto.randomUUID();
  await db
    .insert(a11yBaselines)
    .values({ id, ...input, isActive: true, approvedAt: new Date() });
  const [row] = await db
    .select()
    .from(a11yBaselines)
    .where(eq(a11yBaselines.id, id));
  return row;
}
