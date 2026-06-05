"use client";

/**
 * Per-test Design System config card.
 *
 * Lives on the Setup ("Overrides") tab of the test detail page. The user
 * pastes a CSS file containing token declarations (typically the project's
 * `colors_and_type.css` or the `:root { ... }` block from a design system
 * export). On save the server parses every `--token: value;` declaration,
 * categorizes it (color / border-radius / font-family / font-size /
 * spacing), and stores the normalized set on `tests.designSystemOverrides`.
 *
 * At test-run time the EB walks the live DOM, samples computed styles for
 * the relevant CSS properties on every visible element, and emits a
 * violation when a value isn't in the allowed set. Same surface model as
 * the a11y layer: per-test_result violations roll up into a build-level
 * score and drill-in panel on the verify page.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Palette, RotateCcw, Check } from "lucide-react";
import { toast } from "sonner";
import {
  saveTestDesignSystemFromCss,
  resetTestDesignSystemOverrides,
} from "@/server/actions/design-system-overrides";
import { parseDesignSystemCss } from "@/lib/design-system/tokens";
import type { DesignSystemConfig, DesignTokenCategory } from "@/lib/db/schema";

interface TestDesignSystemOverridesProps {
  testId: string;
  overrides: Partial<DesignSystemConfig> | null;
  /** Repo-level fallback so the UI can show "inheriting from repo" when
   *  the test has no override of its own. */
  repoDefault?: DesignSystemConfig | null;
  /** True when the repo-level `enableDesignSystem` toggle is on. When
   *  false we show a hint pointing to Playwright Settings. */
  enabledForRepo?: boolean;
}

const CATEGORY_LABELS: Record<DesignTokenCategory, string> = {
  color: "Colors",
  "border-radius": "Radii",
  "font-family": "Fonts",
  "font-size": "Type scale",
  spacing: "Spacing",
};

const PLACEHOLDER = `/* Paste your design-system CSS here. Example: */
:root {
  --c-red:   #E03E36;
  --c-teal:  #36A88E;
  --c-blue:  #3674A8;
  --c-ink:   #1F2A33;
  --r-xs:    4px;
  --r-md:    8px;
  --r-pill:  999px;
  --font-sans: "Inter", system-ui, sans-serif;
}`;

function countTokens(
  config: Partial<DesignSystemConfig> | null | undefined,
): Record<DesignTokenCategory, number> {
  const out = {
    color: 0,
    "border-radius": 0,
    "font-family": 0,
    "font-size": 0,
    spacing: 0,
  } as Record<DesignTokenCategory, number>;
  if (!config?.tokens) return out;
  for (const [cat, list] of Object.entries(config.tokens) as Array<
    [DesignTokenCategory, unknown]
  >) {
    if (Array.isArray(list)) out[cat] = list.length;
  }
  return out;
}

export function TestDesignSystemOverrides({
  testId,
  overrides,
  repoDefault,
  enabledForRepo,
}: TestDesignSystemOverridesProps) {
  const [css, setCss] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [savedConfig, setSavedConfig] =
    useState<Partial<DesignSystemConfig> | null>(overrides);

  // Live token counts as the user types — gives instant feedback without
  // round-tripping. The persisted config comes back from the server on
  // save and replaces the preview.
  const previewConfig = useMemo<DesignSystemConfig | null>(() => {
    if (!css.trim()) return null;
    try {
      return parseDesignSystemCss(css);
    } catch {
      return null;
    }
  }, [css]);

  const effective = previewConfig ?? savedConfig ?? null;
  const counts = useMemo(() => countTokens(effective), [effective]);
  const totalTokens = useMemo(
    () => Object.values(counts).reduce((a, b) => a + b, 0),
    [counts],
  );

  const inheriting = !savedConfig && !!repoDefault;
  const repoCounts = useMemo(() => countTokens(repoDefault), [repoDefault]);
  const repoTotal = useMemo(
    () => Object.values(repoCounts).reduce((a, b) => a + b, 0),
    [repoCounts],
  );

  const handleSave = useCallback(async () => {
    if (!css.trim()) {
      toast.error("Paste some CSS first");
      return;
    }
    setIsSaving(true);
    try {
      const res = await saveTestDesignSystemFromCss(testId, css);
      if (res.success) {
        setSavedConfig(res.config);
        setCss("");
        const c = countTokens(res.config);
        const total = Object.values(c).reduce((a, b) => a + b, 0);
        toast.success(`Saved ${total} design token${total === 1 ? "" : "s"}`);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save design system",
      );
    } finally {
      setIsSaving(false);
    }
  }, [testId, css]);

  const handleReset = useCallback(async () => {
    setIsSaving(true);
    try {
      await resetTestDesignSystemOverrides(testId);
      setSavedConfig(null);
      setCss("");
      toast.success("Reverted to repo default");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reset");
    } finally {
      setIsSaving(false);
    }
  }, [testId]);

  // Sync local state when the parent refreshes (e.g. another tab edits the row).
  useEffect(() => {
    setSavedConfig(overrides);
  }, [overrides]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-sm font-medium">
          <span className="flex items-center gap-2">
            <Palette className="h-4 w-4" />
            Design System
          </span>
          {!enabledForRepo && (
            <span className="text-[10px] text-muted-foreground font-normal">
              Enable in{" "}
              <a href="../settings" className="underline">
                Playwright Settings → Design System Checks
              </a>
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Paste a CSS file with design tokens. During the test, the captured DOM
          is checked against this set — any computed color, radius, or font
          outside it shows up in the Verify Design System tab, scored 0–100 like
          accessibility checks.
        </p>

        {savedConfig && !previewConfig && (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <Check className="h-3.5 w-3.5 text-primary" />
                Test-level tokens active ({totalTokens})
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleReset}
                disabled={isSaving}
                className="h-7 text-xs gap-1"
              >
                <RotateCcw className="h-3 w-3" /> Use repo default
              </Button>
            </div>
            <TokenCountStrip counts={counts} />
          </div>
        )}

        {inheriting && (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <div className="text-xs text-muted-foreground">
              Inheriting{" "}
              <span className="font-medium text-foreground">
                {repoTotal} token{repoTotal === 1 ? "" : "s"}
              </span>{" "}
              from repo
            </div>
            <TokenCountStrip counts={repoCounts} />
          </div>
        )}

        <div className="space-y-2">
          <Label className="text-xs">CSS token source</Label>
          <Textarea
            value={css}
            onChange={(e) => setCss(e.target.value)}
            placeholder={PLACEHOLDER}
            rows={10}
            className="font-mono text-xs"
            spellCheck={false}
          />
          {previewConfig && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-2 space-y-1.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Preview · {totalTokens} token{totalTokens === 1 ? "" : "s"}
              </div>
              <TokenCountStrip counts={counts} />
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving || !css.trim()}
          >
            Save design tokens
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TokenCountStrip({
  counts,
}: {
  counts: Record<DesignTokenCategory, number>;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {(Object.entries(counts) as Array<[DesignTokenCategory, number]>)
        .filter(([, n]) => n > 0)
        .map(([cat, n]) => (
          <Badge key={cat} variant="outline" className="text-[10px]">
            {CATEGORY_LABELS[cat]} · {n}
          </Badge>
        ))}
      {Object.values(counts).every((n) => n === 0) && (
        <span className="text-[10px] text-muted-foreground">
          no tokens parsed
        </span>
      )}
    </div>
  );
}
