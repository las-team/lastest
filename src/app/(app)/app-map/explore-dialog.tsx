"use client";

import { useState } from "react";
import { Loader2, Lock, Radar } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import type { ExploreStrategy } from "@/lib/db/schema";
import type { StartExplorationInput } from "@/server/actions/app-map";

const DEPTH_LABEL = [
  "",
  "Shallow",
  "Light",
  "Medium",
  "Deep",
  "Deeper",
  "Deepest",
];
const TIME_CHOICES = [2, 5, 10, 20] as const;
const STRATEGIES: Array<{ id: ExploreStrategy; label: string; hint: string }> =
  [
    { id: "breadth", label: "Breadth-first", hint: "wide before deep" },
    { id: "balanced", label: "Balanced", hint: "mix of both" },
    { id: "depth", label: "Depth-first", hint: "follow paths down" },
  ];

/** Page budget mirror of the server derivation (6 + depth*5, cap 40). */
function pageBudget(depth: number): number {
  return Math.min(6 + depth * 5, 40);
}

export function ExploreDialog({
  open,
  onOpenChange,
  maxExplorers,
  qaAgentEnabled,
  onLaunch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Plan cap for the explorers slider (values above it are locked). */
  maxExplorers: number;
  /** Pro gate — exploration reuses the QA agent access check. */
  qaAgentEnabled: boolean;
  onLaunch: (input: StartExplorationInput) => Promise<void>;
}) {
  const [explorers, setExplorers] = useState(1);
  const [depth, setDepth] = useState(2);
  const [strategy, setStrategy] = useState<ExploreStrategy>("balanced");
  const [maxMinutes, setMaxMinutes] = useState<number>(5);
  const [authContext, setAuthContext] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [capHit, setCapHit] = useState(false);
  const [launching, setLaunching] = useState(false);

  const launch = async () => {
    setLaunching(true);
    try {
      await onLaunch({
        explorers,
        depth,
        strategy,
        maxMinutes,
        authContext: authContext.trim() || undefined,
        email: email.trim() || undefined,
        password: password || undefined,
      });
      onOpenChange(false);
    } finally {
      setLaunching(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radar className="h-4 w-4" /> Explore app
          </DialogTitle>
          <DialogDescription>
            Send explorers to crawl the app — every screen they find grows the
            map, live.
          </DialogDescription>
        </DialogHeader>

        {!qaAgentEnabled ? (
          <div className="flex flex-col items-center gap-2 rounded-md border bg-muted p-4 text-center">
            <Lock className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Exploration is a Pro feature.
            </p>
            <a
              href="/settings"
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Upgrade
            </a>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Explorers */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Explorers</span>
                <span className="text-muted-foreground">
                  {explorers} browser{explorers === 1 ? "" : "s"}
                </span>
              </div>
              <Slider
                min={1}
                max={10}
                step={1}
                value={[explorers]}
                onValueChange={([v]) => {
                  const requested = v ?? 1;
                  setCapHit(requested > maxExplorers);
                  setExplorers(Math.min(requested, maxExplorers));
                }}
              />
              {capHit && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  Your plan allows up to {maxExplorers} explorer
                  {maxExplorers === 1 ? "" : "s"} —{" "}
                  <a href="/settings" className="underline">
                    upgrade for more
                  </a>
                  .
                </p>
              )}
            </div>

            {/* Depth */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Depth</span>
                <span className="text-muted-foreground">
                  {DEPTH_LABEL[depth]} · up to {pageBudget(depth)} pages
                </span>
              </div>
              <Slider
                min={1}
                max={6}
                step={1}
                value={[depth]}
                onValueChange={([v]) => setDepth(v ?? 2)}
              />
            </div>

            {/* Strategy */}
            <div className="space-y-1.5">
              <span className="text-sm font-medium">Strategy</span>
              <div className="grid grid-cols-3 gap-1.5">
                {STRATEGIES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStrategy(s.id)}
                    className={`rounded-md border px-2 py-1.5 text-xs ${
                      strategy === s.id
                        ? "border-primary/50 bg-primary/10 font-medium text-primary"
                        : "hover:bg-muted"
                    }`}
                    title={s.hint}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Max time */}
            <div className="space-y-1.5">
              <span className="text-sm font-medium">Max time</span>
              <div className="grid grid-cols-4 gap-1.5">
                {TIME_CHOICES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMaxMinutes(m)}
                    className={`rounded-md border px-2 py-1.5 text-xs ${
                      maxMinutes === m
                        ? "border-primary/50 bg-primary/10 font-medium text-primary"
                        : "hover:bg-muted"
                    }`}
                  >
                    {m} min
                  </button>
                ))}
              </div>
            </div>

            {/* Auth context */}
            <div className="space-y-1.5">
              <span className="text-sm font-medium">
                Sign-in instructions{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </span>
              <textarea
                value={authContext}
                onChange={(e) => setAuthContext(e.target.value)}
                placeholder={`e.g. "Log in with demo@acme.com / hunter2, then tap Continue"`}
                rows={2}
                className="w-full rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email (optional)"
                  autoComplete="off"
                  className="rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
                />
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password (optional)"
                  type="password"
                  autoComplete="new-password"
                  className="rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            Cancel
          </button>
          {qaAgentEnabled && (
            <button
              type="button"
              disabled={launching}
              onClick={launch}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {launching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Radar className="h-4 w-4" />
              )}
              Explore
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
