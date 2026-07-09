"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { QaAgentTrigger, QaRunMode } from "@/lib/db/schema";
import { updateQaTriggerConfig } from "@/server/actions/qa-agent";
import { timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  AlertTriangle,
  CalendarClock,
  GitPullRequest,
  Loader2,
  Save,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Automation triggers — cron schedule + PR webhook config
// ---------------------------------------------------------------------------

const CRON_PRESETS: Array<{ cron: string; label: string }> = [
  { cron: "0 3 * * *", label: "Daily at 3:00 AM" },
  { cron: "0 0 * * *", label: "Daily at midnight" },
  { cron: "0 */6 * * *", label: "Every 6 hours" },
  { cron: "0 3 * * 1", label: "Weekly on Monday at 3:00 AM" },
  { cron: "custom", label: "Custom cron…" },
];

const MODE_OPTIONS: Array<{ id: QaRunMode; label: string }> = [
  { id: "fill_gaps", label: "Fill coverage gaps" },
  { id: "refresh_spec", label: "Refresh specification" },
  { id: "full", label: "Full run" },
];

export interface QaTriggerState {
  scheduleEnabled: boolean;
  cronExpression: string;
  scheduleMode: QaRunMode;
  prEnabled: boolean;
  prMode: QaRunMode;
  nextRunAt: Date | string | null;
}

export function triggerStateFrom(
  config: QaAgentTrigger | null,
): QaTriggerState {
  return {
    scheduleEnabled: config?.scheduleEnabled ?? false,
    cronExpression: config?.cronExpression ?? "0 3 * * *",
    scheduleMode: config?.scheduleMode ?? "fill_gaps",
    prEnabled: config?.prEnabled ?? false,
    prMode: config?.prMode ?? "refresh_spec",
    nextRunAt: config?.nextRunAt ?? null,
  };
}

/** One-line trigger summary for the agent header. */
export function describeTriggers(state: QaTriggerState): string {
  const parts = ["manual runs", "task queue"];
  if (state.prEnabled) parts.push("on PR");
  if (state.scheduleEnabled && state.cronExpression) {
    const preset = CRON_PRESETS.find((p) => p.cron === state.cronExpression);
    parts.push((preset?.label ?? `cron ${state.cronExpression}`).toLowerCase());
  }
  return parts.join(" · ");
}

export function QaTriggerConfig({
  repositoryId,
  githubConnected,
  state,
  onSaved,
}: {
  repositoryId: string;
  githubConnected: boolean;
  state: QaTriggerState;
  onSaved: (next: QaTriggerState) => void;
}) {
  const [draft, setDraft] = useState<QaTriggerState>(state);
  const [preset, setPreset] = useState(() =>
    CRON_PRESETS.some((p) => p.cron === state.cronExpression)
      ? state.cronExpression
      : "custom",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    draft.scheduleEnabled !== state.scheduleEnabled ||
    draft.cronExpression !== state.cronExpression ||
    draft.scheduleMode !== state.scheduleMode ||
    draft.prEnabled !== state.prEnabled ||
    draft.prMode !== state.prMode;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const row = await updateQaTriggerConfig(repositoryId, {
        scheduleEnabled: draft.scheduleEnabled,
        cronExpression: draft.cronExpression || null,
        scheduleMode: draft.scheduleMode,
        prEnabled: draft.prEnabled,
        prMode: draft.prMode,
      });
      const next = triggerStateFrom(row);
      setDraft(next);
      onSaved(next);
      toast.success("Agent triggers saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4" />
          Automation triggers
          <span className="text-xs font-normal text-muted-foreground">
            — let the agent run itself on a schedule or on every PR
          </span>
          {dirty && (
            <Button
              size="sm"
              className="ml-auto"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {/* PR trigger */}
          <div className="rounded-md border p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <GitPullRequest className="h-3.5 w-3.5" />
                Run on pull requests
              </div>
              <Switch
                checked={draft.prEnabled}
                onCheckedChange={(v) =>
                  setDraft((d) => ({ ...d, prEnabled: v }))
                }
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Fires on PR opened/updated webhooks (GitHub). The agent
              re-discovers the branch and reports coverage of the changed
              functions and endpoints.
            </p>
            {!githubConnected && (
              <p className="text-xs text-warning">
                GitHub is not connected — PR events won&apos;t arrive until it
                is.
              </p>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Run mode</Label>
              <Select
                value={draft.prMode}
                onValueChange={(v) =>
                  setDraft((d) => ({ ...d, prMode: v as QaRunMode }))
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODE_OPTIONS.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Cron schedule */}
          <div className="rounded-md border p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <CalendarClock className="h-3.5 w-3.5" />
                Run on a schedule
              </div>
              <Switch
                checked={draft.scheduleEnabled}
                onCheckedChange={(v) =>
                  setDraft((d) => ({ ...d, scheduleEnabled: v }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">When</Label>
              <Select
                value={preset}
                onValueChange={(v) => {
                  setPreset(v);
                  if (v !== "custom") {
                    setDraft((d) => ({ ...d, cronExpression: v }));
                  }
                }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CRON_PRESETS.map((p) => (
                    <SelectItem key={p.cron} value={p.cron} className="text-xs">
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {preset === "custom" && (
                <Input
                  className="h-8 text-xs font-mono"
                  placeholder="0 3 * * * (min hour day month weekday, UTC)"
                  value={draft.cronExpression}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, cronExpression: e.target.value }))
                  }
                />
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Run mode</Label>
              <Select
                value={draft.scheduleMode}
                onValueChange={(v) =>
                  setDraft((d) => ({ ...d, scheduleMode: v as QaRunMode }))
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODE_OPTIONS.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {state.scheduleEnabled && state.nextRunAt && !dirty && (
              <p className="text-xs text-muted-foreground">
                Next run{" "}
                {new Date(state.nextRunAt) > new Date()
                  ? `at ${new Date(state.nextRunAt).toLocaleString()}`
                  : timeAgo(new Date(state.nextRunAt))}
              </p>
            )}
          </div>
        </div>
        {error && (
          <div className="flex items-start gap-1.5 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
