import type { Metadata } from "next";

// login/page.tsx is a client component and can't export metadata, so the
// description lives here. Without it the route inherited the root layout's
// generic 41-char string (flagged "meta description too short" by site audits).
export const metadata: Metadata = {
  title: "Sign in - Lastest",
  description:
    "Sign in to Lastest to run AI-generated visual regression tests, review diffs, and approve baselines. Free, open-source, and self-hostable via Docker.",
  // Share pages link here as `/login?claim=<slug>`; every claim variant renders
  // identical content, so a self-referential canonical (resolved against the
  // root layout's metadataBase) folds them all into the bare /login and clears
  // GSC's "Duplicate without user-selected canonical". Relative on purpose so it
  // tracks the current origin in dev/self-host.
  alternates: { canonical: "/login" },
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
