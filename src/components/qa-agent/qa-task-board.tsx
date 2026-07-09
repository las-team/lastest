"use client";

import { useState } from "react";
import Link from "next/link";
import type { QaTask, QaTaskStatus, QaTaskTestRef } from "@/lib/db/schema";
import { timeAgo } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  CircleDashed,
  Crosshair,
  FlaskConical,
  ListTodo,
  Loader2,
  Plug,
  Plus,
  RotateCcw,
  UserRound,
  X,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Direction queue — drop ideas for the agent; it replies when done
// ---------------------------------------------------------------------------

type ColumnId = "queued" | "working" | "needs_input" | "done";

const COLUMNS: Array<{
  id: ColumnId;
  label: string;
  icon: typeof ListTodo;
  statuses: QaTaskStatus[];
}> = [
  { id: "queued", label: "Queued", icon: CircleDashed, statuses: ["queued"] },
  { id: "working", label: "Working", icon: Loader2, statuses: ["working"] },
  {
    id: "needs_input",
    label: "Waiting on you",
    icon: UserRound,
    statuses: ["needs_input"],
  },
  {
    id: "done",
    label: "Done",
    icon: CheckCircle2,
    statuses: ["done", "cancelled"],
  },
];

function SourceChip({ task }: { task: QaTask }) {
  if (task.source === "coverage_gap") {
    return (
      <Badge
        variant="outline"
        className="text-[10px] px-1.5 gap-1 bg-warning/10 text-warning border-warning/30"
      >
        <Crosshair className="h-3 w-3" />
        coverage
      </Badge>
    );
  }
  if (task.source === "mcp") {
    return (
      <Badge
        variant="outline"
        className="text-[10px] px-1.5 gap-1 bg-info/10 text-info border-info/30"
        title={task.createdByName ?? undefined}
      >
        <Plug className="h-3 w-3" />
        via MCP
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="text-[10px] px-1.5 gap-1 text-muted-foreground"
      title={task.createdByName ?? undefined}
    >
      <UserRound className="h-3 w-3" />
      {task.createdByName?.split(/[@\s]/)[0] ?? "you"}
    </Badge>
  );
}

// Chip tone by the test's outcome at settle time.
const TEST_REF_CLASSES: Record<QaTaskTestRef["status"], string> = {
  passed: "bg-success/10 text-success border-success/30",
  healed: "bg-success/10 text-success border-success/30",
  failed: "bg-destructive/10 text-destructive border-destructive/30",
  covered: "text-muted-foreground",
  generated: "bg-info/10 text-info border-info/30",
  generating: "bg-info/10 text-info border-info/30",
  generation_failed: "bg-destructive/10 text-destructive border-destructive/30",
};

function TestRefChips({ refs }: { refs: QaTaskTestRef[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {refs.map((ref) => (
        <Link key={ref.testId} href={`/tests/${ref.testId}`}>
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 gap-1 max-w-full hover:opacity-80 ${
              TEST_REF_CLASSES[ref.status] ?? "text-muted-foreground"
            }`}
            title={`${ref.name} — ${ref.status.replace("_", " ")}`}
          >
            <FlaskConical className="h-3 w-3 shrink-0" />
            <span className="truncate">{ref.name}</span>
          </Badge>
        </Link>
      ))}
    </div>
  );
}

function TaskCard({
  task,
  pending,
  onRetry,
  onDrop,
}: {
  task: QaTask;
  pending: boolean;
  onRetry: (id: string) => void;
  onDrop: (id: string) => void;
}) {
  const cancelled = task.status === "cancelled";
  return (
    <div
      className={`rounded-md border bg-card p-2.5 space-y-1.5 text-sm animate-in fade-in slide-in-from-bottom-2 duration-300 ${
        cancelled ? "opacity-60" : ""
      } ${task.status === "working" ? "border-info/40 shadow-sm" : ""}`}
    >
      <div className="flex items-start gap-2">
        <span className={`min-w-0 flex-1 ${cancelled ? "line-through" : ""}`}>
          {task.title}
        </span>
        {(task.status === "queued" ||
          task.status === "working" ||
          task.status === "needs_input") && (
          <button
            type="button"
            className="text-muted-foreground hover:text-destructive shrink-0"
            title={
              task.status === "working"
                ? "Cancel this task and its run"
                : "Cancel task"
            }
            disabled={pending}
            onClick={() => onDrop(task.id)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {task.description && (
        <p className="text-xs text-muted-foreground line-clamp-3">
          {task.description}
        </p>
      )}
      <div className="flex items-center gap-1.5 flex-wrap">
        <SourceChip task={task} />
        {task.status === "working" && (
          <span className="flex items-center gap-1 text-[11px] text-info">
            <Loader2 className="h-3 w-3 animate-spin" />
            agent working…
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">
          {timeAgo(
            task.status === "done" || task.status === "cancelled"
              ? (task.completedAt ?? task.createdAt)
              : task.createdAt,
          )}
        </span>
      </div>
      {task.agentReply && (
        <div className="flex items-start gap-1.5 rounded border bg-muted/40 p-1.5 text-xs animate-in fade-in duration-500">
          <Bot className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
          <span className="min-w-0">{task.agentReply}</span>
        </div>
      )}
      {task.tests && task.tests.length > 0 && (
        <TestRefChips refs={task.tests} />
      )}
      {task.status === "needs_input" && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={pending}
          onClick={() => onRetry(task.id)}
        >
          <RotateCcw className="h-3 w-3" />
          Retry
        </Button>
      )}
    </div>
  );
}

export function QaTaskBoard({
  tasks,
  pending,
  error,
  onAdd,
  onRetry,
  onDrop,
}: {
  tasks: QaTask[];
  pending: boolean;
  error: string | null;
  onAdd: (
    title: string,
    opts?: { source?: "user" | "coverage_gap" },
  ) => Promise<boolean>;
  onRetry: (id: string) => void;
  onDrop: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");

  const submit = async () => {
    const title = draft.trim();
    if (!title) return;
    if (await onAdd(title)) setDraft("");
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ListTodo className="h-4 w-4" />
          Direct the agent
          <span className="text-xs font-normal text-muted-foreground">
            — drop an idea; the agent picks it up, works it with the right
            protocol, and replies here
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder='e.g. "Cover the billing flow with an expired card" or "Add negative tests for signup"'
            value={draft}
            disabled={pending}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
          <Button
            disabled={pending || !draft.trim()}
            onClick={() => void submit()}
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Queue task
          </Button>
        </div>
        {error && (
          <div className="flex items-start gap-1.5 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {COLUMNS.map((col) => {
            const Icon = col.icon;
            const items = tasks.filter((t) => col.statuses.includes(t.status));
            return (
              <div
                key={col.id}
                className="rounded-md border bg-muted/20 p-2 space-y-2 min-h-28"
              >
                <div className="flex items-center gap-1.5 px-0.5 text-xs font-medium text-muted-foreground">
                  <Icon
                    className={`h-3.5 w-3.5 ${
                      col.id === "working" && items.length > 0
                        ? "animate-spin text-info"
                        : ""
                    }`}
                  />
                  {col.label}
                  <span className="ml-auto tabular-nums">{items.length}</span>
                </div>
                {items.length === 0 ? (
                  <div className="flex items-center justify-center py-4 text-[11px] text-muted-foreground/60">
                    {col.id === "queued" ? "Nothing queued" : "—"}
                  </div>
                ) : (
                  items.map((task) => (
                    // Keyed by id+status so a column move remounts the card
                    // and replays the entry animation.
                    <TaskCard
                      key={`${task.id}-${task.status}`}
                      task={task}
                      pending={pending}
                      onRetry={onRetry}
                      onDrop={onDrop}
                    />
                  ))
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
