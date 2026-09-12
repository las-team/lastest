/**
 * Shared runtime for the loader modules: retry-wrapped Vault calls, write
 * headers per §2.5.4, row-result sink and clock. One instance per
 * `DefaultLoader`.
 */
import { getLogger, type Logger } from "../logger";
import type { RowResult } from "../types";
import type { VaultWriteOptions } from "../vault/types";
import { withLoadRetry, type LoadRetryOptions } from "./retry";
import type { LoadPlan, LoaderDeps } from "./types";

export interface LoaderOptions {
  retry?: LoadRetryOptions;
  now?: () => Date;
  /** §8.6 blob batch cap in bytes (default 64 MB). */
  blobBatchBytes?: number;
  /** REST blob fetch chunk (default 100 ids). */
  blobFetchIds?: number;
  /**
   * Cooperative cancellation, checked between batches. Supplied by the engine
   * from `RunContext.signal`; see `../cancel.ts` for why a cancellation is
   * not modelled as a `structuralError`.
   */
  signal?: AbortSignal;
}

export class LoaderRuntime {
  /** Per (run, unit) batch counter — continuous across partitions, closure loads, pending rounds and deletes (§2.5.1 reference ids, §8.5 audit). */
  private readonly batchCounters = new Map<string, number>();

  constructor(
    readonly deps: LoaderDeps,
    readonly opts: LoaderOptions = {},
  ) {}

  /**
   * Next batch number of a unit in this run. Seeded on first use from the
   * `row_results` already written for the unit (resume, §8.2) so the
   * `X-VaultAPI-ReferenceId` `{run}:{object}:{batch}` never repeats.
   */
  async nextBatchNo(plan: LoadPlan): Promise<number> {
    const key = `${plan.runId}|${plan.unit.objectKey}|${plan.unit.country}`;
    let n = this.batchCounters.get(key);
    if (n === undefined) {
      n = 0;
      try {
        const rows = await this.deps.store.rowResults.query({
          runId: plan.runId,
          objectKey: plan.unit.objectKey,
          country: plan.unit.country,
        });
        for (const r of rows) if (r.batchNo && r.batchNo > n) n = r.batchNo;
      } catch {
        n = 0;
      }
    }
    n++;
    this.batchCounters.set(key, n);
    return n;
  }

  now(): string {
    return (this.opts.now ?? (() => new Date()))().toISOString();
  }

  log(plan: LoadPlan): Logger {
    return getLogger("Load", {
      run_id: plan.runId,
      object_key: plan.unit.objectKey,
      country: plan.unit.country,
    });
  }

  /** One Vault call with the §8.1 policy (+ one re-auth on a session error). */
  call<T>(plan: LoadPlan, fn: () => Promise<T>): Promise<T> {
    const log = this.log(plan);
    return withLoadRetry(fn, {
      ...this.opts.retry,
      reauth: () => this.deps.vault.authenticate(),
      onRetry: (info) => {
        log.warn(
          {
            attempt: info.attempt,
            delay_ms: info.delayMs,
            error_class: info.errorClass,
            err: info.error,
          },
          "vault call retried",
        );
        this.opts.retry?.onRetry?.(info);
      },
    });
  }

  /** §2.5.4 headers from the module load options + config overrides. */
  writeOptions(plan: LoadPlan, batchNo: number): VaultWriteOptions {
    return {
      idParam: plan.target.legacyIdField ?? plan.mapping.legacyIdField,
      migrationMode: plan.mapping.load.migrationMode ?? plan.migrationMode,
      noTriggers: plan.mapping.load.noTriggers,
      unchangedFieldBehavior: plan.unchangedFieldBehavior,
      referenceId: `${plan.runId}:${plan.unit.objectKey}:${batchNo}`,
    };
  }

  async rowResults(rows: RowResult[]): Promise<void> {
    if (!rows.length) return;
    if (this.deps.onRowResults) await this.deps.onRowResults(rows);
    else await this.deps.store.rowResults.upsert(rows);
  }

  /** Warn on throttling (§8.3: `X-VaultAPI-ResponseDelay > 0` is logged as warn). */
  noteBurst(plan: LoadPlan): number | undefined {
    const b = this.deps.vault.burst;
    if (b.responseDelayMs && b.responseDelayMs > 0)
      this.log(plan).warn(
        {
          response_delay_ms: b.responseDelayMs,
          burst_remaining: b.burstLimitRemaining,
        },
        "vault throttling applied",
      );
    return b.burstLimitRemaining;
  }
}
