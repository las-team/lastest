'use client';

import { useState, useCallback } from 'react';
import { Check, X, ChevronRight, ChevronDown, RotateCcw, Loader2, Eye, ScrollText, Telescope } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import type { AgentStepState, AgentSubstep, AgentRichResultPlanArea } from '@/lib/db/schema';

interface PlayAgentStepDetailProps {
  step: AgentStepState;
  sessionId?: string;
  onApprovePlan?: (approvedAreaIds: string[], autoApprove: boolean) => void;
  onRerunPlanner?: (source: string) => void;
}

function PlanDetail({ areas, onApprovePlan, onRerunPlanner }: {
  areas: AgentRichResultPlanArea[];
  onApprovePlan?: (approvedAreaIds: string[], autoApprove: boolean) => void;
  onRerunPlanner?: (source: string) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(areas.map(a => a.id)));
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [divingArea, setDivingArea] = useState<string | null>(null);

  const toggleArea = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDiscoverMore = async (area: AgentRichResultPlanArea) => {
    if (!onRerunPlanner) return;
    setDivingArea(area.id);
    try {
      await onRerunPlanner(`browser-dive-${area.name}`);
    } finally {
      setDivingArea(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground mb-1">
        {areas.length} functional areas discovered
      </div>
      <div className="max-h-64 overflow-y-auto space-y-1.5">
        {areas.map(area => (
          <div key={area.id} className="border rounded-md p-2">
            <div className="flex items-center gap-2">
              {onApprovePlan && (
                <input
                  type="checkbox"
                  checked={selectedIds.has(area.id)}
                  onChange={() => toggleArea(area.id)}
                  className="h-3.5 w-3.5 rounded border-muted-foreground/30"
                />
              )}
              <button
                onClick={() => setExpandedId(prev => prev === area.id ? null : area.id)}
                className="flex items-center gap-1 flex-1 text-left"
              >
                {expandedId === area.id ? (
                  <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                )}
                <span className="text-xs font-medium">{area.name}</span>
              </button>
              {area.routes.length > 0 && (
                <span className="text-[10px] text-muted-foreground">{area.routes.length} routes</span>
              )}
              {onRerunPlanner && (
                <button
                  onClick={() => handleDiscoverMore(area)}
                  disabled={divingArea === area.id}
                  className="text-[10px] text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 flex items-center gap-0.5 shrink-0 disabled:opacity-50"
                  title="Launch diver agent to explore this area further"
                >
                  {divingArea === area.id ? (
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  ) : (
                    <Telescope className="h-2.5 w-2.5" />
                  )}
                  Discover
                </button>
              )}
            </div>
            {expandedId === area.id && (
              <div className="mt-2 ml-5 space-y-1.5">
                {area.description && (
                  <p className="text-[11px] text-muted-foreground">{area.description}</p>
                )}
                {area.routes.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {area.routes.map((route, i) => (
                      <span key={i} className="inline-flex px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">
                        {route}
                      </span>
                    ))}
                  </div>
                )}
                {area.testPlan && (
                  <pre className="text-[10px] bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-32 overflow-y-auto">
                    {area.testPlan}
                  </pre>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Link
          href="/areas?tab=plan"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border rounded-md px-3 py-1.5 hover:bg-muted/50 transition-colors"
        >
          <ScrollText className="h-3 w-3" />
          Review Testing Plan
        </Link>
        {onApprovePlan && (
          <Button
            size="sm"
            onClick={() => onApprovePlan(Array.from(selectedIds), false)}
            disabled={selectedIds.size === 0}
          >
            Approve & Generate ({selectedIds.size})
          </Button>
        )}
      </div>
    </div>
  );
}

function GenerateDetail({ tests }: { tests: Array<{ testId: string; name: string; areaName: string; code: string }> }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-1.5 max-h-64 overflow-y-auto">
      <div className="text-xs font-medium text-muted-foreground mb-1">
        {tests.length} tests generated
      </div>
      {tests.map(test => (
        <div key={test.testId} className="border rounded-md p-2">
          <button
            onClick={() => setExpandedId(prev => prev === test.testId ? null : test.testId)}
            className="flex items-center gap-1 w-full text-left"
          >
            {expandedId === test.testId ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
            )}
            <span className="text-xs font-medium flex-1">{test.name}</span>
            <span className="text-[10px] text-muted-foreground">{test.areaName}</span>
          </button>
          {expandedId === test.testId && (
            <pre className="mt-2 text-[10px] bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
              {test.code}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

function EnvSetupDetail({ loginScript, pageContext }: { loginScript?: string; pageContext?: string }) {
  const [showContext, setShowContext] = useState(false);

  return (
    <div className="space-y-2 max-h-64 overflow-y-auto">
      {loginScript && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Login Script</div>
          <pre className="text-[10px] bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
            {loginScript}
          </pre>
        </div>
      )}
      {pageContext && (
        <div>
          <button
            onClick={() => setShowContext(!showContext)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            {showContext ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Page Context
          </button>
          {showContext && (
            <pre className="mt-1 text-[10px] bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-32 overflow-y-auto">
              {pageContext}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function FixTestsDetail({ fixes }: { fixes: Array<{ testName: string; originalError: string; fixed: boolean; newCode?: string }> }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  return (
    <div className="space-y-1.5 max-h-64 overflow-y-auto">
      <div className="text-xs font-medium text-muted-foreground mb-1">
        {fixes.filter(f => f.fixed).length} fixed, {fixes.filter(f => !f.fixed).length} unfixed
      </div>
      {fixes.map((fix, i) => (
        <div key={i} className="border rounded-md p-2">
          <button
            onClick={() => setExpandedIdx(prev => prev === i ? null : i)}
            className="flex items-center gap-1.5 w-full text-left"
          >
            {fix.fixed ? (
              <Check className="h-3 w-3 text-green-500 shrink-0" />
            ) : (
              <X className="h-3 w-3 text-red-500 shrink-0" />
            )}
            <span className={cn('text-xs flex-1', fix.fixed ? 'text-foreground' : 'text-muted-foreground')}>
              {fix.testName}
            </span>
          </button>
          {expandedIdx === i && (
            <div className="mt-2 ml-5 space-y-1.5">
              <div className="text-[10px] text-red-500">{fix.originalError}</div>
              {fix.newCode && (
                <pre className="text-[10px] bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-32 overflow-y-auto">
                  {fix.newCode}
                </pre>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ScanAndTemplateDetail({ routes, framework, template, intelligence }: {
  routes: Array<{ path: string; type: string }>;
  framework?: string;
  template?: string;
  intelligence?: Record<string, unknown>;
}) {
  const [showIntel, setShowIntel] = useState(false);
  const staticRoutes = routes.filter(r => r.type === 'static');
  const dynamicRoutes = routes.filter(r => r.type === 'dynamic');

  return (
    <div className="space-y-2 max-h-64 overflow-y-auto">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {framework && <span>Framework: <span className="font-medium text-foreground">{framework}</span></span>}
        {template && <span>Template: <span className="font-medium text-foreground">{template}</span></span>}
      </div>

      <div className="text-xs font-medium text-muted-foreground">
        {routes.length} routes ({staticRoutes.length} static, {dynamicRoutes.length} dynamic)
      </div>
      <div className="flex flex-wrap gap-1">
        {routes.map((route, i) => (
          <span
            key={i}
            className={cn(
              'inline-flex px-1.5 py-0.5 rounded text-[10px] font-mono',
              route.type === 'dynamic' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' : 'bg-muted text-muted-foreground',
            )}
          >
            {route.path}
          </span>
        ))}
      </div>

      {intelligence && (
        <div>
          <button
            onClick={() => setShowIntel(!showIntel)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            {showIntel ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Codebase Intelligence
          </button>
          {showIntel && (
            <pre className="mt-1 text-[10px] bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-32 overflow-y-auto">
              {JSON.stringify(intelligence, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function PlannerLogViewer({ sessionId, logId }: { sessionId: string; logId: string }) {
  const [log, setLog] = useState<{ systemPrompt?: string; userPrompt: string; response?: string; errorMessage?: string; durationMs?: number; status: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchLog = useCallback(async () => {
    if (log) { setExpanded(!expanded); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/play-agent/${sessionId}/planner-log/${logId}`);
      if (res.ok) setLog(await res.json());
    } finally {
      setLoading(false);
      setExpanded(true);
    }
  }, [sessionId, logId, log, expanded]);

  return (
    <div>
      <button onClick={fetchLog} className="text-[10px] text-blue-500 hover:text-blue-400 flex items-center gap-1">
        {loading ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Eye className="h-2.5 w-2.5" />}
        {expanded ? 'Hide' : 'View'} AI Log
      </button>
      {expanded && log && (
        <div className="mt-1 space-y-1.5">
          <div>
            <div className="text-[9px] uppercase text-muted-foreground/50 font-medium">Prompt ({log.userPrompt.length} chars)</div>
            <pre className="text-[10px] bg-muted/50 rounded p-1.5 overflow-x-auto whitespace-pre-wrap max-h-24 overflow-y-auto">
              {log.userPrompt}
            </pre>
          </div>
          {log.response && (
            <div>
              <div className="text-[9px] uppercase text-muted-foreground/50 font-medium">Response ({log.response.length} chars)</div>
              <pre className="text-[10px] bg-muted/50 rounded p-1.5 overflow-x-auto whitespace-pre-wrap max-h-24 overflow-y-auto">
                {log.response}
              </pre>
            </div>
          )}
          {log.errorMessage && (
            <div>
              <div className="text-[9px] uppercase text-red-400/70 font-medium">Error</div>
              <pre className="text-[10px] bg-red-500/5 text-red-500 rounded p-1.5 overflow-x-auto whitespace-pre-wrap max-h-16 overflow-y-auto">
                {log.errorMessage}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PlannerObservabilityDetail({ substeps, sessionId, onRerunPlanner }: {
  substeps: AgentSubstep[];
  sessionId?: string;
  onRerunPlanner?: (source: string) => void;
}) {
  const plannerSubsteps = substeps.filter(s => s.source);
  const [rerunningSource, setRerunningSource] = useState<string | null>(null);

  if (plannerSubsteps.length === 0) return null;

  const handleRerun = async (source: string) => {
    if (!onRerunPlanner) return;
    setRerunningSource(source);
    try {
      await onRerunPlanner(source);
    } finally {
      setRerunningSource(null);
    }
  };

  return (
    <div className="space-y-1.5 mb-3">
      <div className="text-xs font-medium text-muted-foreground">Planner Details</div>
      {plannerSubsteps.map((sub, i) => (
        <div key={i} className="border rounded-md p-2 space-y-1">
          <div className="flex items-center gap-2">
            {sub.status === 'done' ? (
              <Check className="h-3 w-3 text-green-500 shrink-0" />
            ) : sub.status === 'error' ? (
              <X className="h-3 w-3 text-red-500 shrink-0" />
            ) : sub.status === 'running' ? (
              <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
            ) : null}
            <span className="text-xs font-medium flex-1">{sub.label}</span>
            {sub.durationMs != null && (
              <span className="text-[10px] text-muted-foreground tabular-nums">{(sub.durationMs / 1000).toFixed(1)}s</span>
            )}
            {sub.areasFound != null && (
              <span className="text-[10px] text-muted-foreground">{sub.areasFound} areas</span>
            )}
          </div>

          {sub.inputSummary && (
            <div className="text-[10px] text-muted-foreground/60 ml-5">Input: {sub.inputSummary}</div>
          )}

          {sub.outputSummary && sub.status === 'done' && (
            <div className="text-[10px] text-muted-foreground/60 ml-5 truncate">Areas: {sub.outputSummary}</div>
          )}

          {sub.rawError && sub.status === 'error' && (
            <div className="text-[10px] text-red-500/80 ml-5 break-words">{sub.rawError}</div>
          )}

          <div className="flex items-center gap-2 ml-5">
            {sub.promptLogId && sessionId && (
              <PlannerLogViewer sessionId={sessionId} logId={sub.promptLogId} />
            )}
            {sub.source && onRerunPlanner && (sub.status === 'done' || sub.status === 'error') && (
              <button
                onClick={() => handleRerun(sub.source!)}
                disabled={rerunningSource === sub.source}
                className={cn(
                  'text-[10px] flex items-center gap-1 disabled:opacity-50',
                  sub.status === 'error'
                    ? 'text-amber-500 hover:text-amber-400'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {rerunningSource === sub.source ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-2.5 w-2.5" />
                )}
                Re-run
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function PlayAgentStepDetail({ step, sessionId, onApprovePlan, onRerunPlanner }: PlayAgentStepDetailProps) {
  const rich = step.richResult;

  // For plan step: show planner observability + plan areas
  if (step.id === 'plan' && step.substeps?.some(s => s.source)) {
    return (
      <div className="space-y-2">
        <PlannerObservabilityDetail
          substeps={step.substeps || []}
          sessionId={sessionId}
          onRerunPlanner={onRerunPlanner}
        />
        {rich?.type === 'plan' && (
          <PlanDetail areas={rich.areas} onApprovePlan={onApprovePlan} onRerunPlanner={onRerunPlanner} />
        )}
      </div>
    );
  }

  if (!rich) {
    return (
      <div className="text-xs text-muted-foreground">
        {step.result ? (
          <pre className="bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-32 overflow-y-auto text-[10px]">
            {JSON.stringify(step.result, null, 2)}
          </pre>
        ) : (
          <span>No detailed output available</span>
        )}
      </div>
    );
  }

  switch (rich.type) {
    case 'scan_and_template':
      return <ScanAndTemplateDetail routes={rich.routes} framework={rich.framework} template={rich.template} intelligence={rich.intelligence} />;
    case 'plan':
      return <PlanDetail areas={rich.areas} onApprovePlan={onApprovePlan} onRerunPlanner={onRerunPlanner} />;
    case 'generate':
      return <GenerateDetail tests={rich.tests} />;
    case 'env_setup':
      return <EnvSetupDetail loginScript={rich.loginScript} pageContext={rich.pageContext} />;
    case 'fix_tests':
      return <FixTestsDetail fixes={rich.fixes} />;
    case 'generic':
      return (
        <pre className="text-[10px] bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
          {rich.content}
        </pre>
      );
    default:
      return null;
  }
}
