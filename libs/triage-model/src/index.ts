/**
 * `@lastest/triage-model` — the pure half of the Triage agent.
 *
 * Value types (the verdict vocabulary, group kinds, group evidence) and the
 * deterministic clustering pre-pass that runs before the LLM refines it.
 * Everything is a function of its arguments: no database, no storage, no
 * clock, no AI client.
 *
 * The stateful half (orchestration, persistence, the agent-session lifecycle,
 * the LLM calls, the build-completion hook) lives in `src/lib/triage`.
 */

export * from "./types";
export * from "./cluster";
export * from "./assess";
