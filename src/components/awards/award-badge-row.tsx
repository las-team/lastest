import type { RepoAward } from "@/lib/db/schema";
import { buildShareUrl } from "@/lib/share/slug";
import { SplitShield } from "./badges";
import { EmbedCodeBlock } from "./embed-code-block";

function badgeUrl(
  base: string,
  slug: string,
  type: string,
  opts?: { theme?: "light" | "dark"; size?: "sm" | "md" | "lg" },
) {
  const params = new URLSearchParams();
  if (opts?.theme) params.set("theme", opts.theme);
  if (opts?.size) params.set("size", opts.size);
  const qs = params.toString();
  return `${base}/api/badge/${slug}/${type}.svg${qs ? `?${qs}` : ""}`;
}

const TIER_TONE_MAP = {
  none: { tone: "ink" as const, value: "not yet" },
  starter: { tone: "slate" as const, value: "starter" },
  bronze: { tone: "amber" as const, value: "bronze" },
  silver: { tone: "blue" as const, value: "silver" },
  gold: { tone: "teal" as const, value: "gold" },
};

export function AwardBadgeRow({
  award,
  slug,
  origin,
}: {
  award: RepoAward;
  slug: string;
  origin?: string;
}) {
  // Base URL: prefer the configured public origin server-side; the actual
  // <img> tag will be evaluated by whatever site embeds it.
  const base = (origin ?? process.env.NEXT_PUBLIC_APP_URL ?? "").replace(
    /\/+$/,
    "",
  );
  const shareUrl = base ? `${base}/r/${slug}` : buildShareUrl(slug);

  const tierMap = TIER_TONE_MAP[award.currentTier];
  const cats = award.categories;

  const earnedBadges: Array<{
    type: string;
    preview: React.ReactNode;
    alt: string;
  }> = [
    {
      type: "tier",
      alt: `Lastest, ${tierMap.value}`,
      preview: (
        <SplitShield
          label="LASTEST"
          value={tierMap.value}
          tone={tierMap.tone}
          size="md"
          mark
        />
      ),
    },
  ];
  if (cats.allPassing) {
    earnedBadges.push({
      type: "all-passing",
      alt: "Lastest, all passing",
      preview: (
        <SplitShield
          label="tests"
          value="all passing"
          tone="teal"
          size="md"
          mark={false}
        />
      ),
    });
  }
  if (cats.a11y) {
    earnedBadges.push({
      type: "a11y",
      alt: "Lastest, A11y WCAG AA",
      preview: (
        <SplitShield
          label="a11y"
          value="WCAG AA"
          tone="teal"
          size="md"
          mark={false}
        />
      ),
    });
  }
  if (cats.zeroDrift) {
    earnedBadges.push({
      type: "zero-drift",
      alt: "Lastest, zero regressions",
      preview: (
        <SplitShield
          label="regressions"
          value="0"
          tone="ink"
          size="md"
          mark={false}
        />
      ),
    });
  }

  const markdownLines = earnedBadges
    .map((b) => `[![${b.alt}](${badgeUrl(base, slug, b.type)})](${shareUrl})`)
    .join(" ");
  const htmlLines = earnedBadges
    .map(
      (b) =>
        `<a href="${shareUrl}"><img src="${badgeUrl(base, slug, b.type)}" alt="${b.alt}" height="26" /></a>`,
    )
    .join("\n");

  return (
    <section className="not-prose mt-6 rounded-sm border border-border/60 bg-card p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.10em] text-muted-foreground">
            Earned · Lastest awards
          </div>
          <h3 className="text-base font-semibold mt-0.5">
            Embed proof your app is not AI slop
          </h3>
        </div>
        {award.highestTier !== "none" &&
          award.highestTier !== award.currentTier && (
            <div className="font-mono text-[10px] uppercase tracking-[0.10em] text-muted-foreground">
              highest reached: {award.highestTier}
            </div>
          )}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {earnedBadges.map((b) => (
          <div key={b.type}>{b.preview}</div>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <EmbedCodeBlock label="Markdown" code={markdownLines} />
        <EmbedCodeBlock label="HTML" code={htmlLines} />
      </div>

      <div className="font-mono text-[10px] uppercase tracking-[0.10em] text-muted-foreground mt-4">
        Badges stay live, ratchet upward, only downgrade on confirmed
        regression.
      </div>
    </section>
  );
}
