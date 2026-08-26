/**
 * The host port.
 *
 * `docs/architecture/core-scope.md` §4 puts fan-out itself in this provider
 * plugin, not core — it holds no secret, gates no spend, exhausts nothing
 * shared. But the *data* it fans out is a different question: `activityEvents`
 * is one team-wide table read by a cross-feature activity feed
 * (`/api/v1/activity`, `/api/activity-feed/history`) and written by qa-agent,
 * play-agent, quickstart-agent, spec-import and gamification — none of which
 * are migrating in this change. That is core-owned data by any reading of §6:
 * this plugin cannot declare its own `explorer_events`-shaped table and call
 * it done, because the whole point is one feed shared across features that are
 * not plugins yet.
 *
 * So this plugin is honest about being a *policy* layer over data it does not
 * own: it turns the kernel's `emit(type, payload)` into a call on a host the
 * composition root fills, exactly the shape `core/browser`'s `BrowserHost`
 * uses and for the same reason — injecting the primitive keeps this package
 * free of `@/…` imports.
 */

export interface EventsHostEmit {
  readonly pluginId: string;
  readonly teamId: string;
  readonly repositoryId?: string;
  readonly type: string;
  readonly payload: unknown;
}

export interface EventsHost {
  /** Fire-and-forget from the caller's point of view — see `emit` below. */
  emit(evt: EventsHostEmit): Promise<void>;
  /** Returns an unsubscribe function. */
  subscribe(type: string, fn: (payload: unknown) => void): () => void;
}
