/**
 * Runner wire-protocol types, re-exported.
 *
 * Nothing is *defined* here. `@lastest/eb-protocol` is the single source of
 * truth for the shapes the runners produce; the schema stores them verbatim in
 * jsonb columns, and app code has always imported them from `@/lib/db/schema`
 * alongside the row types they live in. This module preserves that.
 */

// Type definitions for JSON columns

// Wire-format shapes produced by the runners (embedded browser / remote
// runner) and persisted verbatim into jsonb columns. Defined in
// @lastest/eb-protocol — the single source of truth for the runner wire
// protocol — and re-exported here so app code keeps importing them alongside
// the row types they are stored in.
import type {
  DomSnapshotElement,
  DomSnapshotData,
  A11yViolationSampleNode,
  A11yViolation,
  DesignTokenCategory,
  DesignToken,
  DesignSystemViolation,
  DesignSystemTokenUsage,
  AssertionResult,
  StorageStateSnapshot,
  UrlTrajectoryStep,
  WebVitalsSample,
  StepTiming,
  ConsoleEntry,
} from "@lastest/eb-protocol";
export type {
  DomSnapshotElement,
  DomSnapshotData,
  A11yViolationSampleNode,
  A11yViolation,
  DesignTokenCategory,
  DesignToken,
  DesignSystemViolation,
  DesignSystemTokenUsage,
  AssertionResult,
  StorageStateSnapshot,
  UrlTrajectoryStep,
  WebVitalsSample,
  StepTiming,
  ConsoleEntry,
};
