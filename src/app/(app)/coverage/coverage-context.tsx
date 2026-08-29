"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { PageCoverageMap } from "@/lib/coverage/page-attribution";

/**
 * The data the coverage rail needs, carried past the App Map plugin.
 *
 * The rail is rendered *by* `@lastest/plugin-app-map` (it is the plugin that
 * knows which node is selected and where the rail belongs on the canvas), but
 * the rail itself is core — the coverage model, its vocabulary and its actions
 * are not things a plugin may hold. So the plugin receives the rail as an
 * opaque component and never sees a single coverage type; the data reaches it
 * through this provider, which the app wraps around the plugin's page.
 *
 * That is the same split `exploreProgressPanel` uses for the QA-agent stream
 * viewer — plugin decides *where* and *when*, app decides *what*.
 */

export interface CoverageDimensionSummary {
  objectType: string;
  field: string;
  values: Array<{ value: string; covered: boolean; recordCount: number }>;
}

export interface CoverageGapSummary {
  cellId: string;
  coordsKey: string;
  objectType: string;
  coords: Record<string, string>;
  observedCount: number;
  weight: number;
}

export interface CoverageRailData {
  repositoryId: string;
  environmentKey: string;
  /** False when no dimension has been enabled yet — there is no model to show. */
  hasModel: boolean;
  strength: number;
  tupleCoverage: number;
  pairwiseTarget: number;
  weightedVolumeCoverage: number;
  weightedVolumeTarget: number;
  coveredCells: number;
  eligibleCells: number;
  excludedCells: number;
  skippedAsNonOccurring: number;
  totalRecords: number;
  dimensions: CoverageDimensionSummary[];
  /** The QA agent's queue, highest weight first. */
  outstanding: CoverageGapSummary[];
  /** Canonical path -> what ran through it. See `page-attribution.ts`. */
  pageCoverage: PageCoverageMap;
}

const CoverageDataContext = createContext<CoverageRailData | null>(null);

export function CoverageDataProvider({
  value,
  children,
}: {
  value: CoverageRailData;
  children: ReactNode;
}) {
  return (
    <CoverageDataContext.Provider value={value}>
      {children}
    </CoverageDataContext.Provider>
  );
}

/** Null outside the provider — the rail renders nothing rather than throwing,
 *  so a plugin mounting it in an unwrapped tree degrades instead of crashing. */
export function useCoverageData(): CoverageRailData | null {
  return useContext(CoverageDataContext);
}
