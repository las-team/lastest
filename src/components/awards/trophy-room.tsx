"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Copy, Lock } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { AwardCategories, AwardTier, RepoAward } from "@/lib/db/schema";
import { SplitShield } from "./badges";
import { DeltaMark } from "./delta-mark";

export interface TrophyRoomEntry {
  repo: { id: string; fullName: string; owner: string; name: string };
  award: RepoAward | null;
  proofSlug: string | null;
}

const SLOTS: Array<{
  key: "tier" | "a11y" | "all-passing" | "zero-drift";
  label: string;
  description: string;
  unlockHint: string;
}> = [
  {
    key: "tier",
    label: "Tier",
    description: "Starter / Bronze / Silver / Gold",
    unlockHint:
      "Get 1 passing test for Starter. 5+ tests + 80% pass rate + a11y ≥ 60 unlocks Bronze. Gold needs 20 tests, 5 clean builds, a11y ≥ 90.",
  },
  {
    key: "a11y",
    label: "A11y",
    description: "WCAG AA compliant",
    unlockHint:
      "a11y score ≥ 90 and zero critical violations on your latest build.",
  },
  {
    key: "all-passing",
    label: "All passing",
    description: "No failed tests",
    unlockHint:
      "No failed tests and no unresolved visual changes on your latest build.",
  },
  {
    key: "zero-drift",
    label: "Zero drift",
    description: "No regressions in 30d",
    unlockHint:
      "No confirmed regressions (rejected baselines) in the last 30 days.",
  },
];

const TIER_TONE: Record<
  AwardTier,
  { value: string; tone: "amber" | "blue" | "teal" | "ink" | "slate" }
> = {
  none: { value: "not yet", tone: "ink" },
  starter: { value: "starter", tone: "slate" },
  bronze: { value: "bronze", tone: "amber" },
  silver: { value: "silver", tone: "blue" },
  gold: { value: "gold", tone: "teal" },
};

function isSlotEarned(
  slot: (typeof SLOTS)[number]["key"],
  award: RepoAward | null,
): boolean {
  if (!award) return false;
  if (slot === "tier") return award.currentTier !== "none";
  const cats = award.categories as AwardCategories;
  if (slot === "a11y") return cats.a11y;
  if (slot === "all-passing") return cats.allPassing;
  if (slot === "zero-drift") return cats.zeroDrift;
  return false;
}

export function TrophyRoom({
  entries,
  origin,
}: {
  entries: TrophyRoomEntry[];
  origin: string;
}) {
  if (entries.length === 0) {
    return <EmptyTrophyRoom />;
  }

  const totalEarned = entries.reduce((sum, e) => {
    if (!e.award) return sum;
    let n = e.award.currentTier !== "none" ? 1 : 0;
    const cats = e.award.categories as AwardCategories;
    n +=
      (cats.a11y ? 1 : 0) +
      (cats.allPassing ? 1 : 0) +
      (cats.zeroDrift ? 1 : 0);
    return sum + n;
  }, 0);
  const totalSlots = entries.length * SLOTS.length;

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">
            <DeltaMark size={12} tone="dark" />
            Trophy room
          </div>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">
            Earned Lastest awards
          </h2>
        </div>
        <div className="font-mono text-xs uppercase tracking-[0.10em] text-muted-foreground tabular-nums">
          {totalEarned} / {totalSlots} unlocked
        </div>
      </div>

      <div className="space-y-3">
        {entries.map((entry) => (
          <RepoTrophyCard key={entry.repo.id} entry={entry} origin={origin} />
        ))}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Badges stay live, ratchet upward, only downgrade on confirmed
        regression.{" "}
        <Link
          href="/awards"
          className="underline underline-offset-4 hover:text-foreground"
        >
          See full criteria
        </Link>
      </p>
    </section>
  );
}

function RepoTrophyCard({
  entry,
  origin,
}: {
  entry: TrophyRoomEntry;
  origin: string;
}) {
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const { award, repo, proofSlug } = entry;

  const earnedCount = SLOTS.filter((s) => isSlotEarned(s.key, award)).length;

  return (
    <div className="rounded-sm border border-border/60 bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/60 bg-muted/30">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.10em] text-muted-foreground">
            Repository
          </div>
          <div className="font-medium truncate">
            {repo.fullName || `${repo.owner}/${repo.name}`}
          </div>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.10em] text-muted-foreground tabular-nums shrink-0">
          {earnedCount} / {SLOTS.length}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-border/60 border-b border-border/60">
        {SLOTS.map((slot) => {
          const earned = isSlotEarned(slot.key, award);
          const isOpen = openSlot === slot.key;
          return (
            <button
              key={slot.key}
              type="button"
              onClick={() => {
                if (!earned) return;
                setOpenSlot(isOpen ? null : slot.key);
              }}
              className={cn(
                "flex flex-col items-start gap-2 p-3 text-left transition",
                earned
                  ? "cursor-pointer hover:bg-muted/40"
                  : "cursor-not-allowed opacity-45",
                isOpen && "bg-muted/60",
              )}
              aria-expanded={earned && isOpen}
              aria-disabled={!earned}
              title={earned ? "Click for embed code" : slot.unlockHint}
            >
              <div className="flex items-center justify-between w-full">
                <span className="font-mono text-[10px] uppercase tracking-[0.10em] text-muted-foreground">
                  {slot.label}
                </span>
                {earned ? (
                  <ChevronDown
                    className={cn(
                      "h-3 w-3 text-muted-foreground transition-transform",
                      isOpen && "rotate-180",
                    )}
                  />
                ) : (
                  <Lock className="h-3 w-3 text-muted-foreground" />
                )}
              </div>
              <SlotBadge slot={slot.key} earned={earned} award={award} />
              <div className="text-[11px] text-muted-foreground leading-tight">
                {earned ? slot.description : slot.unlockHint}
              </div>
            </button>
          );
        })}
      </div>

      {openSlot && proofSlug && (
        <EmbedReveal slot={openSlot} origin={origin} proofSlug={proofSlug} />
      )}
      {openSlot && !proofSlug && (
        <div className="px-4 py-3 text-sm text-muted-foreground border-t border-border/60 bg-muted/10">
          Publish a public share for this repo first, then come back to copy the
          embed code.
        </div>
      )}
    </div>
  );
}

function SlotBadge({
  slot,
  earned,
  award,
}: {
  slot: (typeof SLOTS)[number]["key"];
  earned: boolean;
  award: RepoAward | null;
}) {
  if (slot === "tier") {
    const tier: AwardTier = award?.currentTier ?? "none";
    const m = TIER_TONE[tier];
    return (
      <SplitShield
        label="LASTEST"
        value={earned ? m.value : "locked"}
        tone={earned ? m.tone : "ink"}
        size="sm"
        mark
      />
    );
  }
  if (slot === "a11y") {
    return (
      <SplitShield
        label="a11y"
        value={earned ? "WCAG AA" : "locked"}
        tone={earned ? "teal" : "ink"}
        size="sm"
        mark={false}
      />
    );
  }
  if (slot === "all-passing") {
    return (
      <SplitShield
        label="tests"
        value={earned ? "all passing" : "locked"}
        tone={earned ? "teal" : "ink"}
        size="sm"
        mark={false}
      />
    );
  }
  return (
    <SplitShield
      label="regressions"
      value={earned ? "0" : "locked"}
      tone="ink"
      size="sm"
      mark={false}
    />
  );
}

function EmbedReveal({
  slot,
  origin,
  proofSlug,
}: {
  slot: string;
  origin: string;
  proofSlug: string;
}) {
  const base = origin.replace(/\/+$/, "");
  const badgeUrl = `${base}/api/badge/${proofSlug}/${slot}.svg`;
  const shareUrl = `${base}/r/${proofSlug}`;
  const alt = `Tested by Lastest, ${slot}`;
  const markdown = `[![${alt}](${badgeUrl})](${shareUrl})`;
  const html = `<a href="${shareUrl}"><img src="${badgeUrl}" alt="${alt}" height="26" /></a>`;

  return (
    <div className="border-t border-border/60 bg-muted/10 p-4 space-y-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.10em] text-muted-foreground">
        Embed instructions, {slot}
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <CopyRow label="Markdown" code={markdown} />
        <CopyRow label="HTML" code={html} />
      </div>
      <div className="font-mono text-[10px] uppercase tracking-[0.10em] text-muted-foreground">
        Direct SVG,{" "}
        <a
          href={badgeUrl}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-4 hover:text-foreground"
        >
          {badgeUrl}
        </a>
      </div>
    </div>
  );
}

function CopyRow({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success(`${label} copied`);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed");
    }
  }
  return (
    <div className="relative">
      <div className="font-mono text-[10px] uppercase tracking-[0.10em] text-muted-foreground mb-1.5">
        {label}
      </div>
      <pre className="m-0 rounded-sm bg-background text-foreground/90 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all overflow-hidden border border-border/60">
        {code}
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className="absolute top-0 right-0 mt-[18px] mr-2 inline-flex items-center gap-1.5 rounded-sm border border-border/60 bg-background/80 px-2 py-0.5 text-[10px] font-medium text-foreground/80 hover:bg-background hover:text-foreground transition"
      >
        {copied ? (
          <Check className="h-3 w-3 text-emerald-600" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function EmptyTrophyRoom() {
  return (
    <div className="rounded-sm border border-dashed border-border/60 bg-card p-8 text-center space-y-3">
      <DeltaMark size={28} tone="dark" />
      <h2 className="text-lg font-semibold tracking-tight">No trophies yet</h2>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">
        Connect a repository and run your first build. The trophy room will fill
        with Bronze, Silver, and Gold awards as your test coverage grows.
      </p>
      <Link
        href="/awards"
        className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.10em] text-muted-foreground hover:text-foreground"
      >
        See full criteria
      </Link>
    </div>
  );
}
