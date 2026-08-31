import { redirect } from "next/navigation";
import { getDiff } from "@/server/actions/diffs";
import { getStepComparisonsByBuild } from "@/lib/db/queries";

/**
 * The classic diff viewer was superseded by Verify's Focus view
 * (docs/architecture/retire-run-build-pages.md §2 item 19).
 *
 * A diff maps to a case through `(testId, stepLabel)` — the same key the board
 * uses to attach visuals to `step_comparisons`. When the lookup finds nothing
 * (a diff whose step was never scored, or a build predating the multi-layer
 * scorer) we land on the build's board rather than 404: the user asked to see
 * a change, and the board shows every change in that build.
 */
export default async function DiffPage({
  params,
}: {
  params: Promise<{ buildId: string; diffId: string }>;
}) {
  const { buildId, diffId } = await params;
  const diff = await getDiff(diffId).catch(() => null);
  if (!diff) redirect(`/verify/${buildId}`);

  const steps = await getStepComparisonsByBuild(buildId).catch(() => []);
  const match = steps.find(
    (s) =>
      s.testId === diff.testId &&
      (s.stepLabel ?? "") === (diff.stepLabel ?? ""),
  );
  redirect(
    match
      ? `/verify/${buildId}?mode=focus&step=${match.id}`
      : `/verify/${buildId}`,
  );
}
