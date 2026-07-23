"use client";

import {
  Camera,
  ExternalLink,
  Film,
  Home,
  ImageOff,
  Lock,
  X,
} from "lucide-react";
import type { AppMapNode } from "@/lib/app-map/build-map";
import type { AppFlow } from "@/lib/app-map/flows";
import { flowsThroughNode } from "@/lib/app-map/flows";
import { COVERAGE_COLOR, COVERAGE_LABEL } from "./app-map-shared";

// ── Detail panel (in-container so it renders in fullscreen too) ───────────────
export function NodeDetailPanel({
  node,
  queued,
  requesting,
  qaAgentEnabled,
  isEntryRoot,
  flows,
  onRequestCoverage,
  onSetEntryRoot,
  onOpenFlow,
  onClose,
}: {
  node: AppMapNode;
  queued: boolean;
  requesting: boolean;
  qaAgentEnabled: boolean;
  /** Whether this node is the user-chosen hierarchy entry root. */
  isEntryRoot: boolean;
  /** Flows data once lazily loaded; null while not fetched yet. */
  flows: AppFlow[] | null;
  onRequestCoverage: (node: AppMapNode) => void;
  onSetEntryRoot: (nodeId: string | null) => void;
  onOpenFlow: (flowId: string, stepIndex: number) => void;
  onClose: () => void;
}) {
  const covered = node.coverageStatus === "covered";
  const nodeFlows = flows ? flowsThroughNode(flows, node.id) : [];
  return (
    <div className="absolute right-0 top-0 z-20 flex h-full w-80 flex-col border-l bg-card shadow-xl">
      <div className="flex items-start justify-between gap-2 border-b p-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">
            {node.title ?? node.path}
          </div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {node.path}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        {node.screenshot ? (
          <a
            href={`/api/media${node.screenshot.path}`}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden rounded-md border"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/media${node.screenshot.path}`}
              alt={node.path}
              className="w-full object-cover"
            />
          </a>
        ) : (
          <div className="flex h-32 flex-col items-center justify-center gap-1 rounded-md border bg-muted text-muted-foreground">
            <ImageOff className="h-6 w-6" />
            <span className="text-xs">No screenshot captured yet</span>
          </div>
        )}

        <Row label="Coverage">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white"
            style={{ backgroundColor: COVERAGE_COLOR[node.coverageStatus] }}
          >
            {COVERAGE_LABEL[node.coverageStatus]}
          </span>
        </Row>

        <Row label="URL">
          <a
            href={node.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 break-all text-primary hover:underline"
          >
            {node.url} <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        </Row>

        <Row label="Sources">
          <div className="flex flex-wrap gap-1">
            {node.sources.map((s) => (
              <span
                key={s}
                className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
              >
                {s}
              </span>
            ))}
            {node.isExtraPath && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] uppercase text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                extra path
              </span>
            )}
          </div>
        </Row>

        {node.area && <Row label="Area">{node.area}</Row>}

        {node.screenshot?.testName && (
          <Row label="Covered by">
            <span className="inline-flex items-center gap-1">
              <Camera className="h-3 w-3" /> {node.screenshot.testName}
            </span>
          </Row>
        )}

        <Row label="Hierarchy">
          <button
            type="button"
            onClick={() => onSetEntryRoot(isEntryRoot ? null : node.id)}
            className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted ${
              isEntryRoot ? "border-primary/40 text-primary" : ""
            }`}
          >
            <Home className="h-3 w-3" />
            {isEntryRoot ? "Clear entry root" : "Set as entry root"}
          </button>
        </Row>

        {flows && nodeFlows.length > 0 && (
          <Row
            label={`Appears in ${nodeFlows.length} flow${nodeFlows.length === 1 ? "" : "s"}`}
          >
            <div className="space-y-1">
              {nodeFlows.slice(0, 8).map((f) => {
                const stepIdx = f.steps.findIndex((s) => s.nodeId === node.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => onOpenFlow(f.id, Math.max(0, stepIdx))}
                    className="flex w-full items-center gap-1.5 rounded-md border px-2 py-1 text-left text-xs hover:bg-muted"
                  >
                    <Film className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      step {Math.max(0, stepIdx) + 1}/{f.steps.length}
                    </span>
                  </button>
                );
              })}
            </div>
          </Row>
        )}

        {node.apiEndpoints.length > 0 && (
          <Row label="API calls">
            <div className="space-y-0.5 font-mono text-[11px] text-muted-foreground">
              {node.apiEndpoints.slice(0, 12).map((ep, i) => (
                <div key={i} className="truncate">
                  <span className="text-foreground">{ep.method}</span> {ep.path}
                </div>
              ))}
            </div>
          </Row>
        )}
      </div>

      {!covered && (
        <div className="border-t p-3">
          {qaAgentEnabled ? (
            <button
              type="button"
              disabled={queued || requesting}
              onClick={() => onRequestCoverage(node)}
              className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {queued
                ? "Queued for QA agent"
                : requesting
                  ? "Queuing…"
                  : "Ask QA agent to cover this page"}
            </button>
          ) : (
            <a
              href="/settings"
              className="flex w-full items-center justify-center gap-1 rounded-md border bg-muted px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/70"
            >
              <Lock className="h-4 w-4" /> QA agent coverage is a Pro feature
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}
