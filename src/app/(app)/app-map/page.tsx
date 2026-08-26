import { redirect } from "next/navigation";

/**
 * `/app-map` folded into `/coverage`.
 *
 * The map and the data-coverage model answered the same question — what is
 * covered — on two axes, from two nav entries. They are one screen now, with
 * the canvas first; see `src/app/(app)/coverage/page.tsx` for the composition.
 *
 * The route stays as a redirect rather than being deleted: bookmarks, the
 * onboarding copy and older build comments all point at `/app-map`, and a 404
 * would read as the feature having been removed rather than moved.
 *
 * `explore-progress-panel.tsx` and `cancel-exploration.ts` still live in this
 * directory and are imported by the Coverage page — they are the app-side
 * halves of the App Map plugin's exploration flow, not route files.
 */
export default function AppMapRoute() {
  redirect("/coverage");
}
