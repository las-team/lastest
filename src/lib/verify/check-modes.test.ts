import { describe, it, expect } from "vitest";
import {
  deriveCheckModes,
  defaultCheckModes,
  checkModesToSettingsPatch,
  classifyEvidenceWithMode,
  chipToneForLayer,
  isAlwaysCaptured,
  pickTestModeOverrides,
  testModeOverridesToOverridesPatch,
  mergeWithTestOverrides,
  effectiveVerdict,
  type CheckModeMap,
} from "./check-modes";
import type { EvidenceItem } from "@/lib/db/schema";

describe("check-modes — derivation", () => {
  it("returns defaults for an empty settings row", () => {
    const modes = deriveCheckModes(null);
    expect(modes).toEqual({
      visual: "enforce",
      text: "log",
      dom: "log",
      network: "enforce",
      console: "enforce",
      a11y: "log",
      design: "disable",
      perf: "log",
      url: "log",
      api: "enforce",
      storage: "log",
    } satisfies CheckModeMap);
  });

  it("migrates legacy enableA11y=true → a11yMode=enforce", () => {
    const modes = deriveCheckModes({ enableA11y: true });
    expect(modes.a11y).toBe("enforce");
  });

  it("legacy enableA11y=false falls through to the a11y default (log)", () => {
    // Legacy boolean false is the DB default (cannot be distinguished from
    // "never explicitly set"), so a false value falls through to DEFAULTS.a11y
    // rather than locking the row to 'disable'.
    const modes = deriveCheckModes({ enableA11y: false });
    expect(modes.a11y).toBe("log");
  });

  it("migrates legacy enableDesignSystem flag", () => {
    expect(deriveCheckModes({ enableDesignSystem: true }).design).toBe(
      "enforce",
    );
    // false is the DB default → falls through to DEFAULTS.design ('disable').
    expect(deriveCheckModes({ enableDesignSystem: false }).design).toBe(
      "disable",
    );
  });

  it("migrates legacy enableDomDiff flag", () => {
    expect(deriveCheckModes({ enableDomDiff: true }).dom).toBe("enforce");
    // false is the DB default → falls through to DEFAULTS.dom ('log').
    expect(deriveCheckModes({ enableDomDiff: false }).dom).toBe("log");
  });

  it("migrates legacy textDiffEnabled flag", () => {
    expect(deriveCheckModes({ textDiffEnabled: true }).text).toBe("enforce");
    // false is the DB default → falls through to DEFAULTS.text ('log').
    expect(deriveCheckModes({ textDiffEnabled: false }).text).toBe("log");
  });

  it("collapses network capture + error mode into the network 3-way", () => {
    // capture on, fail-on-error → enforce
    expect(
      deriveCheckModes({
        enableNetworkInterception: true,
        networkErrorMode: "fail",
      }).network,
    ).toBe("enforce");
    // capture on, warn → log
    expect(
      deriveCheckModes({
        enableNetworkInterception: true,
        networkErrorMode: "warn",
      }).network,
    ).toBe("log");
    // capture off, fail → enforce
    expect(
      deriveCheckModes({
        enableNetworkInterception: false,
        networkErrorMode: "fail",
      }).network,
    ).toBe("enforce");
    // capture off, ignore → disable
    expect(
      deriveCheckModes({
        enableNetworkInterception: false,
        networkErrorMode: "ignore",
      }).network,
    ).toBe("disable");
  });

  it("maps console error mode to the console 3-way", () => {
    expect(deriveCheckModes({ consoleErrorMode: "fail" }).console).toBe(
      "enforce",
    );
    expect(deriveCheckModes({ consoleErrorMode: "warn" }).console).toBe("log");
    expect(deriveCheckModes({ consoleErrorMode: "ignore" }).console).toBe(
      "disable",
    );
  });

  it("prefers the new *Mode columns over the legacy mirror", () => {
    // legacy says enableA11y=false (disable) but a11yMode=log wins
    const modes = deriveCheckModes({ enableA11y: false, a11yMode: "log" });
    expect(modes.a11y).toBe("log");
  });
});

describe("check-modes — patch shape", () => {
  it("writes both the new column and its legacy mirror", () => {
    const patch = checkModesToSettingsPatch({ a11y: "enforce" });
    expect(patch.a11yMode).toBe("enforce");
    expect(patch.enableA11y).toBe(true);
  });

  it("disable maps to false on the legacy boolean", () => {
    const patch = checkModesToSettingsPatch({ design: "disable" });
    expect(patch.designMode).toBe("disable");
    expect(patch.enableDesignSystem).toBe(false);
  });

  it("log on network mirrors to enableNetworkInterception=true + networkErrorMode=warn", () => {
    const patch = checkModesToSettingsPatch({ network: "log" });
    expect(patch.networkMode).toBe("log");
    expect(patch.enableNetworkInterception).toBe(true);
    expect(patch.networkErrorMode).toBe("warn");
  });

  it("disable on network mirrors to capture=false + networkErrorMode=ignore", () => {
    const patch = checkModesToSettingsPatch({ network: "disable" });
    expect(patch.enableNetworkInterception).toBe(false);
    expect(patch.networkErrorMode).toBe("ignore");
  });

  it("text mode mirrors to textDiffEnabled on diff_sensitivity_settings", () => {
    expect(checkModesToSettingsPatch({ text: "enforce" }).textDiffEnabled).toBe(
      true,
    );
    expect(checkModesToSettingsPatch({ text: "log" }).textDiffEnabled).toBe(
      true,
    );
    expect(checkModesToSettingsPatch({ text: "disable" }).textDiffEnabled).toBe(
      false,
    );
  });

  it("round-trips defaults through patch + derive", () => {
    const patch = checkModesToSettingsPatch(defaultCheckModes());
    const rederived = deriveCheckModes({
      visualMode: patch.visualMode,
      textMode: patch.textMode,
      domMode: patch.domMode,
      networkMode: patch.networkMode,
      consoleMode: patch.consoleMode,
      a11yMode: patch.a11yMode,
      designMode: patch.designMode,
      perfMode: patch.perfMode,
      urlMode: patch.urlMode,
      apiMode: patch.apiMode,
    });
    expect(rederived).toEqual(defaultCheckModes());
  });

  it("round-trips the api layer mode", () => {
    expect(checkModesToSettingsPatch({ api: "log" }).apiMode).toBe("log");
    expect(deriveCheckModes({ apiMode: "disable" }).api).toBe("disable");
    // No stored apiMode → falls back to the enforce default.
    expect(deriveCheckModes({}).api).toBe("enforce");
  });

  it("does not emit fields for layers that were not selected", () => {
    const patch = checkModesToSettingsPatch({ a11y: "log" });
    expect(patch.designMode).toBeUndefined();
    expect(patch.networkMode).toBeUndefined();
  });
});

describe("check-modes — classification", () => {
  it("disable suppresses any signal", () => {
    expect(classifyEvidenceWithMode("disable", "high")).toBe("clean");
    expect(classifyEvidenceWithMode("disable", "medium")).toBe("clean");
  });

  it("enforce on high signal → broken", () => {
    expect(classifyEvidenceWithMode("enforce", "high")).toBe("broken");
  });

  it("log on high signal → warned (never fails)", () => {
    expect(classifyEvidenceWithMode("log", "high")).toBe("warned");
  });

  it("only high signals escalate beyond clean", () => {
    expect(classifyEvidenceWithMode("enforce", "medium")).toBe("clean");
    expect(classifyEvidenceWithMode("log", "low")).toBe("clean");
    expect(classifyEvidenceWithMode("enforce", null)).toBe("clean");
  });
});

describe("check-modes — per-layer round-trip", () => {
  // Exhaustive table: every (layer, mode) combination, write via
  // checkModesToSettingsPatch, simulate a settings row by re-applying the
  // patch onto a blank PlaywrightSettings-ish, and assert deriveCheckModes
  // returns the same mode back. Catches mirror drift for any layer.
  const layers = [
    "visual",
    "text",
    "dom",
    "network",
    "console",
    "a11y",
    "design",
    "perf",
    "url",
  ] as const;
  const modes = ["enforce", "log", "disable"] as const;

  for (const layer of layers) {
    for (const mode of modes) {
      it(`${layer} = ${mode} survives a patch → derive round-trip`, () => {
        const patch = checkModesToSettingsPatch({ [layer]: mode });
        const derived = deriveCheckModes({
          // mode columns
          visualMode: patch.visualMode,
          textMode: patch.textMode,
          domMode: patch.domMode,
          networkMode: patch.networkMode,
          consoleMode: patch.consoleMode,
          a11yMode: patch.a11yMode,
          designMode: patch.designMode,
          perfMode: patch.perfMode,
          urlMode: patch.urlMode,
          // legacy mirrors — included so the test asserts that the new column
          // wins even when the legacy mirror has been written too.
          enableA11y: patch.enableA11y,
          enableDesignSystem: patch.enableDesignSystem,
          enableDomDiff: patch.enableDomDiff,
          enableNetworkInterception: patch.enableNetworkInterception,
          networkErrorMode: patch.networkErrorMode,
          consoleErrorMode: patch.consoleErrorMode,
          textDiffEnabled: patch.textDiffEnabled,
        });
        expect(derived[layer]).toBe(mode);
      });
    }
  }
});

describe("check-modes — executor gating", () => {
  // The executor gates `enableA11y` / `enableNetworkInterception` /
  // `enableDesignSystem` on `mode !== 'disable'`. Verify the implied flow
  // for each of the 9 layers, mirroring the per-test override path.
  const checkRunnerGate = (
    layer: "a11y" | "design" | "dom" | "network" | "console" | "text",
    mode: "enforce" | "log" | "disable",
  ) => {
    const modes = { ...defaultCheckModes(), [layer]: mode };
    return modes[layer] !== "disable";
  };

  it("enforce + log enable the runner capture for opt-in layers", () => {
    for (const layer of [
      "a11y",
      "design",
      "dom",
      "network",
      "console",
      "text",
    ] as const) {
      expect(checkRunnerGate(layer, "enforce")).toBe(true);
      expect(checkRunnerGate(layer, "log")).toBe(true);
      expect(checkRunnerGate(layer, "disable")).toBe(false);
    }
  });

  it("log on console/network downgrades the runner verdict to warn (not fail)", () => {
    // Patch's networkErrorMode/consoleErrorMode is what the executor forwards
    // to the EB. `log` → 'warn', `disable` → 'ignore', `enforce` → 'fail'.
    expect(checkModesToSettingsPatch({ network: "log" }).networkErrorMode).toBe(
      "warn",
    );
    expect(checkModesToSettingsPatch({ console: "log" }).consoleErrorMode).toBe(
      "warn",
    );
    expect(
      checkModesToSettingsPatch({ network: "disable" }).networkErrorMode,
    ).toBe("ignore");
    expect(
      checkModesToSettingsPatch({ console: "enforce" }).consoleErrorMode,
    ).toBe("fail");
  });
});

describe("check-modes — board chip tone", () => {
  it("enforce + high signal → regression (red)", () => {
    expect(chipToneForLayer("enforce", "high")).toBe("regression");
  });

  it("log + high signal → missed (amber, never red)", () => {
    expect(chipToneForLayer("log", "high")).toBe("missed");
  });

  it("enforce + medium signal stays amber (not red)", () => {
    // Medium signals are advisory regardless of mode — board card keeps
    // them as `missed` so they read as "needs eyes" without overpowering
    // the layer-set-to-Enforce-high signals on the same card.
    expect(chipToneForLayer("enforce", "medium")).toBe("missed");
    expect(chipToneForLayer("log", "medium")).toBe("missed");
  });

  it("disable + any signal → unknown (muted chip)", () => {
    expect(chipToneForLayer("disable", "high")).toBe("unknown");
    expect(chipToneForLayer("disable", "medium")).toBe("unknown");
    expect(chipToneForLayer("disable", "low")).toBe("unknown");
    expect(chipToneForLayer("disable", null)).toBe("unknown");
  });

  it("low signal / no signal → done (green) when not disabled", () => {
    expect(chipToneForLayer("enforce", "low")).toBe("done");
    expect(chipToneForLayer("log", "low")).toBe("done");
    expect(chipToneForLayer("enforce", null)).toBe("done");
    expect(chipToneForLayer("log", undefined)).toBe("done");
  });

  it("mirrors the focus toolbar classification for high signals", () => {
    // classifyEvidenceWithMode returns broken/warned/clean; chipToneForLayer
    // returns regression/missed/done. They must agree on the broken-vs-
    // warned-vs-clean axis for high signals or the two surfaces drift.
    const layerMap = {
      broken: "regression",
      warned: "missed",
      clean: "done",
    } as const;
    for (const mode of ["enforce", "log", "disable"] as const) {
      const focus = classifyEvidenceWithMode(mode, "high");
      const board = chipToneForLayer(mode, "high");
      if (mode === "disable") {
        // disable is special-cased on the board (drops to unknown) but
        // classifies as `clean` in the focus toolbar — both surfaces hide
        // the chip / pill so the meaning matches.
        expect(focus).toBe("clean");
        expect(board).toBe("unknown");
      } else {
        expect(board).toBe(layerMap[focus]);
      }
    }
  });
});

describe("check-modes — per-test overrides", () => {
  it("returns null for an empty / null override row", () => {
    expect(pickTestModeOverrides(null)).toBeNull();
    expect(pickTestModeOverrides(undefined)).toBeNull();
    expect(pickTestModeOverrides({})).toBeNull();
  });

  it("extracts only the layers the test touches", () => {
    const out = pickTestModeOverrides({
      a11yMode: "log",
      designMode: "enforce",
    });
    expect(out).toEqual({ a11y: "log", design: "enforce" });
  });

  it("falls back to legacy networkErrorMode when networkMode is unset", () => {
    expect(pickTestModeOverrides({ networkErrorMode: "warn" })).toEqual({
      network: "log",
    });
    expect(pickTestModeOverrides({ consoleErrorMode: "ignore" })).toEqual({
      console: "disable",
    });
  });

  it("new networkMode wins over legacy networkErrorMode", () => {
    const out = pickTestModeOverrides({
      networkMode: "log",
      networkErrorMode: "fail",
    });
    expect(out).toEqual({ network: "log" });
  });

  it("ignores unknown mode strings", () => {
    // Feeding an invalid mode at runtime — the parser drops it and returns null.
    expect(
      pickTestModeOverrides({ a11yMode: "notamode" } as Record<
        string,
        unknown
      >),
    ).toBeNull();
  });

  it("mergeWithTestOverrides: per-test wins, repo fills the gap", () => {
    const repo = defaultCheckModes();
    const perTest = { a11y: "enforce", network: "disable" } as const;
    const merged = mergeWithTestOverrides(repo, perTest);
    expect(merged.a11y).toBe("enforce");
    expect(merged.network).toBe("disable");
    // layers the test didn't touch fall through
    expect(merged.console).toBe(repo.console);
    expect(merged.visual).toBe(repo.visual);
  });

  it("mergeWithTestOverrides: null perTest returns repo as-is", () => {
    const repo = defaultCheckModes();
    expect(mergeWithTestOverrides(repo, null)).toEqual(repo);
    expect(mergeWithTestOverrides(repo, undefined)).toEqual(repo);
  });

  it("testModeOverridesToOverridesPatch: writes only touched layers", () => {
    const patch = testModeOverridesToOverridesPatch({ a11y: "log" });
    expect(patch.a11yMode).toBe("log");
    expect(patch.networkMode).toBeUndefined();
    expect(patch.designMode).toBeUndefined();
  });

  it("testModeOverridesToOverridesPatch: mirrors network/console onto legacy *ErrorMode", () => {
    expect(testModeOverridesToOverridesPatch({ network: "log" })).toEqual({
      networkMode: "log",
      networkErrorMode: "warn",
    });
    expect(testModeOverridesToOverridesPatch({ console: "disable" })).toEqual({
      consoleMode: "disable",
      consoleErrorMode: "ignore",
    });
  });

  it("per-layer round-trip via pickTestModeOverrides + testModeOverridesToOverridesPatch", () => {
    const layers = [
      "visual",
      "text",
      "dom",
      "network",
      "console",
      "a11y",
      "design",
      "perf",
      "url",
    ] as const;
    const modes = ["enforce", "log", "disable"] as const;
    for (const layer of layers) {
      for (const mode of modes) {
        const patch = testModeOverridesToOverridesPatch({ [layer]: mode });
        const picked = pickTestModeOverrides(patch);
        expect(picked).not.toBeNull();
        expect(picked![layer]).toBe(mode);
      }
    }
  });
});

describe("check-modes — capture invariants", () => {
  it("visual / url / perf are always-captured layers", () => {
    expect(isAlwaysCaptured("visual")).toBe(true);
    expect(isAlwaysCaptured("url")).toBe(true);
    expect(isAlwaysCaptured("perf")).toBe(true);
  });

  it("opt-in layers (a11y, design, dom, text, network) are not always-captured", () => {
    expect(isAlwaysCaptured("a11y")).toBe(false);
    expect(isAlwaysCaptured("design")).toBe(false);
    expect(isAlwaysCaptured("dom")).toBe(false);
    expect(isAlwaysCaptured("text")).toBe(false);
    expect(isAlwaysCaptured("network")).toBe(false);
  });
});

describe("check-modes — effectiveVerdict (mode-aware roll-up)", () => {
  const ev = (
    layer: EvidenceItem["layer"],
    signal: EvidenceItem["signal"],
  ): EvidenceItem => ({ layer, signal, summary: "" });

  it("no evidence → green", () => {
    expect(effectiveVerdict([], defaultCheckModes())).toBe("green");
    expect(effectiveVerdict(null, defaultCheckModes())).toBe("green");
  });

  it("high-signal layer in enforce → red", () => {
    const modes = { ...defaultCheckModes(), network: "enforce" as const };
    expect(effectiveVerdict([ev("network", "high")], modes)).toBe("red");
  });

  it("high-signal layer in log → yellow, not red (the Broken-without-red bug)", () => {
    // perf defaults to `log`; a newly-breached budget scores high-signal.
    const modes = { ...defaultCheckModes(), perf: "log" as const };
    expect(effectiveVerdict([ev("perf", "high")], modes)).toBe("yellow");
  });

  it("high-signal layer in disable → ignored (green)", () => {
    const modes = { ...defaultCheckModes(), network: "disable" as const };
    expect(effectiveVerdict([ev("network", "high")], modes)).toBe("green");
  });

  it("medium-signal → yellow regardless of enforce/log", () => {
    expect(
      effectiveVerdict([ev("visual", "medium")], defaultCheckModes()),
    ).toBe("yellow");
  });

  it("low-signal → green", () => {
    const modes = { ...defaultCheckModes(), network: "enforce" as const };
    expect(effectiveVerdict([ev("network", "low")], modes)).toBe("green");
  });

  it("red dominates yellow when both present", () => {
    const modes = {
      ...defaultCheckModes(),
      console: "enforce" as const,
      perf: "log" as const,
    };
    expect(
      effectiveVerdict([ev("perf", "high"), ev("console", "high")], modes),
    ).toBe("red");
  });

  it("variable layer has no mode → treated as enforce (high → red)", () => {
    expect(
      effectiveVerdict([ev("variable", "high")], defaultCheckModes()),
    ).toBe("red");
  });

  it("matches chipToneForLayer: red iff some chip is regression", () => {
    // perf log-high renders amber chip → no regression chip → not red.
    const modes = { ...defaultCheckModes(), perf: "log" as const };
    expect(chipToneForLayer(modes.perf, "high")).toBe("missed");
    expect(effectiveVerdict([ev("perf", "high")], modes)).not.toBe("red");
  });
});
