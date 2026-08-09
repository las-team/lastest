import type {
  CapabilityName,
  PluginContext,
  PluginManifest,
} from "@lastest/contracts";

import {
  buildContext,
  type CapabilityFactories,
  type ContextScope,
  type ResolvedRegistry,
} from "./registry";

/**
 * How a plugin gets its `ctx`.
 *
 * `buildContext` answers "given a scope, what does this plugin see". It does
 * not answer where the scope comes from, and that gap was the most-repeated
 * unknown in the explorer migration: every one of a plugin's `"use server"`
 * actions starts by resolving a team and a repo, and none of them can call the
 * app's auth guard, because a plugin may not import `@/…`.
 *
 * The answer is to invert it. The runtime holds a `resolveScope` supplied at
 * wiring time by whoever owns authentication — the Next.js app in production, a
 * stub in tests. The plugin calls `contextFor(manifest)` and never learns how
 * the team was established, which is what stops a plugin widening its own
 * scope: there is no `setTeam`, and every capability is bound to whatever
 * `resolveScope` returned.
 */

export interface ScopeRequest {
  readonly pluginId: string;
  /** Scope to a repository. The resolver is expected to authorize it. */
  readonly repositoryId?: string;
  /**
   * Act for a specific team, for paths with no session to derive one from —
   * a cron trigger firing, or a job handler resuming work enqueued hours ago.
   *
   * A resolver must treat this as *untrusted input on request paths*: it is
   * only legitimate when the caller is core itself. Honouring it from a user
   * request would be a tenancy escape, which is the one thing this whole
   * exercise exists to prevent.
   */
  readonly teamId?: string;
}

export type ScopeResolver = (req: ScopeRequest) => Promise<ContextScope>;

export interface RuntimeOptions {
  readonly registry: ResolvedRegistry;
  readonly factories: CapabilityFactories;
  readonly resolveScope: ScopeResolver;
}

export class UnknownJobTypeError extends Error {
  constructor(type: string) {
    super(`No plugin registered job type "${type}"`);
    this.name = "UnknownJobTypeError";
  }
}

export interface JobDispatchRun {
  readonly id: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly signal: AbortSignal;
}

export interface PluginRuntime {
  /**
   * Build a context for one plugin.
   *
   * Takes the manifest rather than an id so the returned context stays narrowed
   * to the capabilities that manifest declared — an id would erase `C` and hand
   * back a context typed as having everything, which is exactly the failure
   * `definePlugin`'s `const` parameters exist to prevent.
   */
  contextFor<C extends CapabilityName, P extends CapabilityName>(
    manifest: PluginManifest<C, P>,
    req?: Omit<ScopeRequest, "pluginId">,
  ): Promise<PluginContext<C>>;

  /**
   * Run a queued job. Core's worker calls this; it is the only path by which a
   * plugin's job handler executes.
   */
  dispatch(
    type: string,
    payload: unknown,
    run: JobDispatchRun,
    scope?: Omit<ScopeRequest, "pluginId">,
  ): Promise<void>;
}

/**
 * Fold `registry.providers` into a `CapabilityFactories` map alongside core's
 * own factories.
 *
 * A provider plugin's `implement[cap]` takes a `ProviderScope`
 * (`consumerId` + the resolved `team`/`repo`), not the `(pluginId, scope)`
 * shape `CapabilityFactories` expects — so each entry is wrapped once, here,
 * rather than asking every provider to know the kernel's internal factory
 * signature. The wrapping is what keeps a provider plugin from receiving
 * anything beyond `ProviderScope`: it never sees the consumer's other
 * capabilities, because nothing here passes them along.
 *
 * Core-provided capabilities always win a name collision — `resolveRegistry`
 * already rejects a plugin that tries to `provide` one, so this is a second,
 * structural guarantee rather than a real conflict path.
 */
function withProviders(
  factories: CapabilityFactories,
  registry: ResolvedRegistry,
): CapabilityFactories {
  const byId = new Map(registry.plugins.map((p) => [p.id, p]));
  const merged: Record<string, CapabilityFactories[string]> = {
    ...factories,
  };

  for (const [cap, providerId] of registry.providers) {
    if (merged[cap]) continue; // core already provides it
    const provider = byId.get(providerId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const impl = (provider?.implement as any)?.[cap];
    // `resolveRegistry` already refuses to boot without this — reaching here
    // with no `impl` would mean a registry that was never validated.
    if (typeof impl !== "function") continue;
    merged[cap] = (consumerId: string, scope: ContextScope) =>
      impl({ consumerId, team: scope.team, repo: scope.repo });
  }

  return merged;
}

export function createRuntime(opts: RuntimeOptions): PluginRuntime {
  const byId = new Map(opts.registry.plugins.map((p) => [p.id, p]));
  const factories = withProviders(opts.factories, opts.registry);

  return {
    async contextFor(manifest, req) {
      const scope = await opts.resolveScope({
        pluginId: manifest.id,
        ...req,
      });
      return buildContext(manifest, scope, factories);
    },

    async dispatch(type, payload, run, scope) {
      const pluginId = opts.registry.jobTypes.get(type);
      // `resolveRegistry` already proved every registered handler is namespaced
      // to its plugin, so reaching here means the *queue* holds a type no
      // plugin claims — a stale row after a plugin was removed, most likely.
      if (!pluginId) throw new UnknownJobTypeError(type);

      const manifest = byId.get(pluginId);
      const handler = manifest?.jobs?.[type];
      if (!manifest || !handler) throw new UnknownJobTypeError(type);

      const ctx = buildContext(
        manifest,
        await opts.resolveScope({ pluginId, ...scope }),
        factories,
      );
      await handler(ctx, payload, run);
    },
  };
}
