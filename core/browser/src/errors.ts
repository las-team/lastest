/**
 * Failure modes a plugin is expected to handle, named so it can tell them
 * apart. "Something went wrong with the browser" is not an actionable thing to
 * show a user; "all browsers are busy" is.
 *
 * A plugin cannot `instanceof` these — this package is composition-root code
 * no plugin may import — so it matches on `err.name`. Every `name` below is
 * therefore typed as `BrowserErrorName` rather than `string`: the union is
 * declared in `@lastest/contracts`, which is what makes a rename here a
 * compile error on both sides instead of a plugin branch that silently stops
 * matching. Change a string, and this file fails to typecheck until the union
 * agrees; drop a member from the union, and the plugin reading it fails.
 */
import type { BrowserErrorName } from "@lastest/contracts";

export class NoBrowserAvailableError extends Error {
  override readonly name: BrowserErrorName;

  constructor(timeoutMs: number) {
    super(
      `No embedded browser became available within ${Math.round(timeoutMs / 1000)}s — the pool is at capacity`,
    );
    this.name = "NoBrowserAvailableError";
  }
}

export class BrowserDeadlineExceededError extends Error {
  override readonly name: BrowserErrorName;

  constructor(readonly deadlineMs: number) {
    super(
      `Browser deadline of ${Math.round(deadlineMs / 1000)}s exceeded — the session was torn down`,
    );
    this.name = "BrowserDeadlineExceededError";
  }
}

export class DeadlineExtensionRefusedError extends Error {
  override readonly name: BrowserErrorName;

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
  override readonly name: BrowserErrorName;

  constructor() {
    super(
      "Browser session is closed — it cannot be used outside the withBrowser callback",
    );
    this.name = "BrowserSessionClosedError";
  }
}
