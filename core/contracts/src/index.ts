/**
 * `@lastest/contracts` — the shared type surface between core and plugins.
 *
 * Types only, zero dependencies, no runtime code. This is the one package that
 * everything may import, so anything with a runtime cost here is a runtime cost
 * everywhere.
 *
 * See `docs/architecture/core-scope.md` for what belongs in core at all.
 */
export type { AiCallOptions, AiCapability, AiResult } from "./ai";

export type {
  BrowserCapability,
  BrowserClaimOptions,
  BrowserSession,
  DrivablePage,
  DrivablePageTypeMap,
  SwarmOptions,
  Viewport,
} from "./browser";

export type { DataCapability, DeletionHook, PluginDatabase } from "./data";

export type {
  EnqueueOptions,
  JobHandler,
  JobRef,
  JobRun,
  JobsCapability,
  JobType,
} from "./jobs";

export type {
  CapabilityMap,
  CapabilityName,
  EventsCapability,
  NavEntry,
  PluginContext,
  PluginManifest,
} from "./plugin";

export type { CheckLayer, Logger, Plan, RepoRef, TeamRef } from "./refs";

export type {
  BlobRef,
  PutOptions,
  QuotaStatus,
  SignedUrlOptions,
  StorageCapability,
} from "./storage";
