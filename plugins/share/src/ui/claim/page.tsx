import { notFound } from "next/navigation";

import { isValidShareSlug } from "../../slug";
import { getPublicShareBySlug } from "../../data/queries";
import { ClaimRunner } from "./claim-runner-client";

export interface ClaimPageProps {
  params: Promise<{ slug: string }>;
}

/**
 * The claim runner's page. Session resolution (redirect to `/login` when
 * unauthenticated) stays in the app's thin wrapper
 * (`src/app/(public)/r/[slug]/claim/page.tsx`) — it is a nicer UX than
 * letting `claimPublicShare`'s own `contextFor()` authorization throw, and
 * "resolve the session, decide whether to redirect" is app composition, not
 * this plugin's concern (`plugin-migration-recipe.md` §6).
 */
export async function ClaimPage({ params }: ClaimPageProps) {
  const { slug } = await params;
  if (!isValidShareSlug(slug)) notFound();

  const share = await getPublicShareBySlug(slug);
  if (!share || share.status !== "public") notFound();

  return <ClaimRunner slug={slug} />;
}
