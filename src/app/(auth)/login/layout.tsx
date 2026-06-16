import type { Metadata } from "next";

// login/page.tsx is a client component and can't export metadata, so the
// description lives here. Without it the route inherited the root layout's
// generic 41-char string (flagged "meta description too short" by site audits).
export const metadata: Metadata = {
  title: "Sign in - Lastest",
  description:
    "Sign in to Lastest to run AI-generated visual regression tests, review diffs, and approve baselines. Free, open-source, and self-hostable via Docker.",
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
