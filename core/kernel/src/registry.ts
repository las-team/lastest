import type {
  CapabilityName,
  CheckLayerDescriptor,
  JobHandler,
  Logger,
  PluginContext,
  PluginManifest,
} from "@lastest/contracts";

/**
 * The plugin registry.
 *
 * Core under the revised bar (`docs/architecture/core-scope.md` §2) for the
 * fifth reason — it is the shared mutable state that makes the rest work, and
 * something has to be.
 *
 * Its job is to turn a set of manifests into a resolved, validated world:
 * ids are unique, namespacing rules hold, every consumed capability has exactly
 * one provider, and every plugin that stores data can also delete it. All of
 * that is checked **once, at startup**, so a misconfiguration is a boot failure
 * rather than an incident at 3am.
 */

export const PLUGIN_ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export class PluginRegistryError extends Error {
  constructor(readonly problems: string[]) {
    super(`Plugin registry is invalid:\n  - ${problems.join("\n  - ")}`);
    this.name = "PluginRegistryError";
  }
}

/** Capabilities core supplies itself. Anything else must come from a plugin. */
export const CORE_PROVIDED: readonly CapabilityName[] = [
  "browser",
  "ai",
  "jobs",
  "data",
  "storage",
  "repos",
  "tests",
];

/**
 * Check-layer ids core supplies itself (`src/lib/verify/check-modes.ts`'s
 * bespoke derive logic — network/console's multi-axis legacy fallbacks don't
 * reduce to a plugin-declarable shape). Anything else must come from a
 * plugin's `checkLayers`.
 */
export const CORE_CHECK_LAYERS: readonly string[] = [
  "visual",
  "text",
  "dom",
  "network",
  "console",
  "perf",
  "url",
  "api",
  "storage",
];

/**
 * The registry-wide view of a manifest, deliberately loosened.
 *
 * `jobs` and `implement` are function-valued mapped types over `C`/`P`
 * (`JobHandler<PluginContext<C>>`, `ProvidedCapabilities<P>`), and a function
 * *parameter* position is checked contravariantly under `strictFunctionTypes`.
 * Once a manifest has more than one such field, TypeScript stops taking the
 * shortcut that let a single generic-erased `PluginManifest<any, any>` accept
 * every concrete manifest — `PluginContext<any>` no longer satisfies "has
 * property `browser`" for a manifest that declared `capabilities: ["browser"]`,
 * even though at runtime this is never unsound: nothing here calls a job
 * handler through this widened type. `createRuntime.dispatch` always looks up
 * the concrete manifest by id first and calls its own handler with its own
 * `PluginContext<C>` — the loosening below only affects *storage* in the
 * registry, matching `CapabilityFactories`' own documented reason for
 * returning `unknown` rather than a capability union.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyManifest = Omit<PluginManifest<any, any>, "jobs" | "implement"> & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly jobs?: Readonly<Record<string, JobHandler<any>>>;
  readonly implement?: Readonly<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Record<string, (scope: any) => unknown>
  >;
};

export interface ResolvedRegistry {
  readonly plugins: readonly AnyManifest[];
  /** Capability name → the plugin id providing it, for non-core capabilities. */
  readonly providers: ReadonlyMap<CapabilityName, string>;
  /** Job type → owning plugin id. */
  readonly jobTypes: ReadonlyMap<string, string>;
  /** Check layer id → descriptor, for every plugin-contributed layer. */
  readonly checkLayers: ReadonlyMap<
    string,
    CheckLayerDescriptor & { readonly pluginId: string }
  >;
}

/**
 * Validate and resolve a set of manifests.
 *
 * Every rule below exists because breaking it is silent otherwise:
 *
 * - **Duplicate / malformed ids** — the id namespaces tables, jobs, storage keys
 *   and events. Two plugins sharing one means they share all of those.
 * - **Job type prefix** — `"<id>.<name>"` is what keeps one plugin from
 *   registering a handler for another plugin's work.
 * - **Storage without a deletion hook** — no FK to core means no cascade, so a
 *   missing hook leaves rows behind when a team is deleted. That is a GDPR
 *   problem, and it is invisible until someone audits it. See §6 of core-scope.
 * - **Unprovided / doubly-provided capability** — a consumer would otherwise get
 *   `undefined` from a context the type system swore was populated.
 * - **Check layer id collision** — with a core-owned id (`CORE_CHECK_LAYERS`)
 *   or another plugin's. `CheckLayer` is an open registry (RFC §6.3); a
 *   collision here would mean two layers silently overwriting one another's
 *   mode/evidence in the Verify UI.
 */
export function resolveRegistry(
  manifests: readonly AnyManifest[],
): ResolvedRegistry {
  const problems: string[] = [];
  const seen = new Set<string>();
  const providers = new Map<CapabilityName, string>();
  const jobTypes = new Map<string, string>();
  const checkLayers = new Map<
    string,
    CheckLayerDescriptor & { pluginId: string }
  >();

  for (const m of manifests) {
    if (!PLUGIN_ID_RE.test(m.id)) {
      problems.push(
        `"${m.id}" is not a valid plugin id (expected kebab-case, e.g. "qa-agent")`,
      );
    }
    if (seen.has(m.id)) {
      problems.push(`duplicate plugin id "${m.id}"`);
    }
    seen.add(m.id);

    for (const type of Object.keys(m.jobs ?? {})) {
      if (!type.startsWith(`${m.id}.`)) {
        problems.push(
          `plugin "${m.id}" registers job type "${type}" — must be prefixed "${m.id}."`,
        );
      }
      const owner = jobTypes.get(type);
      if (owner) {
        problems.push(
          `job type "${type}" is registered by both "${owner}" and "${m.id}"`,
        );
      }
      jobTypes.set(type, m.id);
    }

    if (m.schema && !m.deletion) {
      problems.push(
        `plugin "${m.id}" declares schema but no deletion hook — without an FK ` +
          `to core there is no cascade, so its rows would outlive a deleted team`,
      );
    }

    for (const cap of m.provides ?? []) {
      if (CORE_PROVIDED.includes(cap)) {
        problems.push(
          `plugin "${m.id}" provides "${cap}", which core already provides`,
        );
        continue;
      }
      // An unimplemented `provides` entry should fail at boot, the same way an
      // unimplemented `deletion` hook does — the alternative is a consumer
      // discovering it at its first request, from a `ctx.<cap>` that is
      // `undefined` despite the type system swearing otherwise.
      if (typeof m.implement?.[cap] !== "function") {
        problems.push(
          `plugin "${m.id}" provides "${cap}" but has no \`implement.${cap}\``,
        );
      }
      const owner = providers.get(cap);
      if (owner) {
        problems.push(
          `capability "${cap}" is provided by both "${owner}" and "${m.id}"`,
        );
      }
      providers.set(cap, m.id);
    }

    for (const layer of m.checkLayers ?? []) {
      if (CORE_CHECK_LAYERS.includes(layer.id)) {
        problems.push(
          `plugin "${m.id}" contributes check layer "${layer.id}", which core already owns`,
        );
        continue;
      }
      const owner = checkLayers.get(layer.id);
      if (owner) {
        problems.push(
          `check layer "${layer.id}" is contributed by both "${owner.pluginId}" and "${m.id}"`,
        );
      }
      checkLayers.set(layer.id, { ...layer, pluginId: m.id });
    }
  }

  // Second pass: consumers need their providers to exist. Done separately so
  // declaration order in the manifest list does not matter.
  for (const m of manifests) {
    for (const cap of m.capabilities ?? []) {
      if (CORE_PROVIDED.includes(cap)) continue;
      if (!providers.has(cap)) {
        problems.push(
          `plugin "${m.id}" needs capability "${cap}", which no plugin provides ` +
            `(add a plugin declaring \`provides: ["${cap}"]\`)`,
        );
      }
    }
  }

  if (problems.length > 0) throw new PluginRegistryError(problems);

  return { plugins: [...manifests], providers, jobTypes, checkLayers };
}

/**
 * Everything the kernel needs in order to build a context.
 *
 * Factories return `unknown` rather than a capability union: the mapping from
 * name to capability type is already enforced at the *declaration* site by
 * `CapabilityMap`, and duplicating it here would only let the two drift.
 * `buildContext` does the one cast, in one place.
 */
export interface CapabilityFactories {
  readonly [name: string]:
    | ((pluginId: string, scope: ContextScope) => unknown)
    | undefined;
}

export interface ContextScope {
  readonly team: PluginContext["team"];
  readonly repo?: PluginContext["repo"];
  readonly log: Logger;
}

/**
 * Build the context for one plugin: exactly its declared capabilities, nothing
 * else.
 *
 * The runtime object is built from the same `capabilities` array the types are
 * derived from, so the compile-time narrowing and the runtime shape cannot
 * drift apart — which is the only way the `ctx.browser` type error is a real
 * guarantee rather than a comment.
 */
export function buildContext<
  C extends CapabilityName,
  P extends CapabilityName,
>(
  manifest: PluginManifest<C, P>,
  scope: ContextScope,
  factories: CapabilityFactories,
): PluginContext<C> {
  const ctx: Record<string, unknown> = {
    pluginId: manifest.id,
    team: scope.team,
    repo: scope.repo,
    log: scope.log,
  };

  for (const cap of manifest.capabilities ?? []) {
    const factory = factories[cap];
    if (!factory) {
      throw new Error(
        `No factory registered for capability "${cap}" required by plugin "${manifest.id}"`,
      );
    }
    ctx[cap] = factory(manifest.id, scope);
  }

  return ctx as PluginContext<C>;
}
