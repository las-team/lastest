import type { Metadata } from "next";
import AwardsLandingPage from "@lastest/plugin-awards/page";

// Static marketing content, no session, no repo, no core read at all — the
// whole render lives in `plugins/awards`. `revalidate`/`metadata` stay here:
// Next.js requires route-segment config to be literal in the route file
// itself, the same reason `src/app/(app)/explorer/page.tsx` keeps its own
// `export const dynamic` even though the render is `@lastest/plugin-explorer`'s.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Prove your app is not AI slop · Lastest awards",
  description:
    "Earn a Lastest testing badge. Visual regression tested, accessibility checked, drift-free. Embed proof on your site.",
  robots: { index: true, follow: true },
};

export default AwardsLandingPage;
