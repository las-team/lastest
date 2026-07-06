import type { Metadata } from "next";

// register/page.tsx is a client component and can't export metadata, so it
// lives here. Without it the route inherited the root layout's generic title
// and description (weak SEO), and — like /login — had no canonical, so the
// `/register?claim=<slug>` links on share pages were flagged by GSC as
// "Duplicate without user-selected canonical". A self-referential canonical
// (resolved against the root metadataBase) folds every claim variant into the
// bare /register. Relative on purpose so it tracks the origin in dev/self-host.
export const metadata: Metadata = {
  title: "Sign up - Lastest",
  description:
    "Create a free Lastest account to run AI-generated visual regression tests, catch UI bugs with pixel diffs, and approve baselines. Open-source and self-hostable via Docker.",
  alternates: { canonical: "/register" },
};

export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
