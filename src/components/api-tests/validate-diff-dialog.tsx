"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { validateDiffAction } from "@/server/actions/api-tests";
import type { ValidateDiffResult } from "@/server/actions/validate-diff";

/**
 * Diff-scoped validation (E6) for humans. Paste a unified git diff, map it to
 * affected tests, run just those, and read back the verdict. Mirrors the
 * `lastest_validate_diff` MCP verb so CLI agents and people share one flow.
 */
export function ValidateDiffDialog({
  open,
  onOpenChange,
  repositoryId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  repositoryId: string;
}) {
  const [diff, setDiff] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ValidateDiffResult | null>(null);

  async function handleRun() {
    if (!diff.trim()) {
      toast.error("Paste a unified diff to validate.");
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const res = await validateDiffAction({ repositoryId, diff, wait: true });
      setResult(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Validation failed.");
    } finally {
      setRunning(false);
    }
  }

  const tone =
    result?.status === "pass"
      ? "default"
      : result?.status === "fail"
        ? "destructive"
        : "secondary";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Validate a diff</DialogTitle>
          <DialogDescription>
            Map a code change to the tests it affects, run only those, and get a
            merge verdict.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <Label className="text-xs">Unified git diff</Label>
          <Textarea
            value={diff}
            onChange={(e) => setDiff(e.target.value)}
            placeholder="git diff > paste here…"
            className="font-mono text-xs min-h-40"
          />

          {result && (
            <div className="rounded-lg border p-3 space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant={tone}>{result.status}</Badge>
                <span className="text-muted-foreground">{result.summary}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {result.changedFiles.length} file(s) changed ·{" "}
                {result.scopedTestIds.length} affected test(s)
                {result.pendingVisualDiffs
                  ? ` · ${result.pendingVisualDiffs} change(s) need review`
                  : ""}
              </div>
              {result.failingTests && result.failingTests.length > 0 && (
                <ul className="text-xs space-y-1">
                  {result.failingTests.map((t) => (
                    <li key={t.testId} className="text-destructive">
                      ✕ {t.name}
                      {t.error ? ` — ${t.error}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {result.buildId && (
                <a
                  href={`/builds/${result.buildId}`}
                  className="text-xs underline text-primary"
                >
                  Open build →
                </a>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={handleRun} disabled={running}>
            {running && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Run validation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
