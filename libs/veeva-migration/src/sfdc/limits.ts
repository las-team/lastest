/**
 * Daily API budget (§2.1.7, §8.3): a token bucket seeded from
 * `GET /limits` (`DailyApiRequests.Remaining − reserve`) and refreshed by
 * the `Sforce-Limit-Info: api-usage=used/max` header every REST response
 * carries. Also the small semaphore used for the REST / Bulk worker caps.
 */
import { SfdcApiError } from "./errors";
import type { SfdcLimits } from "./types";

export interface LimitInfo {
  used: number;
  max: number;
}

/**
 * Parse `Sforce-Limit-Info`. Salesforce sends `api-usage=123/15000`,
 * optionally followed by `,per-app-api-usage=…`; only `api-usage` is used.
 */
export function parseLimitInfo(
  header: string | null | undefined,
): LimitInfo | null {
  if (!header) return null;
  const m = /(?:^|[,;\s])api-usage=(\d+)\/(\d+)/i.exec(header);
  if (!m) return null;
  return { used: Number(m[1]), max: Number(m[2]) };
}

export interface ApiBudgetOptions {
  /** Reserve as a percentage of `Max` (`performance.sfdcApiFloorPct`, default 20). */
  reservePct?: number;
  /** Absolute reserve — wins over `reservePct` when set. */
  reserve?: number;
}

export interface ApiBudgetSnapshot {
  max: number | undefined;
  used: number | undefined;
  /** Requests consumed locally since the last server refresh. */
  localConsumed: number;
  reserve: number;
  remaining: number | undefined;
  available: number | undefined;
}

/**
 * Token bucket over the org's daily API allocation. Until the first server
 * refresh (`fromLimits` / `fromLimitInfo`) the budget is *unknown* and never
 * blocks; once known, `assertAvailable()` throws a `budget`-class
 * `SfdcApiError` when `remaining − reserve ≤ 0`.
 */
export class ApiBudget {
  private max: number | undefined;
  private used: number | undefined;
  private localConsumed = 0;
  private readonly reservePct: number;
  private readonly reserveAbs: number | undefined;

  constructor(opts: ApiBudgetOptions = {}) {
    this.reservePct = opts.reservePct ?? 20;
    this.reserveAbs = opts.reserve;
  }

  get known(): boolean {
    return this.max !== undefined && this.used !== undefined;
  }

  get reserve(): number {
    if (this.reserveAbs !== undefined) return this.reserveAbs;
    if (this.max === undefined) return 0;
    return Math.ceil((this.max * this.reservePct) / 100);
  }

  get remaining(): number | undefined {
    if (this.max === undefined || this.used === undefined) return undefined;
    return Math.max(0, this.max - this.used - this.localConsumed);
  }

  get available(): number | undefined {
    const r = this.remaining;
    return r === undefined ? undefined : r - this.reserve;
  }

  /** Refresh from a `Sforce-Limit-Info` header; returns whether it parsed. */
  fromLimitInfo(header: string | null | undefined): boolean {
    const info = parseLimitInfo(header);
    if (!info) return false;
    this.max = info.max;
    this.used = info.used;
    this.localConsumed = 0;
    return true;
  }

  /** Refresh from `GET /limits`. */
  fromLimits(limits: Pick<SfdcLimits, "DailyApiRequests">): void {
    const d = limits.DailyApiRequests;
    if (!d) return;
    this.max = d.Max;
    this.used = d.Max - d.Remaining;
    this.localConsumed = 0;
  }

  /** Count a request sent between server refreshes. */
  consume(n = 1): void {
    this.localConsumed += n;
  }

  /** Throw (class `budget`) when the reserve would be breached. */
  assertAvailable(): void {
    const a = this.available;
    if (a !== undefined && a <= 0) {
      throw new SfdcApiError(
        `Daily API budget exhausted: ${this.remaining} of ${this.max} requests remain, reserve is ${this.reserve} (performance.sfdcApiFloorPct)`,
        { errorCode: "API_BUDGET_EXHAUSTED", errorClass: "budget" },
      );
    }
  }

  snapshot(): ApiBudgetSnapshot {
    return {
      max: this.max,
      used: this.used,
      localConsumed: this.localConsumed,
      reserve: this.reserve,
      remaining: this.remaining,
      available: this.available,
    };
  }
}

/** Minimal counting semaphore for the REST (2) and Bulk (4) worker caps (§8.3). */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1)
      throw new Error(
        `Semaphore limit must be a positive integer, got ${limit}`,
      );
  }

  get inUse(): number {
    return this.active;
  }

  get pending(): number {
    return this.waiters.length;
  }

  acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const grant = () => {
        this.active++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.active--;
          const next = this.waiters.shift();
          if (next) next();
        });
      };
      if (this.active < this.limit) grant();
      else this.waiters.push(grant);
    });
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
