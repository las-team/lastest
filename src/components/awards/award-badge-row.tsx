import type { RepoAward } from "@/lib/db/schema";
import { SplitShield } from "./badges";

const TIER_TONE_MAP = {
  none: { tone: "ink" as const, value: "not yet" },
  starter: { tone: "slate" as const, value: "starter" },
  bronze: { tone: "amber" as const, value: "bronze" },
  silver: { tone: "blue" as const, value: "silver" },
  gold: { tone: "teal" as const, value: "gold" },
};

export function AwardBadgeRow({ award }: { award: RepoAward }) {
  const tierMap = TIER_TONE_MAP[award.currentTier];
  const cats = award.categories;

  const earnedBadges: Array<{
    type: string;
    preview: React.ReactNode;
  }> = [
    {
      type: "tier",
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

  return (
    <section className="not-prose mt-6 rounded-sm border border-border/60 bg-card p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.10em] text-muted-foreground">
            Earned · Lastest awards
          </div>
          <h3 className="text-base font-semibold mt-0.5">
            Proof your app is not AI slop
          </h3>
        </div>
        {award.highestTier !== "none" &&
          award.highestTier !== award.currentTier && (
            <div className="font-mono text-[10px] uppercase tracking-[0.10em] text-muted-foreground">
              highest reached: {award.highestTier}
            </div>
          )}
      </div>

      <div className="flex flex-wrap gap-2">
        {earnedBadges.map((b) => (
          <div key={b.type}>{b.preview}</div>
        ))}
      </div>

      <div className="font-mono text-[10px] uppercase tracking-[0.10em] text-muted-foreground mt-4">
        Badges stay live, ratchet upward, only downgrade on confirmed
        regression.
      </div>
    </section>
  );
}
