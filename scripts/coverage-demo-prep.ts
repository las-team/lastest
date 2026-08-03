/**
 * Restore the full 5-dimension coverage model on the kept verification repo and
 * hand it to a named user, so the Coverage screen can be viewed with Lastest's
 * own data. Throwaway helper for screenshots — not part of the product.
 *
 *   pnpm tsx scripts/coverage-demo-prep.ts <repositoryId> [userEmail]
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { repositories, users } from "@/lib/db/schema";
import * as queries from "@/lib/db/queries";
import { syncCoverage } from "@/lib/coverage/sync";

const repositoryId = process.argv[2];
const email = process.argv[3];
if (!repositoryId)
  throw new Error("usage: coverage-demo-prep <repositoryId> [email]");

async function main() {
  for (const d of await queries.getCoverageDimensions(repositoryId)) {
    if (!d.enabled) await queries.setCoverageDimensionEnabled(d.id, true);
  }
  await db
    .update(repositories)
    .set({ name: "lastest-own-data", fullName: "lastest/own-data" })
    .where(eq(repositories.id, repositoryId));

  if (email) {
    const [u] = await db.select().from(users).where(eq(users.email, email));
    if (!u) throw new Error(`no user ${email}`);
    if (!u.teamId) throw new Error(`user ${email} has no team`);
    await db
      .update(repositories)
      .set({ teamId: u.teamId })
      .where(eq(repositories.id, repositoryId));
    await db
      .update(users)
      .set({ selectedRepositoryId: repositoryId, updatedAt: new Date() })
      .where(eq(users.id, u.id));
    console.log(`repo handed to ${email} (team ${u.teamId}) and selected`);
  }

  const res = await syncCoverage(repositoryId);
  console.log(
    JSON.stringify(
      {
        dimensionsEnabled: res.dimensionsEnabled,
        cells: res.report.totals.cells,
        covered: res.report.totals.coveredCells,
        excluded: res.report.totals.excludedCells,
        byObjectType: res.report.byObjectType.map((o) => ({
          objectType: o.objectType,
          cells: o.totalCells,
          covered: o.coveredCells,
          cartesian: o.cartesianCombinations,
          skipped: o.skippedAsNonOccurring,
        })),
        queue: res.stop.queue.length,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
