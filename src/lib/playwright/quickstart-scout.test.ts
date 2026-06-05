import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/ai", () => ({
  generateWithAI: vi.fn(),
}));

vi.mock("@/lib/db/queries", () => ({
  getAISettings: vi.fn(async () => ({
    provider: "anthropic-direct",
    anthropicApiKey: "k",
    anthropicModel: "claude",
    openrouterApiKey: null,
    openrouterModel: null,
    openaiApiKey: null,
    openaiModel: null,
    customInstructions: null,
    agentSdkPermissionMode: null,
    agentSdkModel: null,
    agentSdkWorkingDir: null,
  })),
}));

vi.mock("./agent-context", () => ({
  getAIConfig: (s: unknown) => s,
}));

import { generateWithAI } from "@/lib/ai";
import { runQuickstartScoutPublic } from "./quickstart-scout";

const mockGen = generateWithAI as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockGen.mockReset();
});

const HAPPY_JSON = JSON.stringify({
  tagline: "Roadmaps for product teams.",
  concept: "Featurely is a roadmap and feedback tool for product teams.",
  navLinks: [
    { path: "/features", label: "Features" },
    { path: "/pricing", label: "Pricing" },
  ],
  registerPath: "/sign-up",
  classification: "email_password",
  authAutomatable: true,
  friction: [],
});

describe("runQuickstartScoutPublic — happy path", () => {
  it("returns the classification from valid JSON on the first try", async () => {
    mockGen.mockResolvedValueOnce(HAPPY_JSON);

    const { data } = await runQuickstartScoutPublic(
      "repo-1",
      "https://www.featurely.no",
    );

    expect(data.classification).toBe("email_password");
    expect(data.authAutomatable).toBe(true);
    expect(data.registerPath).toBe("/sign-up");
    expect(data.navLinks).toHaveLength(2);
    expect(mockGen).toHaveBeenCalledTimes(1);
  });
});

describe("runQuickstartScoutPublic — retry on non-JSON", () => {
  it("retries once when the first response is prose, then succeeds", async () => {
    mockGen
      .mockResolvedValueOnce(
        "The browser seems locked. Let me try to kill any stale browser processes and retry.",
      )
      .mockResolvedValueOnce(HAPPY_JSON);

    const { data } = await runQuickstartScoutPublic(
      "repo-1",
      "https://www.featurely.no",
    );

    expect(data.classification).toBe("email_password");
    expect(mockGen).toHaveBeenCalledTimes(2);
    // Retry prompt must include the explicit JSON-only reminder.
    const retryPrompt = mockGen.mock.calls[1][1] as string;
    expect(retryPrompt).toMatch(/previous response was not valid JSON/i);
  });

  it("throws when both attempts return non-JSON", async () => {
    mockGen
      .mockResolvedValueOnce("Browser locked.")
      .mockResolvedValueOnce("Still locked, sorry.");

    await expect(
      runQuickstartScoutPublic("repo-1", "https://example.com"),
    ).rejects.toThrow(/non-JSON on both attempts/i);
    expect(mockGen).toHaveBeenCalledTimes(2);
  });
});

describe("runQuickstartScoutPublic — validation gate downgrades empty no_public_register", () => {
  it("treats classification:no_public_register + empty content as unknown", async () => {
    mockGen.mockResolvedValueOnce(
      JSON.stringify({
        classification: "no_public_register",
        authAutomatable: false,
        navLinks: [],
        tagline: "",
        concept: "",
      }),
    );

    const { data } = await runQuickstartScoutPublic(
      "repo-1",
      "https://example.com",
    );

    expect(data.classification).toBe("unknown");
    expect(data.authAutomatable).toBe(false);
    expect(mockGen).toHaveBeenCalledTimes(1);
  });

  it("keeps no_public_register when the scout produced real content", async () => {
    mockGen.mockResolvedValueOnce(
      JSON.stringify({
        classification: "no_public_register",
        authAutomatable: false,
        navLinks: [{ path: "/about", label: "About" }],
        tagline: "A brochure site",
        concept: "A static marketing page with no signup.",
      }),
    );

    const { data } = await runQuickstartScoutPublic(
      "repo-1",
      "https://example.com",
    );

    expect(data.classification).toBe("no_public_register");
    expect(data.tagline).toBe("A brochure site");
  });
});

describe("runQuickstartScoutPublic — classifier coercion", () => {
  it("coerces unknown-vocab classification to unknown", async () => {
    mockGen.mockResolvedValueOnce(
      JSON.stringify({
        classification: "sso_only",
        authAutomatable: false,
        navLinks: [{ path: "/", label: "Home" }],
        concept: "Some app",
      }),
    );

    const { data } = await runQuickstartScoutPublic(
      "repo-1",
      "https://example.com",
    );

    expect(data.classification).toBe("unknown");
    expect(data.authAutomatable).toBe(false);
  });

  it("honours classification:unknown returned by the model directly", async () => {
    mockGen.mockResolvedValueOnce(
      JSON.stringify({
        classification: "unknown",
        authAutomatable: false,
        navLinks: [],
      }),
    );

    const { data } = await runQuickstartScoutPublic(
      "repo-1",
      "https://example.com",
    );

    expect(data.classification).toBe("unknown");
  });
});

describe("runQuickstartScoutPublic — authAutomatable guard", () => {
  it("forces authAutomatable=false when classification is not email_password", async () => {
    mockGen.mockResolvedValueOnce(
      JSON.stringify({
        classification: "oauth_only",
        authAutomatable: true, // model lied — guard must override
        navLinks: [{ path: "/", label: "Home" }],
        concept: "OAuth-only app",
      }),
    );

    const { data } = await runQuickstartScoutPublic(
      "repo-1",
      "https://example.com",
    );

    expect(data.classification).toBe("oauth_only");
    expect(data.authAutomatable).toBe(false);
  });
});
