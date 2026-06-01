import type { Metadata } from "next";
import {
  CardBadge,
  Pill,
  SplitShield,
  Wordmark,
} from "@/components/awards/badges";
import { DeltaMark } from "@/components/awards/delta-mark";
import { EmbedCodeBlock } from "@/components/awards/embed-code-block";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Prove your app is not AI slop · Lastest awards",
  description:
    "Earn a Lastest testing badge. Visual regression tested, accessibility checked, drift-free. Embed proof on your site.",
  robots: { index: true, follow: true },
};

const EXAMPLE_SLUG = "EXAMPLE".padEnd(22, "0");

export default function AwardsLandingPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 py-14 space-y-14">
      <Hero />
      <HowItWorks />
      <TierCriteria />
      <Categories />
      <EmbedShowcase />
      <FAQ />
      <FinalCTA />
    </main>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function Hero() {
  return (
    <section className="text-center space-y-6">
      <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.10em] text-muted-foreground border border-border/60 rounded-sm px-2 py-1">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Lastest awards · live program
      </div>
      <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight leading-[1.05]">
        Prove your app is{" "}
        <span className="relative inline-block">
          <span className="line-through decoration-[#E03E36] decoration-[3px] text-foreground/40">
            AI slop
          </span>
        </span>
        <span className="block sm:inline">.</span>
      </h1>
      <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
        Most apps shipped today look polished and break on the first real
        interaction. A Lastest badge is sourced proof: real visual regression
        coverage, accessibility checked, no drift over time.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <SplitShield label="LASTEST" value="gold" tone="teal" size="lg" mark />
        <SplitShield
          label="a11y"
          value="WCAG AA"
          tone="teal"
          size="lg"
          mark={false}
        />
        <SplitShield
          label="regressions"
          value="0"
          tone="ink"
          size="lg"
          mark={false}
        />
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <a
          href="/register"
          className="inline-flex items-center gap-2 rounded-sm bg-[#36A88E] hover:bg-[#2E957D] text-white px-5 py-2.5 text-sm font-medium transition"
        >
          Start earning a badge
        </a>
        <a
          href="#criteria"
          className="inline-flex items-center gap-2 rounded-sm border border-border/80 hover:bg-muted/50 px-5 py-2.5 text-sm font-medium transition"
        >
          See criteria
        </a>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "Sign up & connect your app",
      body: "Point Lastest at your live URL. Record a couple of flows or let the Play Agent crawl your routes.",
    },
    {
      n: "02",
      title: "Run tests, review baselines",
      body: "Lastest captures screenshots, runs accessibility checks, and detects visual drift on every commit.",
    },
    {
      n: "03",
      title: "Embed your badge",
      body: "Once your tier is earned, copy the markdown or HTML embed onto your site, README, or docs.",
    },
  ];
  return (
    <section className="space-y-6">
      <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
      <ol className="grid sm:grid-cols-3 gap-4">
        {steps.map((s) => (
          <li
            key={s.n}
            className="rounded-sm border border-border/60 bg-card p-5 space-y-2"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.10em] text-muted-foreground">
              Step {s.n}
            </div>
            <div className="text-base font-medium">{s.title}</div>
            <div className="text-sm text-muted-foreground leading-relaxed">
              {s.body}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function TierCriteria() {
  const tiers = [
    {
      tier: "starter" as const,
      value: "starter",
      tone: "slate" as const,
      criteria: [
        "≥ 1 passing test",
        "Awarded on your first green build",
        "Encourages early sharing, no a11y bar",
      ],
    },
    {
      tier: "bronze" as const,
      value: "bronze",
      tone: "amber" as const,
      criteria: [
        "≥ 5 tests",
        "≥ 80% pass rate on last build",
        "a11y score ≥ 60",
      ],
    },
    {
      tier: "silver" as const,
      value: "silver",
      tone: "blue" as const,
      criteria: [
        "≥ 10 tests",
        "≥ 95% pass rate on last build",
        "a11y score ≥ 80, 0 critical violations",
      ],
    },
    {
      tier: "gold" as const,
      value: "gold",
      tone: "teal" as const,
      criteria: [
        "≥ 20 tests",
        "Last 5 builds all clean (no regressions, no flakes)",
        "a11y score ≥ 90, 0 critical violations",
      ],
    },
  ];

  return (
    <section id="criteria" className="space-y-6">
      <h2 className="text-2xl font-semibold tracking-tight">Tier criteria</h2>
      <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
        Tiers ratchet upward. They only downgrade on a{" "}
        <em>confirmed regression</em>: a baseline you explicitly rejected, or
        two consecutive builds with non-flaky failures. Flakes alone don&apos;t
        downgrade you.
      </p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {tiers.map((t) => (
          <div
            key={t.tier}
            className="rounded-sm border border-border/60 bg-card p-5 space-y-4"
          >
            <SplitShield
              label="LASTEST"
              value={t.value}
              tone={t.tone}
              size="lg"
              mark
            />
            <ul className="space-y-1.5 text-sm">
              {t.criteria.map((c) => (
                <li key={c} className="flex gap-2">
                  <span className="text-[#36A88E] flex-shrink-0">✓</span>
                  <span className="text-muted-foreground">{c}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function Categories() {
  const cats = [
    {
      title: "A11y",
      preview: (
        <SplitShield
          label="a11y"
          value="WCAG AA"
          tone="teal"
          size="md"
          mark={false}
        />
      ),
      body: "a11y score ≥ 90 and zero critical WCAG violations on your latest build.",
    },
    {
      title: "All passing",
      preview: (
        <SplitShield
          label="tests"
          value="all passing"
          tone="teal"
          size="md"
          mark={false}
        />
      ),
      body: "No failed tests and no unresolved visual changes on your latest build.",
    },
    {
      title: "Zero drift",
      preview: (
        <SplitShield
          label="regressions"
          value="0"
          tone="ink"
          size="md"
          mark={false}
        />
      ),
      body: "No confirmed regressions in the last 30 days. Tracks rejected baselines.",
    },
  ];

  return (
    <section className="space-y-6">
      <h2 className="text-2xl font-semibold tracking-tight">Category badges</h2>
      <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
        Earn alongside your tier. Pick which to embed; they are independent of
        each other and update live.
      </p>
      <div className="grid sm:grid-cols-3 gap-4">
        {cats.map((c) => (
          <div
            key={c.title}
            className="rounded-sm border border-border/60 bg-card p-5 space-y-3"
          >
            <div>{c.preview}</div>
            <div className="text-sm font-medium">{c.title}</div>
            <div className="text-sm text-muted-foreground leading-relaxed">
              {c.body}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function EmbedShowcase() {
  const markdown = `[![Tested by Lastest](https://lastest.cloud/api/badge/${EXAMPLE_SLUG}/tier.svg)](https://lastest.cloud/r/${EXAMPLE_SLUG})
[![A11y WCAG AA](https://lastest.cloud/api/badge/${EXAMPLE_SLUG}/a11y.svg)](https://lastest.cloud/r/${EXAMPLE_SLUG})`;

  const html = `<a href="https://lastest.cloud/r/${EXAMPLE_SLUG}">
  <img src="https://lastest.cloud/api/badge/${EXAMPLE_SLUG}/tier.svg"
       alt="Tested by Lastest" height="26" />
</a>`;

  return (
    <section className="space-y-6">
      <h2 className="text-2xl font-semibold tracking-tight">
        Embed three ways
      </h2>
      <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
        Each badge is an SVG endpoint. Pull from any host. The image stays live
        and ratchets with your build state. Themed for light or dark sites via{" "}
        <code className="font-mono text-xs">?theme=light|dark</code>.
      </p>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-3 rounded-sm border border-border/60 bg-card p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">README · light site</div>
            <Pill tone="soft" size="sm" mark={false} dot="pass">
              live
            </Pill>
          </div>
          <div className="flex flex-wrap gap-2">
            <SplitShield label="LASTEST" value="gold" tone="teal" size="sm" />
            <SplitShield
              label="tests"
              value="247/247"
              tone="teal"
              size="sm"
              mark={false}
            />
            <SplitShield
              label="a11y"
              value="WCAG AA"
              tone="teal"
              size="sm"
              mark={false}
            />
            <SplitShield
              label="last run"
              value="12m ago"
              tone="ink"
              size="sm"
              mark={false}
            />
          </div>
          <EmbedCodeBlock label="Markdown" code={markdown} />
        </div>

        <div
          className="space-y-3 rounded-sm border border-border/60 p-5"
          style={{ background: "#1F2A33", color: "#fff" }}
        >
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Docs · dark site</div>
            <Pill tone="soft" size="sm" mark={false} dark dot="pass">
              live
            </Pill>
          </div>
          <div className="flex flex-wrap gap-2">
            <SplitShield
              label="LASTEST"
              value="gold"
              tone="teal"
              size="sm"
              dark
            />
            <SplitShield
              label="regressions"
              value="0"
              tone="ink"
              size="sm"
              mark={false}
              dark
            />
            <SplitShield
              label="last run"
              value="12m ago"
              tone="ink"
              size="sm"
              mark={false}
              dark
            />
          </div>
          <EmbedCodeBlock label="HTML" code={html} />
        </div>
      </div>

      <div className="rounded-sm border border-border/60 bg-card p-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.10em] text-muted-foreground mb-3">
          Hero card · drop-in for status pages
        </div>
        <div className="flex flex-wrap gap-6 items-center">
          <CardBadge variant="horizontal" />
        </div>
      </div>
    </section>
  );
}

function FAQ() {
  const faqs = [
    {
      q: "Does my badge break if a test fails?",
      a: "No. Flakes don't downgrade your tier. The badge only drops when a regression is *confirmed*, either you explicitly rejected a baseline diff, or two consecutive builds both had real (non-flaky) failures.",
    },
    {
      q: "Where does the badge SVG come from?",
      a: "A public endpoint on lastest.cloud serves it. The SVG is self-contained, cache-friendly (5min CDN), and embeds anywhere. The image stays live: republish your share to point at a fresh proof.",
    },
    {
      q: "Is the badge actually verifiable?",
      a: "Yes, clicking it opens your public share, which shows every screenshot, every diff, every accessibility check. The badge is just a link to evidence anyone can audit.",
    },
    {
      q: "Is this free?",
      a: "Lastest is open-source and self-hostable. The hosted version has a generous free tier, enough to earn and maintain a Silver or Gold badge for most indie projects.",
    },
  ];

  return (
    <section className="space-y-6">
      <h2 className="text-2xl font-semibold tracking-tight">FAQ</h2>
      <div className="space-y-3">
        {faqs.map((f) => (
          <details
            key={f.q}
            className="rounded-sm border border-border/60 bg-card p-4 group"
          >
            <summary className="cursor-pointer text-sm font-medium list-none flex justify-between items-center">
              <span>{f.q}</span>
              <span className="font-mono text-xs text-muted-foreground group-open:rotate-45 transition-transform">
                +
              </span>
            </summary>
            <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
              {f.a}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="rounded-sm border border-border/60 bg-card p-8 sm:p-10 text-center space-y-5">
      <div className="flex items-center justify-center">
        <DeltaMark size={36} tone="dark" />
      </div>
      <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
        Ship green. Embed proof. Look serious.
      </h2>
      <p className="text-sm text-muted-foreground max-w-xl mx-auto leading-relaxed">
        Be the indie project on Reddit, Product Hunt, or Hacker News whose badge
        is sourced, not vibes.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <a
          href="/register"
          className="inline-flex items-center gap-2 rounded-sm bg-[#36A88E] hover:bg-[#2E957D] text-white px-5 py-2.5 text-sm font-medium transition"
        >
          Start earning a badge
        </a>
        <a
          href="/login"
          className="inline-flex items-center gap-2 rounded-sm border border-border/80 hover:bg-muted/50 px-5 py-2.5 text-sm font-medium transition"
        >
          Sign in
        </a>
      </div>
      <div className="font-mono text-[10px] uppercase tracking-[0.10em] text-muted-foreground pt-4">
        Tested with <Wordmark size={10} />
      </div>
    </section>
  );
}
