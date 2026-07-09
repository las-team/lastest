"use client";

import { useMemo, useState } from "react";
import type {
  QaPlanItem,
  QaPlanJourney,
  QaTestGroup,
  QaTestPlan,
} from "@/lib/db/schema";
import { itemGroups, QA_GROUPS } from "@/lib/qa-agent/plan";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Textarea } from "@/components/ui/textarea";
import {
  Check,
  CheckCircle2,
  ClipboardList,
  GitBranch,
  Loader2,
  MessageSquareWarning,
  Route,
  Sparkles,
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

const groupLabel = (id: QaTestGroup) =>
  QA_GROUPS.find((g) => g.id === id)?.label ?? id;

/** Full plan-item details shown on hover over a matrix row's title. */
function ItemDetailCard({
  item,
  groups,
  journey,
}: {
  item: QaPlanItem;
  groups: QaTestGroup[];
  journey?: QaPlanJourney;
}) {
  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <PriorityBadge priority={item.priority} />
        <span className="text-sm font-medium">{item.title}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {groups.map((g) => (
          <Badge key={g} variant="secondary" className="text-[10px] px-1.5">
            {groupLabel(g)}
          </Badge>
        ))}
        {item.pagePath && (
          <code className="text-[10px] text-muted-foreground">
            {item.pagePath}
          </code>
        )}
      </div>
      <div>
        <div className="font-medium text-muted-foreground">Scenario</div>
        <div className="whitespace-pre-line">{item.scenario}</div>
      </div>
      {item.rationale && (
        <div>
          <div className="font-medium text-muted-foreground">Rationale</div>
          <div>{item.rationale}</div>
        </div>
      )}
      {item.api && (
        <div>
          <div className="font-medium text-muted-foreground">API</div>
          <code className="text-[11px]">
            {item.api.method} {item.api.path}
            {item.api.expectedStatus ? ` → ${item.api.expectedStatus}` : ""}
          </code>
        </div>
      )}
      {journey && (
        <div>
          <div className="font-medium text-muted-foreground">
            Journey: {journey.title}
          </div>
          <div>
            {journey.businessOutcome}
            <span className="text-muted-foreground">
              {" "}
              · verified by: {journey.endStateVerification}
            </span>
          </div>
        </div>
      )}
      {item.selectorHints && item.selectorHints.length > 0 && (
        <div>
          <div className="font-medium text-muted-foreground">
            Verified selectors
          </div>
          <div className="space-y-0.5">
            {item.selectorHints.map((s) => (
              <code key={s} className="block text-[11px] break-all">
                {s}
              </code>
            ))}
          </div>
        </div>
      )}
      {item.changeRefs && item.changeRefs.length > 0 && (
        <div>
          <div className="font-medium text-muted-foreground">
            Covers branch changes
          </div>
          <div className="space-y-0.5">
            {item.changeRefs.map((r) => (
              <code key={r} className="block text-[11px] break-all">
                {r}
              </code>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function QaPlanReview({
  plan,
  readOnly,
  loading,
  onApprove,
  onRequestChanges,
  onAddJourneys,
}: {
  plan: QaTestPlan;
  /** True when the plan is shown outside the review gate (no actions). */
  readOnly?: boolean;
  loading?: boolean;
  onApprove?: (disabledItemIds: string[]) => void;
  onRequestChanges?: (feedback: string) => void;
  /** Refine the reviewer's own plain-language journeys and merge them in.
   *  Resolves true when the merge succeeded (drives the panel reset). */
  onAddJourneys?: (journeysText: string) => Promise<boolean>;
}) {
  const [disabled, setDisabled] = useState<Set<string>>(
    () =>
      new Set(plan.items.filter((i) => i.enabled === false).map((i) => i.id)),
  );
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [journeysText, setJourneysText] = useState("");
  const [showJourneys, setShowJourneys] = useState(false);

  // Refine + merge the reviewer's journeys, then collapse/clear the panel only
  // when the merge succeeded (on failure the text is kept so they can retry).
  const submitJourneys = async () => {
    const ok = await onAddJourneys?.(journeysText.trim());
    if (ok) {
      setShowJourneys(false);
      setJourneysText("");
    }
  };

  const items = plan.items;
  // Matrix axes: only groups that at least one item is tagged with become
  // columns; rows are items sorted by business area then priority.
  const presentGroups = useMemo(
    () =>
      QA_GROUPS.filter((g) => items.some((i) => itemGroups(i).includes(g.id))),
    [items],
  );
  const sortedItems = useMemo(
    () =>
      [...items].sort((a, b) => {
        const areaA = a.businessArea?.trim() || "General";
        const areaB = b.businessArea?.trim() || "General";
        if (areaA !== areaB) return areaA.localeCompare(areaB);
        return a.priority.localeCompare(b.priority);
      }),
    [items],
  );

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

        <div className="space-y-1">
          <h4 className="text-sm font-medium">
            Coverage matrix{" "}
            <span className="text-xs font-normal text-muted-foreground">
              — one test can cover several groups in a single execution
            </span>
          </h4>
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  {!readOnly && <th className="w-8 px-2 py-1.5" />}
                  <th className="w-full text-left px-3 py-1.5 font-medium">
                    Test
                  </th>
                  {presentGroups.map((g) => (
                    <th
                      key={g.id}
                      className="w-12 text-center px-1.5 py-1.5 font-medium text-xs whitespace-nowrap"
                      title={`${g.label} — ${g.description}`}
                    >
                      {g.short}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {sortedItems.map((item) => {
                  const isDisabled = disabled.has(item.id);
                  const groups = itemGroups(item);
                  return (
                    <tr
                      key={item.id}
                      className={`${readOnly ? "" : "cursor-pointer hover:bg-muted/50"} ${
                        isDisabled ? "opacity-50" : ""
                      }`}
                      onClick={readOnly ? undefined : () => toggle(item.id)}
                    >
                      {!readOnly && (
                        <td className="px-2 py-2 align-top">
                          <Checkbox
                            checked={!isDisabled}
                            onCheckedChange={() => toggle(item.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-0.5"
                          />
                        </td>
                      )}
                      <td className="w-full min-w-72 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <PriorityBadge priority={item.priority} />
                          <HoverCard openDelay={150} closeDelay={100}>
                            <HoverCardTrigger asChild>
                              <span className="font-medium cursor-help underline-offset-4 decoration-dotted decoration-muted-foreground/60 hover:underline">
                                {item.title}
                              </span>
                            </HoverCardTrigger>
                            <HoverCardContent
                              align="start"
                              className="w-96 max-h-96 overflow-y-auto"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ItemDetailCard
                                item={item}
                                groups={groups}
                                journey={
                                  item.journeyId
                                    ? plan.journeys.find(
                                        (j) => j.id === item.journeyId,
                                      )
                                    : undefined
                                }
                              />
                            </HoverCardContent>
                          </HoverCard>
                          {item.businessArea && (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 text-muted-foreground shrink-0"
                            >
                              {item.businessArea}
                            </Badge>
                          )}
                          {item.changeRefs && item.changeRefs.length > 0 && (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 shrink-0 gap-1 bg-info/10 text-info border-info/30"
                              title={`Covers branch changes: ${item.changeRefs.join(", ")}`}
                            >
                              <GitBranch className="h-3 w-3" />
                              PR change
                            </Badge>
                          )}
                          {item.pagePath && (
                            <code className="text-[10px] text-muted-foreground">
                              {item.pagePath}
                            </code>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-line">
                          {item.scenario}
                        </div>
                      </td>
                      {presentGroups.map((g) => {
                        const covers = groups.includes(g.id);
                        const primary = item.group === g.id;
                        return (
                          <td
                            key={g.id}
                            className="text-center px-1.5 py-2 align-middle"
                            title={
                              covers
                                ? `${g.label}${primary ? " (primary)" : ""}`
                                : undefined
                            }
                          >
                            {covers ? (
                              <Check
                                className={`h-4 w-4 inline ${
                                  primary ? "text-success" : "text-success/50"
                                }`}
                              />
                            ) : (
                              <span className="text-muted-foreground/40">
                                —
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
            ) : showJourneys ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Describe the user journeys you care about, one per line. The
                  AI refines each into a grounded test and adds it to the plan
                  above — your existing tests and choices are kept.
                </p>
                <Textarea
                  placeholder={
                    "One journey per line, e.g.\nA user records a flow and sees the diff approved\nAn admin invites a teammate who then signs in\nA user creates a test suite and runs it"
                  }
                  value={journeysText}
                  onChange={(e) => setJourneysText(e.target.value)}
                  rows={4}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={loading || !journeysText.trim()}
                    onClick={submitJourneys}
                  >
                    {loading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    Refine &amp; add
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowJourneys(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
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
                {onAddJourneys && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={loading}
                    onClick={() => setShowJourneys(true)}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Add journeys
                  </Button>
                )}
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
