/**
 * The plugin contract: what a plugin declares, and what it gets back.
 *
 * Nothing here is dynamic at runtime. Plugins are compile-time workspace
 * packages linked into one build (RFC §2); `definePlugin` is a typed identity
 * function and the kernel resolves manifests statically.
 */
import type { AiCapability } from "./ai";
import type { BrowserCapability } from "./browser";
import type { DataCapability, DeletionHook } from "./data";
import type { JobHandler, JobsCapability } from "./jobs";
import type { Logger, RepoRef, TeamRef } from "./refs";
import type { StorageCapability } from "./storage";

/**
 * Capabilities the kernel can inject.
 *
 * Some are provided by core, some by *provider plugins* (see `provides` below).
 * A consumer cannot tell the difference, and should not need to — the only real
 * distinction is who reviews changes to the implementation.
 */
export interface CapabilityMap {
  browser: BrowserCapability;
  ai: AiCapability;
  jobs: JobsCapability;
  data: DataCapability;
  storage: StorageCapability;
  /**
   * Activity events + fan-out. NOT core — supplied by the `events` provider
   * plugin. See `docs/architecture/core-scope.md` §4: fan-out is a delivery
   * mechanism, not a tenancy/capacity/money/credential boundary.
   */
  events: EventsCapability;
}

export type CapabilityName = keyof CapabilityMap;

export interface EventsCapability {
  emit(type: string, payload: unknown): Promise<void>;
  /** Returns an unsubscribe function. */
  subscribe(type: string, fn: (payload: unknown) => void): () => void;
}

/**
 * What a plugin receives. Exactly the declared capabilities and nothing else.
 *
 * The `C` parameter is what makes that a *compile-time* guarantee rather than a
 * runtime surprise: a plugin that did not declare `"browser"` gets a type error
 * on `ctx.browser`, not `undefined` at 3am.
 */
export type PluginContext<C extends CapabilityName = never> = {
  readonly pluginId: string;
  readonly team: TeamRef;
  readonly repo?: RepoRef;
  /** Pre-scoped to the plugin id. */
  readonly log: Logger;
} & { readonly [K in C]: CapabilityMap[K] };

export interface NavEntry {
  readonly href: string;
  readonly label: string;
  /** lucide-react icon name, resolved by the shell. */
  readonly icon?: string;
}

export interface PluginManifest<
  C extends CapabilityName = never,
  P extends CapabilityName = never,
> {
  /** kebab-case. Namespaces the plugin's tables, jobs, storage keys and events. */
  readonly id: string;
  readonly title: string;

  /**
   * Capabilities this plugin consumes. The kernel builds a context containing
   * exactly these.
   *
   * Adding one is a one-line diff in the manifest — that visible diff *is* the
   * audit trail, and it is why the manifest is the reviewable unit rather than
   * the import list.
   */
  readonly capabilities?: readonly C[];

  /**
   * Capabilities this plugin *provides* to other plugins.
   *
   * The answer to "if several plugins need fan-out logic, that can be a plugin
   * too, which feeds other plugins' features". The kernel wires provider to
   * consumer, so the consumer still never imports the provider and the
   * no-plugin-to-plugin-import rule holds unchanged.
   */
  readonly provides?: readonly P[];

  /** The plugin's own tables. Core never reads them. */
  readonly schema?: () => Promise<unknown>;

  /**
   * Required whenever `schema` is present. Without an FK to core there is no
   * database cascade, so deletion has to be driven explicitly or plugin rows
   * outlive the team that owned them. See `core-scope.md` §6.
   */
  readonly deletion?: DeletionHook;

  /** Job handlers, keyed by `"<id>.<name>"`. Core owns the queue and the loop. */
  readonly jobs?: Readonly<Record<string, JobHandler<PluginContext<C>>>>;

  readonly ui?: {
    readonly nav?: readonly NavEntry[];
  };
}

// `definePlugin` deliberately lives in `@lastest/kernel`, not here: this package
// is types only, so that importing it can never pull runtime code into a build.
