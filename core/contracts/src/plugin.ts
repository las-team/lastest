/**
 * The plugin contract: what a plugin declares, and what it gets back.
 *
 * Nothing here is dynamic at runtime. Plugins are compile-time workspace
 * packages linked into one build (RFC §2); `definePlugin` is a typed identity
 * function and the kernel resolves manifests statically.
 */
import type { AiCapability } from "./ai";
import type { BrowserCapability } from "./browser";
import type { CheckLayerDescriptor } from "./check-layer";
import type { DataCapability, DeletionHook } from "./data";
import type { JobHandler, JobsCapability } from "./jobs";
import type { Logger, RepoRef, TeamRef } from "./refs";
import type { ReposCapability } from "./repos";
import type { StorageCapability } from "./storage";
import type { TestsCapability } from "./tests";

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
  repos: ReposCapability;
  tests: TestsCapability;
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
 * What a *provider* plugin learns about the plugin it is building a capability
 * for.
 *
 * Deliberately narrower than `PluginContext`, and narrower than the
 * `ContextScope` core's own factories receive:
 *
 * - `consumerId`, `team` and `repo` are present because a provider cannot do
 *   its job without them — an event has to be attributed to a tenant and to
 *   whoever raised it, and a provider that had to be *told* the team by the
 *   consumer would be trusting the consumer not to lie about it. Taking it
 *   from the resolved scope instead is the whole tenancy argument.
 * - `log` is absent. A provider logs under its own plugin id, wired where it
 *   was composed; borrowing the consumer's logger would file the provider's
 *   warnings under the wrong feature.
 * - the consumer's *other* capabilities are absent, and there is no route to
 *   them. A provider cannot reach the consumer's browser, data handle or AI
 *   budget, so "plugin A provides to plugin B" never becomes "plugin A acts as
 *   plugin B".
 */
export interface ProviderScope {
  /** The plugin this capability instance is being built for. */
  readonly consumerId: string;
  readonly team: TeamRef;
  readonly repo?: RepoRef;
}

/**
 * The implementations a provider plugin supplies, keyed by capability name.
 *
 * A function type, so `@lastest/contracts` stays types-only — nothing here has
 * a runtime representation, and the provider's actual code lives in the
 * provider's own package where it belongs. The mapped type is what makes the
 * declaration honest: `implement.events` must return an `EventsCapability`,
 * checked at the provider's definition site rather than discovered by a
 * consumer at runtime.
 */
export type ProvidedCapabilities<P extends CapabilityName> = {
  readonly [K in P]: (scope: ProviderScope) => CapabilityMap[K];
};

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

  /**
   * Required whenever `provides` is non-empty: one implementation function per
   * provided capability. `resolveRegistry` refuses to boot a plugin that lists
   * a capability here without one, for the same reason it refuses `schema`
   * without `deletion` — an unimplemented promise should fail at startup, not
   * at the first consumer's first request.
   */
  readonly implement?: ProvidedCapabilities<P>;

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

  /**
   * Check layers this plugin contributes to the Verify pipeline (RFC §6.3).
   * `resolveRegistry` rejects an id that collides with a core-owned layer or
   * another plugin's — see `core/kernel/src/registry.ts`'s `CORE_CHECK_LAYERS`.
   */
  readonly checkLayers?: readonly CheckLayerDescriptor[];

  readonly ui?: {
    readonly nav?: readonly NavEntry[];
  };
}

// `definePlugin` deliberately lives in `@lastest/kernel`, not here: this package
// is types only, so that importing it can never pull runtime code into a build.
