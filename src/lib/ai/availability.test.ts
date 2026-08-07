import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  hostClaudeCliUnavailable,
  agentSdkReadiness,
  defaultAiProvider,
  checkAiConfigReadiness,
  isByokConfigured,
  AI_NOT_CONFIGURED_MESSAGE,
  AGENT_SDK_NO_CREDENTIALS_MESSAGE,
  CLAUDE_CLI_UNAVAILABLE_MESSAGE,
} from "./availability";

const ENV_KEY = "AI_HOST_CLI_DISABLED";
const CRED_KEYS = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"] as const;

/** Snapshot + restore every env var this module reads. */
function useCleanAiEnv() {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [ENV_KEY, ...CRED_KEYS]) {
      original[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

describe("hostClaudeCliUnavailable", () => {
  useCleanAiEnv();

  it("is false when the env flag is unset", () => {
    expect(hostClaudeCliUnavailable()).toBe(false);
  });

  it.each(["1", "true", "TRUE", " true "])(
    "is true for flag value %j",
    (value) => {
      process.env[ENV_KEY] = value;
      expect(hostClaudeCliUnavailable()).toBe(true);
    },
  );

  it.each(["0", "false", ""])("is false for flag value %j", (value) => {
    process.env[ENV_KEY] = value;
    expect(hostClaudeCliUnavailable()).toBe(false);
  });
});

describe("agentSdkReadiness", () => {
  useCleanAiEnv();

  it("is runnable on developer machines, where `claude login` supplies credentials", () => {
    expect(agentSdkReadiness()).toEqual({ runnable: true });
  });

  it.each(CRED_KEYS)(
    "is runnable on headless deployments with %s set",
    (key) => {
      process.env[ENV_KEY] = "1";
      process.env[key] = "test-credential";
      expect(agentSdkReadiness()).toEqual({ runnable: true });
    },
  );

  it("is not runnable on headless deployments with no ambient credentials", () => {
    process.env[ENV_KEY] = "1";
    const result = agentSdkReadiness();
    expect(result.runnable).toBe(false);
    if (!result.runnable) {
      expect(result.reason).toBe(AGENT_SDK_NO_CREDENTIALS_MESSAGE);
      expect(result.reason).toContain("ANTHROPIC_API_KEY");
    }
  });
});

describe("defaultAiProvider", () => {
  useCleanAiEnv();

  it("defaults to claude-agent-sdk wherever the SDK can run", () => {
    expect(defaultAiProvider(true)).toBe("claude-agent-sdk");
  });

  it("falls back to an API-key provider when the SDK cannot run", () => {
    const provider = defaultAiProvider(false);
    expect(provider).not.toBe("claude-agent-sdk");
    expect(provider).not.toBe("claude-cli");
    expect(provider).toBe("anthropic");
  });

  it("reads SDK readiness from the env when not given explicitly", () => {
    process.env[ENV_KEY] = "1";
    expect(defaultAiProvider()).toBe("anthropic");
    process.env.ANTHROPIC_API_KEY = "sk-test";
    expect(defaultAiProvider()).toBe("claude-agent-sdk");
  });
});

describe("checkAiConfigReadiness", () => {
  useCleanAiEnv();

  it("treats both Claude providers as runnable on developer machines", () => {
    expect(checkAiConfigReadiness({ provider: "claude-agent-sdk" })).toEqual({
      runnable: true,
    });
    expect(checkAiConfigReadiness({ provider: "claude-cli" })).toEqual({
      runnable: true,
    });
  });

  it("marks claude-cli as not runnable when no claude binary ships", () => {
    process.env[ENV_KEY] = "1";
    const result = checkAiConfigReadiness({ provider: "claude-cli" });
    expect(result.runnable).toBe(false);
    if (!result.runnable) {
      expect(result.reason).toBe(CLAUDE_CLI_UNAVAILABLE_MESSAGE);
      expect(result.reason).toContain("AI_HOST_CLI_DISABLED");
    }
  });

  it("keeps claude-agent-sdk runnable without the CLI as long as credentials exist", () => {
    process.env[ENV_KEY] = "1";
    process.env.ANTHROPIC_API_KEY = "sk-test";
    expect(checkAiConfigReadiness({ provider: "claude-agent-sdk" })).toEqual({
      runnable: true,
    });
  });

  it.each([
    ["openrouter", "openrouterApiKey"],
    ["anthropic", "anthropicApiKey"],
    ["openai", "openaiApiKey"],
  ] as const)("%s is runnable only with an API key", (provider, keyField) => {
    expect(
      checkAiConfigReadiness({ provider, [keyField]: null }).runnable,
    ).toBe(false);
    expect(
      checkAiConfigReadiness({ provider, [keyField]: "sk-test" }).runnable,
    ).toBe(true);
  });

  it("returns the not-configured message for an API-key provider without a key", () => {
    const result = checkAiConfigReadiness({
      provider: "anthropic",
      anthropicApiKey: null,
    });
    expect(result.runnable).toBe(false);
    if (!result.runnable) {
      expect(result.reason).toBe(AI_NOT_CONFIGURED_MESSAGE);
    }
  });

  it("requires an ollama model", () => {
    expect(
      checkAiConfigReadiness({ provider: "ollama", ollamaModel: "" }).runnable,
    ).toBe(false);
    expect(
      checkAiConfigReadiness({
        provider: "ollama",
        ollamaModel: "llama3",
        ollamaBaseUrl: null,
      }).runnable,
    ).toBe(true);
  });

  it("marks unknown providers as not runnable", () => {
    expect(checkAiConfigReadiness({ provider: "none" }).runnable).toBe(false);
    expect(checkAiConfigReadiness({ provider: "" }).runnable).toBe(false);
  });
});

describe("isByokConfigured", () => {
  useCleanAiEnv();

  it("is false without a persisted row", () => {
    expect(isByokConfigured(null)).toBe(false);
    expect(isByokConfigured(undefined)).toBe(false);
    expect(
      isByokConfigured({
        id: "",
        provider: "anthropic",
        anthropicApiKey: "sk-test",
        openrouterApiKey: null,
        openaiApiKey: null,
        ollamaBaseUrl: null,
        ollamaModel: null,
      }),
    ).toBe(false);
  });

  it("is true for a saved row whose provider can run", () => {
    expect(
      isByokConfigured({
        id: "row",
        provider: "anthropic",
        anthropicApiKey: "sk-test",
        openrouterApiKey: null,
        openaiApiKey: null,
        ollamaBaseUrl: null,
        ollamaModel: null,
      }),
    ).toBe(true);
  });

  it("rejects a saved Agent SDK row on a deployment with no credentials for it", () => {
    process.env[ENV_KEY] = "1";
    expect(
      isByokConfigured({
        id: "row",
        provider: "claude-agent-sdk",
        openrouterApiKey: null,
        anthropicApiKey: null,
        openaiApiKey: null,
        ollamaBaseUrl: null,
        ollamaModel: null,
      }),
    ).toBe(false);
  });
});
