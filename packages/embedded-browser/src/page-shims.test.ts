/**
 * Guards the fix for "Recorder is completely broken under the process
 * provisioner — every session dies on `ReferenceError: __name is not defined`".
 *
 * The failure is a bundler/serialisation interaction, so the test reproduces
 * both halves separately:
 *   - the shim semantics, in a bare `vm` context that models a page with no
 *     esbuild helpers in scope;
 *   - the injection order in the recorder, which is what actually regressed.
 */
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

import {
  KEEP_NAMES_SHIM_EXPRESSION,
  KEEP_NAMES_SHIM_SOURCE,
  ensureKeepNamesShim,
  installKeepNamesShim,
} from "./page-shims.js";

/**
 * What esbuild emits for `const helper = () => 1; function named() {}` when
 * `keepNames` is on — verified against the real tsx transform, which hard-codes
 * `keepNames: true`.
 */
const KEEP_NAMES_OUTPUT = `
  (() => {
    const helper = __name(() => 1, "helper");
    function named() { return helper(); }
    __name(named, "named");
    return named();
  })()
`;

describe("keepNames shim", () => {
  it("a keepNames-rewritten script throws in a page without the shim", () => {
    const context = vm.createContext({});
    expect(() => vm.runInContext(KEEP_NAMES_OUTPUT, context)).toThrow(
      /__name is not defined/,
    );
  });

  it("runs that same script once the shim is installed", () => {
    const context = vm.createContext({});
    vm.runInContext(KEEP_NAMES_SHIM_SOURCE, context);
    expect(vm.runInContext(KEEP_NAMES_OUTPUT, context)).toBe(1);
  });

  it("preserves function identity — it is an identity function, not a wrapper", () => {
    const context = vm.createContext({});
    vm.runInContext(KEEP_NAMES_SHIM_SOURCE, context);
    expect(
      vm.runInContext(
        `(() => { const f = () => 7; return __name(f, "f") === f; })()`,
        context,
      ),
    ).toBe(true);
  });

  it("is idempotent and never clobbers an existing __name", () => {
    const context = vm.createContext({});
    vm.runInContext(
      `globalThis.__name = function real(fn) { return fn; };`,
      context,
    );
    const before = vm.runInContext(`globalThis.__name.name`, context);
    vm.runInContext(KEEP_NAMES_SHIM_SOURCE, context);
    vm.runInContext(KEEP_NAMES_SHIM_SOURCE, context);
    expect(vm.runInContext(`globalThis.__name.name`, context)).toBe(before);
  });

  it("the evaluate form completes with undefined", () => {
    // page.evaluate() has to serialise the completion value; returning the shim
    // function itself would fail that.
    const context = vm.createContext({});
    expect(
      vm.runInContext(KEEP_NAMES_SHIM_EXPRESSION, context),
    ).toBeUndefined();
  });

  it("is injected as a string, so no bundler can rewrite the shim itself", () => {
    expect(typeof KEEP_NAMES_SHIM_SOURCE).toBe("string");
    expect(KEEP_NAMES_SHIM_SOURCE).not.toContain("__name(");
  });
});

describe("installKeepNamesShim", () => {
  it("registers a context-level init script by content, not as a function", async () => {
    const addInitScript = vi.fn().mockResolvedValue(undefined);
    const context = { addInitScript } as never;

    await installKeepNamesShim(context);

    expect(addInitScript).toHaveBeenCalledTimes(1);
    expect(addInitScript).toHaveBeenCalledWith({
      content: KEEP_NAMES_SHIM_SOURCE,
    });
  });

  it("does not stack duplicate init scripts on repeat calls", async () => {
    const addInitScript = vi.fn().mockResolvedValue(undefined);
    const context = { addInitScript } as never;

    await installKeepNamesShim(context);
    await installKeepNamesShim(context);
    await installKeepNamesShim(context);

    expect(addInitScript).toHaveBeenCalledTimes(1);
  });

  it("retries on a later call if registration failed", async () => {
    const addInitScript = vi
      .fn()
      .mockRejectedValueOnce(new Error("context closed"))
      .mockResolvedValue(undefined);
    const context = { addInitScript } as never;

    await expect(installKeepNamesShim(context)).rejects.toThrow(
      "context closed",
    );
    await installKeepNamesShim(context);
    expect(addInitScript).toHaveBeenCalledTimes(2);
  });
});

describe("ensureKeepNamesShim", () => {
  it("covers the current document as well as future ones", async () => {
    const addInitScript = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi.fn().mockResolvedValue(undefined);
    const page = {
      context: () => ({ addInitScript }) as never,
      evaluate,
    } as never;

    await ensureKeepNamesShim(page);

    expect(addInitScript).toHaveBeenCalledWith({
      content: KEEP_NAMES_SHIM_SOURCE,
    });
    // A string expression — passing a function here would defeat the purpose.
    expect(evaluate).toHaveBeenCalledWith(KEEP_NAMES_SHIM_EXPRESSION);
  });

  it("tolerates a failed current-document evaluate", async () => {
    const addInitScript = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi
      .fn()
      .mockRejectedValue(new Error("Execution context was destroyed"));
    const page = {
      context: () => ({ addInitScript }) as never,
      evaluate,
    } as never;

    // The init script still covers the next document, so a mid-navigation page
    // must not fail the caller.
    await expect(ensureKeepNamesShim(page)).resolves.toBeUndefined();
  });
});
