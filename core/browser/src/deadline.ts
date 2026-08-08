/**
 * Deadline tracking for one claim.
 *
 * Capacity, per `core-scope.md` §5: a plugin cannot hold an EB forever, and it
 * must not be able to by forgetting a timeout. The enforcement is honest but
 * worth stating precisely — JavaScript cannot kill a running callback. What
 * expiry does is tear the browser down and release the pool slot, so the
 * callback's next page call fails and the *capacity* is recovered immediately.
 * The plugin's promise may still be pending; the EB is not still occupied.
 */

export class Deadline {
  private expiresAt: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private fired = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    ms: number,
    /** Injectable for tests; production always uses the real clock. */
    private readonly now: () => number = Date.now,
  ) {
    this.expiresAt = this.now() + ms;
    this.arm();
  }

  get deadline(): number {
    return this.expiresAt;
  }

  get expired(): boolean {
    return this.fired;
  }

  get remainingMs(): number {
    return Math.max(0, this.expiresAt - this.now());
  }

  /**
   * Resolves when the deadline passes. Deliberately **resolves** rather than
   * rejects: a promise that rejects and loses its race is an unhandled
   * rejection, which in Next.js means a process-level warning for something
   * that is not an error. The caller decides what to throw.
   */
  whenExpired(): Promise<void> {
    if (this.fired) return Promise.resolve();
    return new Promise<void>((resolve) => this.listeners.add(resolve));
  }

  /** Push the deadline out. The caller is responsible for the policy check. */
  extendTo(at: number): number {
    if (this.fired) return this.expiresAt;
    this.expiresAt = Math.max(this.expiresAt, at);
    this.arm();
    return this.expiresAt;
  }

  /** Stop the timer. Safe to call twice; always called from a `finally`. */
  clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.listeners.clear();
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fire(), this.remainingMs);
    // A pending EB deadline must not hold the process open on its own — the
    // work it guards is already keeping the event loop busy if it matters.
    this.timer.unref?.();
  }

  private fire(): void {
    if (this.fired) return;
    this.fired = true;
    const listeners = [...this.listeners];
    this.listeners.clear();
    for (const fn of listeners) fn();
  }
}
