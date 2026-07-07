"use client";

import { useMemo, useState } from "react";
import type { QaTestGroup, QaTestPlan } from "@/lib/db/schema";
import { QA_GROUPS } from "@/lib/qa-agent/plan";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2,
  ClipboardList,
  Loader2,
  MessageSquareWarning,
  Route,
  Target,
} from "lucide-react";

const PRIORITY_STYLES: Record<string, string> = {
  P1: "bg-destructive/10 text-destructive border-destructive/30",
  P2: "bg-warning/10 text-warning border-warning/30",
  P3: "bg-muted text-muted-foreground border-border",
};

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <Badge
      variant="outline"
      className={`text-[10px] px-1.5 ${PRIORITY_STYLES[priority] ?? ""}`}
    >
      {priority}
    </Badge>
  );
}

export function QaPlanReview({
  plan,
  readOnly,
  loading,
  onApprove,
  onRequestChanges,
}: {
  plan: QaTestPlan;
  /** True when the plan is shown outside the review gate (no actions). */
  readOnly?: boolean;
  loading?: boolean;
  onApprove?: (disabledItemIds: string[]) => void;
  onRequestChanges?: (feedback: string) => void;
}) {
  const [disabled, setDisabled] = useState<Set<string>>(
    () =>
      new Set(plan.items.filter((i) => i.enabled === false).map((i) => i.id)),
  );
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);

  const items = plan.items;
  const itemsByGroup = useMemo(() => {
    const map = new Map<QaTestGroup, typeof items>();
    for (const item of items) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return map;
  }, [items]);

  const enabledCount = plan.items.length - disabled.size;

  const toggle = (id: string) => {
    setDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="h-4 w-4" />
          Test plan
          {!readOnly && (
            <span className="text-xs font-normal text-muted-foreground">
              — review, adjust, then approve
            </span>
          )}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {plan.appProfile.summary}
          {plan.appProfile.primaryOutcome && (
            <>
              {" "}
              <span className="text-foreground">
                Primary outcome: {plan.appProfile.primaryOutcome}
              </span>
            </>
          )}
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {plan.journeys.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-1.5">
              <Route className="h-3.5 w-3.5" />
              Critical user journeys
            </h4>
            <div className="space-y-2">
              {plan.journeys.map((journey) => (
                <div
                  key={journey.id}
                  className="rounded-md border p-3 text-sm space-y-1"
                >
                  <div className="flex items-center gap-2">
                    <PriorityBadge priority={journey.priority} />
                    <span className="font-medium">{journey.title}</span>
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {journey.steps.join(" → ")}
                  </div>
                  <div className="flex items-start gap-1.5 text-xs">
                    <Target className="h-3.5 w-3.5 mt-0.5 shrink-0 text-success" />
                    <span>
                      <span className="font-medium">Outcome:</span>{" "}
                      {journey.businessOutcome}
                      <span className="text-muted-foreground">
                        {" "}
                        · verified by: {journey.endStateVerification}
                      </span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3">
          {QA_GROUPS.filter((g) => itemsByGroup.has(g.id)).map((group) => (
            <div key={group.id} className="space-y-1.5">
              <h4 className="text-sm font-medium">
                {group.label}{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  ({itemsByGroup.get(group.id)!.length})
                </span>
              </h4>
              <div className="space-y-1">
                {itemsByGroup.get(group.id)!.map((item) => {
                  const isDisabled = disabled.has(item.id);
                  return (
                    <label
                      key={item.id}
                      className={`flex items-start gap-2.5 rounded-md border p-2.5 text-sm ${
                        readOnly ? "" : "cursor-pointer hover:bg-muted/50"
                      } ${isDisabled ? "opacity-50" : ""}`}
                    >
                      {!readOnly && (
                        <Checkbox
                          checked={!isDisabled}
                          onCheckedChange={() => toggle(item.id)}
                          className="mt-0.5"
                        />
                      )}
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <PriorityBadge priority={item.priority} />
                          <span className="font-medium truncate">
                            {item.title}
                          </span>
                          {item.pagePath && (
                            <code className="text-[10px] text-muted-foreground">
                              {item.pagePath}
                            </code>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-line">
                          {item.scenario}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {!readOnly && (
          <div className="space-y-3 border-t pt-4">
            {showFeedback ? (
              <div className="space-y-2">
                <Textarea
                  placeholder="What should the planner change? (e.g. cover the transfer form, drop the P3 items, add logout coverage)"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  rows={3}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={loading || !feedback.trim()}
                    onClick={() => onRequestChanges?.(feedback.trim())}
                  >
                    {loading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <MessageSquareWarning className="h-3.5 w-3.5" />
                    )}
                    Send to planner
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowFeedback(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={loading || enabledCount === 0}
                  onClick={() => onApprove?.([...disabled])}
                >
                  {loading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  Approve {enabledCount} test{enabledCount === 1 ? "" : "s"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loading}
                  onClick={() => setShowFeedback(true)}
                >
                  <MessageSquareWarning className="h-3.5 w-3.5" />
                  Request changes
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
