import { redirect } from "next/navigation";

/**
 * `/builds/<id>` was retired into `/verify/<id>`
 * (docs/architecture/retire-run-build-pages.md).
 *
 * This redirect is load-bearing, not tidiness: minted `/builds/<id>` URLs sit
 * in GitHub issue bodies, Slack confirm-on-green messages, the activity feed
 * and public share records. They must keep resolving forever.
 */
export default async function BuildPage({
  params,
}: {
  params: Promise<{ buildId: string }>;
}) {
  const { buildId } = await params;
  redirect(`/verify/${buildId}`);
}
