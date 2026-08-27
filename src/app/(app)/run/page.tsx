import { redirect } from "next/navigation";

/**
 * `/run` was retired into `/verify` (docs/architecture/retire-run-build-pages.md).
 *
 * Kept as a permanent redirect rather than deleted: the path is baked into
 * bookmarks, onboarding copy and older GitHub comments, and a 404 there reads
 * as "the product lost the run screen" rather than "it moved".
 *
 * Everything it used to render lives on Verify now — build history in the
 * header drawer, smart/all/comparison in the Run split-button — except the
 * base-URL card and branch picker, which were always duplicates of the sidebar.
 */
export default function RunPage() {
  redirect("/verify");
}
