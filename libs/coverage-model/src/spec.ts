/**
 * The test specification, derived from the coverage model.
 *
 * This is the artifact the whole data-driven model exists to produce: a
 * document that states, per object type and per dimension, what will be
 * tested, what will not, and why — with every number traceable to observed
 * data rather than to someone's judgement.
 *
 * It is deliberately the same structure a PQ test protocol needs (scope,
 * coverage matrix, acceptance criteria, documented exclusions), so the QA
 * agent's working spec and the validation evidence pack are one artifact
 * rather than two that can disagree.
 */

import type {
  CellLike as CoverageCell,
  DimensionLike as CoverageDimension,
} from "./types";
import {
  DEFAULT_COVERAGE_STOP_POLICY,
  type CoverageStopPolicy,
} from "./policy";
import type { CoverageReport } from "./rollup";
import { isCovered } from "./rollup";
import type { StopDecision } from "./stop";

export interface SpecCell {
  /** Row id — the spec is also the UI's working surface, and exclusion acts
   *  on the cell itself, not on its coordinates. */
  id: string;
  /** Cell identity is (objectType, coordsKey); the key alone is not unique. */
  objectType: string;
  coordsKey: string;
  coords: Record<string, string>;
  observedCount: number;
  weight: number;
  status: CoverageCell["status"];
  excludedReason?: string;
  runCount: number;
  passCount: number;
  failCount: number;
  lastVerdict?: string;
}

export interface SpecDimension {
  field: string;
  label: string;
  valueSource: CoverageDimension["valueSource"];
  /** True when counts are real production volume rather than sheet rows or
   *  run frequencies. The distinction decides how much the weights mean. */
  volumeIsReal: boolean;
  cardinality: number;
  values: Array<{
    value: string;
    recordCount: number;
    share: number;
    covered: boolean;
  }>;
}

export interface SpecSection {
  objectType: string;
  dimensions: SpecDimension[];
  /** Every occurring combination, ranked — this IS the coverage matrix. */
  cells: SpecCell[];
  totals: {
    cells: number;
    covered: number;
    failing: number;
    excluded: number;
    cellCoverage: number;
    tupleCoverage: number;
    weightedVolumeCoverage: number;
    cartesianCombinations: number;
    skippedAsNonOccurring: number;
    totalRecords: number;
  };
  /** How many source rows the numbers above rest on. Absent when the object
   *  type has no local tabular source (a SUT profile, or run history). */
  sample?: {
    profiledRows: number;
    totalRows: number;
    truncated: boolean;
  };
}

export interface CoverageSpec {
  repositoryId: string;
  environmentKey: string;
  /** Caller stamps this — the spec builder is deterministic and clock-free so
   *  the same inputs always produce the same document. */
  generatedAt?: string;
  scope: {
    objectTypes: number;
    dimensions: number;
    cells: number;
    /** Combinations a full-factorial suite would attempt but that do not
     *  occur in the data — the work correctly not being done. */
    skippedAsNonOccurring: number;
  };
  acceptance: {
    strength: number;
    pairwiseTarget: number;
    weightedVolumeTarget: number;
    marginalWeightEpsilon: number;
    met: boolean;
    explanation: string;
  };
  sections: SpecSection[];
  /** Documented exclusions, with the reason each was excluded. */
  exclusions: Array<{
    objectType: string;
    coords: Record<string, string>;
    reason: string;
  }>;
  /** Ranked work remaining — what the QA agent would plan next. */
  outstanding: SpecCell[];
  /** Honest warnings about the basis of the numbers. */
  caveats: string[];
}

function toSpecCell(c: CoverageCell): SpecCell {
  return {
    id: c.id,
    objectType: c.objectType,
    coordsKey: c.coordsKey,
    coords: c.coords,
    observedCount: c.observedCount,
    weight: c.weight,
    status: c.status,
    excludedReason: c.excludedReason ?? undefined,
    runCount: c.runCount,
    passCount: c.passCount,
    failCount: c.failCount,
    lastVerdict: c.lastVerdict ?? undefined,
  };
}

export function buildCoverageSpec(opts: {
  repositoryId: string;
  environmentKey: string;
  report: CoverageReport;
  stop: StopDecision;
  cells: CoverageCell[];
  dimensions: CoverageDimension[];
  policy?: CoverageStopPolicy;
  /** Per-source sample sizes from the last profile, keyed by object type. A
   *  spec that cannot say how many rows it read cannot be audited. */
  sources?: Array<{
    objectType: string;
    profiledRows: number;
    totalRows: number;
    truncated: boolean;
  }>;
}): CoverageSpec {
  const policy = { ...DEFAULT_COVERAGE_STOP_POLICY, ...(opts.policy ?? {}) };
  const enabledDims = opts.dimensions.filter((d) => d.enabled);
  const caveats: string[] = [];

  const sections: SpecSection[] = opts.report.byObjectType.map((ot) => {
    const cells = opts.cells.filter((c) => c.objectType === ot.objectType);
    const dims = enabledDims.filter((d) => d.objectType === ot.objectType);

    const dimensions: SpecDimension[] = dims.map((d) => {
      const touched = new Set(
        cells
          .filter(isCovered)
          .map((c) => c.coords[d.field])
          .filter((v): v is string => !!v),
      );
      return {
        field: d.field,
        label: d.label ?? d.field,
        valueSource: d.valueSource,
        volumeIsReal: d.valueSource === "profiled",
        cardinality: d.cardinality,
        values: d.values.map((v) => ({
          value: v.value,
          recordCount: v.recordCount,
          share: v.share,
          covered: touched.has(v.value),
        })),
      };
    });

    const sample = opts.sources?.find((s) => s.objectType === ot.objectType);
    if (sample?.truncated) {
      caveats.push(
        `"${ot.objectType}": profiled from ${sample.profiledRows.toLocaleString()} of ${sample.totalRows.toLocaleString()} rows. Every record count and weight below is a sample, and combinations that only occur past that point are missing entirely.`,
      );
    }

    if (dims.length > 0 && dims.every((d) => d.valueSource !== "profiled")) {
      caveats.push(
        `"${ot.objectType}": counts come from local data sources or run history, not the system under test. Weights reflect spreadsheet rows or how often a test ran — not production volume. Profile the source system to make the ranking meaningful.`,
      );
    }

    return {
      objectType: ot.objectType,
      dimensions,
      cells: [...cells]
        .sort(
          (a, b) =>
            b.weight - a.weight || a.coordsKey.localeCompare(b.coordsKey),
        )
        .map(toSpecCell),
      totals: {
        cells: ot.totalCells,
        covered: ot.coveredCells,
        failing: ot.failingCells,
        excluded: ot.excludedCells,
        cellCoverage: ot.cellCoverage,
        tupleCoverage: ot.tupleCoverage,
        weightedVolumeCoverage: ot.weightedVolumeCoverage,
        cartesianCombinations: ot.cartesianCombinations,
        skippedAsNonOccurring: ot.skippedAsNonOccurring,
        totalRecords: cells.reduce((s, c) => s + c.observedCount, 0),
      },
      ...(sample ? { sample } : {}),
    };
  });

  if (opts.cells.length === 0) {
    caveats.push(
      "No cells exist yet. Enable at least one dimension so the occurring combinations can be derived.",
    );
  }
  if (opts.cells.length > 0 && opts.cells.every((c) => c.runCount === 0)) {
    caveats.push(
      "No run has been attributed to any cell yet, so coverage reads 0% across the board. Coverage looks worse before it looks better — this is the true starting point, not a regression.",
    );
  }

  return {
    repositoryId: opts.repositoryId,
    environmentKey: opts.environmentKey,
    scope: {
      objectTypes: opts.report.totals.objectTypes,
      dimensions: opts.report.totals.dimensions,
      cells: opts.report.totals.cells,
      skippedAsNonOccurring: sections.reduce(
        (s, x) => s + x.totals.skippedAsNonOccurring,
        0,
      ),
    },
    acceptance: {
      strength: policy.strength,
      pairwiseTarget: policy.pairwiseTarget,
      weightedVolumeTarget: policy.weightedVolumeTarget,
      marginalWeightEpsilon: policy.marginalWeightEpsilon,
      met:
        opts.stop.metrics.tupleCoverage >= policy.pairwiseTarget &&
        opts.stop.metrics.weightedVolumeCoverage >= policy.weightedVolumeTarget,
      explanation: opts.stop.explanation,
    },
    sections,
    exclusions: opts.cells
      .filter((c) => c.status === "excluded")
      .map((c) => ({
        objectType: c.objectType,
        coords: c.coords,
        reason: c.excludedReason ?? "(no reason recorded)",
      })),
    // Resolved on (objectType, coordsKey): a coordsKey is only unique WITHIN an
    // object type, so matching on it alone silently returns another table's
    // cell — wrong record counts and weights, and a list that is no longer
    // weight-ordered. Grouped by object type for the same reason the directive
    // is: weights are normalised within an object type, so a single ranked list
    // across types compares numbers that are not comparable.
    outstanding: (() => {
      const byId = new Map(
        opts.cells.map((c) => [`${c.objectType} ${c.coordsKey}`, c]),
      );
      const order = new Map(
        opts.report.byObjectType.map((o, i) => [o.objectType, i]),
      );
      return opts.stop.queue
        .map((q) => byId.get(`${q.objectType} ${q.coordsKey}`))
        .filter((c): c is CoverageCell => !!c)
        .sort(
          (a, b) =>
            (order.get(a.objectType) ?? 0) - (order.get(b.objectType) ?? 0) ||
            b.weight - a.weight ||
            a.coordsKey.localeCompare(b.coordsKey),
        )
        .map(toSpecCell);
    })(),
    caveats,
  };
}

/** Markdown rendering — the exportable form, and the basis of the evidence
 *  pack. Kept separate from the structured spec so the UI can render either. */
export function renderSpecMarkdown(spec: CoverageSpec): string {
  const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
  const out: string[] = [
    `# Test Specification — data-driven coverage`,
    ``,
    `Repository: \`${spec.repositoryId}\`  ·  Environment: \`${spec.environmentKey}\`${spec.generatedAt ? `  ·  Generated: ${spec.generatedAt}` : ""}`,
    ``,
    `## 1. Scope`,
    ``,
    `| | |`,
    `|---|---|`,
    `| Object types | ${spec.scope.objectTypes} |`,
    `| Dimensions | ${spec.scope.dimensions} |`,
    `| Occurring combinations (cells) | ${spec.scope.cells} |`,
    `| Cartesian combinations that do NOT occur | ${spec.scope.skippedAsNonOccurring} |`,
    ``,
    `Coverage is measured over the data space. A cell is a combination of dimension values that actually occurs in the data; combinations that never occur are not planned, not counted, and not held against coverage.`,
    ``,
    `## 2. Acceptance criteria`,
    ``,
    `- ${spec.acceptance.strength}-way (t=${spec.acceptance.strength}) combination coverage ≥ ${pct(spec.acceptance.pairwiseTarget)}`,
    `- Weighted record-volume coverage ≥ ${pct(spec.acceptance.weightedVolumeTarget)}`,
    `- Stop when the next-best uncovered cell scores below ${spec.acceptance.marginalWeightEpsilon}`,
    ``,
    `**Status: ${spec.acceptance.met ? "MET" : "NOT MET"}** — ${spec.acceptance.explanation}`,
    ``,
  ];

  spec.sections.forEach((s, i) => {
    out.push(`## 3.${i + 1} Object type: \`${s.objectType}\``, ``);
    out.push(
      `${s.totals.covered}/${s.totals.cells} cells covered (${pct(s.totals.cellCoverage)}), ` +
        `${pct(s.totals.tupleCoverage)} ${spec.acceptance.strength}-way, ` +
        `${pct(s.totals.weightedVolumeCoverage)} weighted volume. ` +
        `${s.totals.failing} failing, ${s.totals.excluded} excluded. ` +
        `${s.totals.cartesianCombinations} cartesian combinations, ${s.totals.skippedAsNonOccurring} of which do not occur.`,
      ``,
    );

    if (s.sample) {
      out.push(
        s.sample.truncated
          ? `> **Sampled**: profiled from ${s.sample.profiledRows.toLocaleString()} of ${s.sample.totalRows.toLocaleString()} source rows. Counts below are a sample, not the full distribution.`
          : `Profiled from all ${s.sample.totalRows.toLocaleString()} source rows.`,
        ``,
      );
    }

    if (s.dimensions.length > 0) {
      out.push(
        `### Dimensions`,
        ``,
        `| Field | Source | Values | Covered |`,
        `|---|---|---|---|`,
      );
      for (const d of s.dimensions) {
        const cov = d.values.filter((v) => v.covered).length;
        out.push(
          `| \`${d.field}\` | ${d.valueSource}${d.volumeIsReal ? " (real volume)" : ""} | ${d.cardinality} | ${cov}/${d.values.length} |`,
        );
      }
      out.push(``);
      for (const d of s.dimensions) {
        const untouched = d.values
          .filter((v) => !v.covered)
          .map((v) => v.value);
        if (untouched.length > 0) {
          out.push(`- \`${d.field}\` never exercised: ${untouched.join(", ")}`);
        }
      }
      out.push(``);
    }

    out.push(`### Coverage matrix`, ``);
    const fields = s.dimensions.map((d) => d.field);
    out.push(
      `| ${fields.map((f) => `\`${f}\``).join(" | ")} | Records | Weight | Status | Runs |`,
    );
    out.push(`|${fields.map(() => "---").join("|")}|---|---|---|---|`);
    for (const c of s.cells) {
      out.push(
        `| ${fields.map((f) => c.coords[f] ?? "").join(" | ")} | ${c.observedCount} | ${c.weight.toFixed(3)} | ${c.status} | ${c.runCount} |`,
      );
    }
    out.push(``);
  });

  if (spec.exclusions.length > 0) {
    out.push(
      `## 4. Documented exclusions`,
      ``,
      `| Object type | Combination | Reason |`,
      `|---|---|---|`,
    );
    for (const e of spec.exclusions) {
      const coords = Object.entries(e.coords)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      out.push(`| \`${e.objectType}\` | ${coords} | ${e.reason} |`);
    }
    out.push(``);
  }

  if (spec.outstanding.length > 0) {
    out.push(
      `## 5. Outstanding work (ranked within each object type)`,
      ``,
      `Weights are normalised per object type, so they rank work inside a group and are not comparable between groups.`,
      ``,
    );
    for (const s of spec.sections) {
      const rows = spec.outstanding.filter(
        (c) => c.objectType === s.objectType,
      );
      if (rows.length === 0) continue;
      out.push(`### \`${s.objectType}\``, ``);
      for (const c of rows.slice(0, 50)) {
        const coords = Object.entries(c.coords)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, v]) => v)
          .join(" / ");
        out.push(
          `- [${c.weight.toFixed(3)}] ${coords} — ${c.observedCount} record(s)`,
        );
      }
      if (rows.length > 50) {
        out.push(`- … and ${rows.length - 50} more.`);
      }
      out.push(``);
    }
  }

  if (spec.caveats.length > 0) {
    out.push(`## 6. Caveats`, ``);
    for (const c of spec.caveats) out.push(`- ${c}`);
    out.push(``);
  }

  return out.join("\n");
}
