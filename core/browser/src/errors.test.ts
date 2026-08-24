import { describe, it, expect } from "vitest";

import {
  BrowserDeadlineExceededError,
  BrowserSessionClosedError,
  DeadlineExtensionRefusedError,
  NoBrowserAvailableError,
} from "./errors";

/**
 * `name` is load-bearing across the plugin boundary: a plugin cannot
 * `instanceof` these classes, so it matches the string (see
 * `BrowserErrorName` in `@lastest/contracts`, and
 * `plugins/quickstart/src/scout-error.ts` for a consumer). The type annotation
 * on each class catches a string that drifts out of the union; this catches
 * the other half — a value that stops being set at all, e.g. by dropping the
 * assignment when refactoring a constructor.
 */
describe("browser error names cross the plugin boundary intact", () => {
  it.each([
    [new NoBrowserAvailableError(300_000), "NoBrowserAvailableError"],
    [new BrowserDeadlineExceededError(300_000), "BrowserDeadlineExceededError"],
    [
      new DeadlineExtensionRefusedError("free", 300_000),
      "DeadlineExtensionRefusedError",
    ],
    [new BrowserSessionClosedError(), "BrowserSessionClosedError"],
  ])("%#: carries its name and a non-empty message", (err, expected) => {
    expect(err.name).toBe(expected);
    expect(err.message.length).toBeGreaterThan(0);
  });
});
