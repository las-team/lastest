/**
 * Failure modes a plugin is expected to handle, named so it can tell them
 * apart. "Something went wrong with the browser" is not an actionable thing to
 * show a user; "all browsers are busy" is.
 */

export class NoBrowserAvailableError extends Error {
  constructor(timeoutMs: number) {
    super(
      `No embedded browser became available within ${Math.round(timeoutMs / 1000)}s — the pool is at capacity`,
    );
    this.name = "NoBrowserAvailableError";
  }
}

export class BrowserDeadlineExceededError extends Error {
  constructor(readonly deadlineMs: number) {
    super(
      `Browser deadline of ${Math.round(deadlineMs / 1000)}s exceeded — the session was torn down`,
    );
    this.name = "BrowserDeadlineExceededError";
  }
}

export class DeadlineExtensionRefusedError extends Error {
  constructor(plan: string, maxHoldMs: number) {
    super(
      `Deadline extension refused: plan "${plan}" may hold a browser for at most ` +
        `${Math.round(maxHoldMs / 60_000)} minutes`,
    );
    this.name = "DeadlineExtensionRefusedError";
  }
}

/** Raised when a session method is used after its `withBrowser` scope ended. */
export class BrowserSessionClosedError extends Error {
  constructor() {
    super(
      "Browser session is closed — it cannot be used outside the withBrowser callback",
    );
    this.name = "BrowserSessionClosedError";
  }
}
