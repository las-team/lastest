/**
 * Cooperative cancellation.
 *
 * `RunContext.signal` is the only way to stop a run. Before it existed the
 * app's "abandon run" button could do nothing but release the
 * one-run-per-project guard and mark the row aborted — documented as such, in
 * the action itself — while the engine kept extracting from Salesforce and
 * upserting into a live Vault. A deploy mid-run was the same story from the
 * other side: nothing stopped, and the project stayed locked.
 *
 * Cancellation is NOT a failure and must never be reported as one. A cancelled
 * run has nothing wrong with its data, its config or its mapping; an operator
 * stopped it. That distinction is why this is its own error class and its own
 * exit code (`EXIT_CODES.aborted`) rather than a `structuralError` on the load
 * result — the latter would raise a blocking `LOAD_STRUCTURAL_FAILURE` finding
 * and fail the unit, which would then be retried by `retry-failed`.
 *
 * Checks are cooperative and therefore coarse: unit boundaries in the engine and
 * batch boundaries in the loader. A cancelled run finishes the batch it is in,
 * so the Vault never sees a half-sent request, and the id map stays consistent
 * with what was actually written.
 */

/** Thrown at the first cancellation checkpoint after the signal fires. */
export class RunCancelled extends Error {
  constructor(message = "run cancelled by caller") {
    super(message);
    this.name = "RunCancelled";
  }
}

/** Throw if the caller has cancelled. A no-op when no signal was supplied. */
export function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RunCancelled();
}
