import { describe, it, expect } from "vitest";
import {
  deriveFlowState,
  canAdvance,
  canLaunch,
  STAGE_DEFINITIONS,
  type FlowInput,
  type FlowRun,
} from "./stages";

const WAVE = {
  id: "w1",
  status: "in_progress" as const,
  countries: ["US"],
  freezeAt: null as Date | null,
};

function input(over: Partial<FlowInput> = {}): FlowInput {
  return {
    hasSource: true,
    hasTarget: true,
    wave: { ...WAVE },
    runs: [],
    planned: true,
    ...over,
  };
}

function run(over: Partial<FlowRun> = {}): FlowRun {
  return {
    id: "r1",
    mode: "preflight",
    status: "succeeded",
    dryRun: false,
    waveId: "w1",
    startedAt: new Date("2026-09-09T12:00:00Z"),
    ...over,
  };
}

const statusOf = (state: ReturnType<typeof deriveFlowState>, key: string) =>
  state.stages.find((s) => s.key === key)!.status;

describe("deriveFlowState", () => {
  it("returns one entry per stage, in definition order", () => {
    const state = deriveFlowState(input());
    expect(state.stages.map((s) => s.key)).toEqual(
      STAGE_DEFINITIONS.map((s) => s.key),
    );
  });

  it("locks everything past Connect until both ends exist", () => {
    const state = deriveFlowState(input({ hasTarget: false }));
    expect(statusOf(state, "connect")).toBe("ready");
    expect(statusOf(state, "plan")).toBe("locked");
    expect(state.stages.find((s) => s.key === "plan")!.blockedReason).toMatch(
      /Connect a Salesforce org/,
    );
  });

  it("locks Plan when the wave has no countries", () => {
    const state = deriveFlowState(input({ wave: null }));
    expect(statusOf(state, "plan")).toBe("locked");
    expect(state.stages.find((s) => s.key === "plan")!.blockedReason).toMatch(
      /Add a wave/,
    );
  });

  it("opens Preflight once a plan exists", () => {
    const state = deriveFlowState(input());
    expect(statusOf(state, "plan")).toBe("done");
    expect(statusOf(state, "preflight")).toBe("ready");
    expect(statusOf(state, "initial")).toBe("locked");
  });

  it("does NOT count a preflight with blocking findings as done", () => {
    const state = deriveFlowState(
      input({ runs: [run({ blockingFindings: 2 })] }),
    );
    // Exit code 2. The run finished; the migration did not advance.
    expect(statusOf(state, "preflight")).toBe("attention");
    expect(statusOf(state, "initial")).toBe("locked");
  });

  it("unlocks the load once preflight passes clean", () => {
    const state = deriveFlowState(
      input({ runs: [run({ blockingFindings: 0 })] }),
    );
    expect(statusOf(state, "preflight")).toBe("done");
    expect(statusOf(state, "dryrun")).toBe("ready");
    expect(statusOf(state, "initial")).toBe("ready");
  });

  it("treats the dry run as optional — Initial does not wait for it", () => {
    const state = deriveFlowState(
      input({ runs: [run({ blockingFindings: 0 })] }),
    );
    expect(statusOf(state, "dryrun")).toBe("ready");
    expect(statusOf(state, "initial")).toBe("ready");
  });

  it("separates the dry run from the real init by `dryRun`", () => {
    const state = deriveFlowState(
      input({
        runs: [
          run({ id: "dry", mode: "init", dryRun: true }),
          run({ id: "pf", blockingFindings: 0 }),
        ],
      }),
    );
    expect(statusOf(state, "dryrun")).toBe("done");
    // The dry run must never make the real load look done.
    expect(statusOf(state, "initial")).toBe("ready");
  });

  it("unlocks Delta and Verify after the initial load", () => {
    const state = deriveFlowState(
      input({
        runs: [
          run({ id: "init", mode: "init" }),
          run({ id: "pf", blockingFindings: 0 }),
        ],
      }),
    );
    expect(statusOf(state, "initial")).toBe("done");
    expect(statusOf(state, "delta")).toBe("ready");
    expect(statusOf(state, "verify")).toBe("ready");
  });

  it("keeps Cutover locked until the freeze timestamp is recorded", () => {
    const runs = [
      run({ id: "init", mode: "init" }),
      run({ id: "pf", blockingFindings: 0 }),
    ];
    const unfrozen = deriveFlowState(input({ runs }));
    expect(statusOf(unfrozen, "cutover")).toBe("locked");
    expect(
      unfrozen.stages.find((s) => s.key === "cutover")!.blockedReason,
    ).toMatch(/freeze timestamp/);

    const frozen = deriveFlowState(
      input({ runs, wave: { ...WAVE, freezeAt: new Date() } }),
    );
    expect(statusOf(frozen, "cutover")).toBe("ready");
  });

  it("does NOT count a cutover whose gate failed as done", () => {
    const state = deriveFlowState(
      input({
        wave: { ...WAVE, freezeAt: new Date() },
        runs: [
          run({ id: "fd", mode: "final-delta", gate: "fail" }),
          run({ id: "init", mode: "init" }),
          run({ id: "pf", blockingFindings: 0 }),
        ],
      }),
    );
    expect(statusOf(state, "cutover")).toBe("attention");
    expect(statusOf(state, "signoff")).toBe("locked");
  });

  it("opens Sign-off only after both the gate and verify pass", () => {
    const base = [
      run({ id: "fd", mode: "final-delta", gate: "pass" }),
      run({ id: "init", mode: "init" }),
      run({ id: "pf", blockingFindings: 0 }),
    ];
    const noVerify = deriveFlowState(
      input({ wave: { ...WAVE, freezeAt: new Date() }, runs: base }),
    );
    expect(statusOf(noVerify, "signoff")).toBe("locked");
    expect(
      noVerify.stages.find((s) => s.key === "signoff")!.blockedReason,
    ).toMatch(/verify/i);

    const withVerify = deriveFlowState(
      input({
        wave: { ...WAVE, freezeAt: new Date() },
        runs: [run({ id: "v", mode: "verify" }), ...base],
      }),
    );
    expect(statusOf(withVerify, "signoff")).toBe("ready");
  });

  it("marks Sign-off done for a signed-off wave", () => {
    const state = deriveFlowState(
      input({ wave: { ...WAVE, status: "signed_off", freezeAt: new Date() } }),
    );
    expect(statusOf(state, "signoff")).toBe("done");
  });

  it("shows a stage as running while its run is queued or in flight", () => {
    for (const status of ["queued", "running"] as const) {
      const state = deriveFlowState(input({ runs: [run({ status })] }));
      expect(statusOf(state, "preflight")).toBe("running");
    }
  });

  it("uses the newest run of a stage, not the first match", () => {
    const state = deriveFlowState(
      input({
        // `runs` arrives newest first from the query layer.
        runs: [run({ id: "new", status: "failed" }), run({ id: "old" })],
      }),
    );
    expect(statusOf(state, "preflight")).toBe("attention");
    expect(state.stages.find((s) => s.key === "preflight")!.lastRunId).toBe(
      "new",
    );
  });

  it("opens on the first stage that is not done", () => {
    expect(deriveFlowState(input({ hasSource: false })).activeStage).toBe(
      "connect",
    );
    expect(deriveFlowState(input()).activeStage).toBe("preflight");
  });
});

describe("canLaunch", () => {
  const flowOf = (over: Partial<FlowInput> = {}) =>
    deriveFlowState(input(over));

  it("refuses a locked stage with its reason", () => {
    const result = canLaunch("cutover", flowOf());
    expect(result).toEqual({
      ok: false,
      reason: expect.stringMatching(/initial load/i),
    });
  });

  it("refuses a stage that is already running", () => {
    const result = canLaunch(
      "preflight",
      flowOf({ runs: [run({ status: "running" })] }),
    );
    expect(result).toEqual({
      ok: false,
      reason: expect.stringMatching(/already in flight/),
    });
  });

  it("allows a repeatable stage to run again after it passed", () => {
    const flow = flowOf({ runs: [run({ blockingFindings: 0 })] });
    expect(canLaunch("preflight", flow)).toEqual({ ok: true });
  });

  it("refuses a completed non-repeatable stage", () => {
    const flow = flowOf({
      wave: { ...WAVE, freezeAt: new Date() },
      runs: [
        run({ id: "fd", mode: "final-delta", gate: "pass" }),
        run({ id: "init", mode: "init" }),
        run({ id: "pf", blockingFindings: 0 }),
      ],
    });
    expect(canLaunch("cutover", flow)).toEqual({
      ok: false,
      reason: expect.stringMatching(/already completed/),
    });
  });

  it("refuses stages that have no run behind them", () => {
    expect(canLaunch("connect", flowOf())).toEqual({
      ok: false,
      reason: "This step has no run",
    });
  });
});

describe("canAdvance", () => {
  const flowOf = (over: Partial<FlowInput> = {}) =>
    deriveFlowState(input(over));
  const readyForSignoff = () =>
    flowOf({
      wave: { ...WAVE, freezeAt: new Date() },
      runs: [
        run({ id: "v", mode: "verify" }),
        run({ id: "fd", mode: "final-delta", gate: "pass" }),
        run({ id: "init", mode: "init" }),
        run({ id: "pf", blockingFindings: 0 }),
      ],
    });

  it("allows a stage that has no engine mode — which canLaunch cannot", () => {
    // Sign-off runs nothing; `canLaunch` refuses it for exactly that reason,
    // so the sign-off action must not be gated on `canLaunch`.
    const flow = readyForSignoff();
    expect(canLaunch("signoff", flow).ok).toBe(false);
    expect(canAdvance("signoff", flow)).toEqual({ ok: true });
  });

  it("still refuses a locked stage, with its reason", () => {
    expect(canAdvance("signoff", flowOf())).toEqual({
      ok: false,
      reason: expect.stringMatching(/reconciliation gate/),
    });
  });

  it("refuses a wave that is already signed off", () => {
    const flow = deriveFlowState(
      input({ wave: { ...WAVE, status: "signed_off", freezeAt: new Date() } }),
    );
    expect(canAdvance("signoff", flow)).toEqual({
      ok: false,
      reason: expect.stringMatching(/already completed/),
    });
  });
});
