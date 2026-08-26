import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  AiCapability,
  AiResult,
  BrowserSession,
} from "@lastest/contracts";

import { runQuickstartScoutAuthed, runQuickstartScoutPublic } from "./scout";

const mockGenerate = vi.fn<AiCapability["generate"]>();

const ai: AiCapability = {
  generate: mockGenerate,
  budget: vi.fn(async () => ({ remainingTokens: null, enabled: true })),
};

const session = {
  id: "session-1",
  page: undefined,
  streamUrl: null,
  authApplied: false,
  extendDeadline: vi.fn(),
  isolatedPage: vi.fn(),
} as unknown as BrowserSession;

beforeEach(() => {
  mockGenerate.mockReset();
});

function aiResult(text: string): AiResult {
  return { text, inputTokens: 0, outputTokens: 0, model: "test" };
}

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

// Arbitrary test fixtures — NOT production defaults. The scout takes the ai
// capability, an already-claimed browser session, repositoryId and baseUrl as
// explicit arguments, so any non-empty values exercise the same code path.
// Factored out here so the call sites read as "scout this URL".
const REPO_ID = "repo-1";
const scout = (baseUrl = "https://www.featurely.no") =>
  runQuickstartScoutPublic(ai, session, REPO_ID, baseUrl);

describe("runQuickstartScoutPublic — happy path", () => {
  it("returns the classification from valid JSON on the first try", async () => {
    mockGenerate.mockResolvedValueOnce(aiResult(HAPPY_JSON));

    const { data } = await scout();

    expect(data.classification).toBe("email_password");
    expect(data.authAutomatable).toBe(true);
    expect(data.registerPath).toBe("/sign-up");
    expect(data.navLinks).toHaveLength(2);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    // browserTools must carry the claimed session through, never a raw endpoint.
    expect(mockGenerate.mock.calls[0][1].browserTools).toBe(session);
  });
});

describe("runQuickstartScoutPublic — tolerant JSON extraction", () => {
  it("parses JSON followed by a trailing summary sentence (no retry)", async () => {
    mockGenerate.mockResolvedValueOnce(
      aiResult(
        `${HAPPY_JSON}\n\nI have completed the reconnaissance and classified the sign-up flow as email_password.`,
      ),
    );

    const { data } = await scout();

    expect(data.classification).toBe("email_password");
    expect(data.registerPath).toBe("/sign-up");
    // The whole point: a trailing sentence must NOT cost a retry.
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it("parses JSON wrapped in leading prose + a markdown fence", async () => {
    mockGenerate.mockResolvedValueOnce(
      aiResult(
        `Here is what I found:\n\n\`\`\`json\n${HAPPY_JSON}\n\`\`\`\n\nDone.`,
      ),
    );

    const { data } = await scout();

    expect(data.classification).toBe("email_password");
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it("parses JSON preceded by prose when there is no fence", async () => {
    mockGenerate.mockResolvedValueOnce(
      aiResult(`Sure — the result is ${HAPPY_JSON}`),
    );

    const { data } = await scout();

    expect(data.classification).toBe("email_password");
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });
});

describe("runQuickstartScoutPublic — retry on non-JSON", () => {
  it("retries once when the first response is prose, then succeeds", async () => {
    mockGenerate
      .mockResolvedValueOnce(
        aiResult(
          "The browser seems locked. Let me try to kill any stale browser processes and retry.",
        ),
      )
      .mockResolvedValueOnce(aiResult(HAPPY_JSON));

    const { data } = await scout();

    expect(data.classification).toBe("email_password");
    expect(mockGenerate).toHaveBeenCalledTimes(2);
    // Retry prompt must include the explicit JSON-only reminder.
    const retryPrompt = mockGenerate.mock.calls[1][0];
    expect(retryPrompt).toMatch(/previous response was not valid JSON/i);
  });

  it("throws when both attempts return non-JSON", async () => {
    mockGenerate
      .mockResolvedValueOnce(aiResult("Browser locked."))
      .mockResolvedValueOnce(aiResult("Still locked, sorry."));

    await expect(scout("https://example.com")).rejects.toThrow(
      /non-JSON on both attempts/i,
    );
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });
});

describe("runQuickstartScoutPublic — validation gate downgrades empty no_public_register", () => {
  it("treats classification:no_public_register + empty content as unknown", async () => {
    mockGenerate.mockResolvedValueOnce(
      aiResult(
        JSON.stringify({
          classification: "no_public_register",
          authAutomatable: false,
          navLinks: [],
          tagline: "",
          concept: "",
        }),
      ),
    );

    const { data } = await scout("https://example.com");

    expect(data.classification).toBe("unknown");
    expect(data.authAutomatable).toBe(false);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it("keeps no_public_register when the scout produced real content", async () => {
    mockGenerate.mockResolvedValueOnce(
      aiResult(
        JSON.stringify({
          classification: "no_public_register",
          authAutomatable: false,
          navLinks: [{ path: "/about", label: "About" }],
          tagline: "A brochure site",
          concept: "A static marketing page with no signup.",
        }),
      ),
    );

    const { data } = await scout("https://example.com");

    expect(data.classification).toBe("no_public_register");
    expect(data.tagline).toBe("A brochure site");
  });
});

describe("runQuickstartScoutPublic — classifier coercion", () => {
  it("coerces unknown-vocab classification to unknown", async () => {
    mockGenerate.mockResolvedValueOnce(
      aiResult(
        JSON.stringify({
          classification: "sso_only",
          authAutomatable: false,
          navLinks: [{ path: "/", label: "Home" }],
          concept: "Some app",
        }),
      ),
    );

    const { data } = await scout("https://example.com");

    expect(data.classification).toBe("unknown");
    expect(data.authAutomatable).toBe(false);
  });

  it("honours classification:unknown returned by the model directly", async () => {
    mockGenerate.mockResolvedValueOnce(
      aiResult(
        JSON.stringify({
          classification: "unknown",
          authAutomatable: false,
          navLinks: [],
        }),
      ),
    );

    const { data } = await scout("https://example.com");

    expect(data.classification).toBe("unknown");
  });
});

describe("runQuickstartScoutPublic — authAutomatable guard", () => {
  it("forces authAutomatable=false when classification is not email_password", async () => {
    mockGenerate.mockResolvedValueOnce(
      aiResult(
        JSON.stringify({
          classification: "oauth_only",
          authAutomatable: true, // model lied — guard must override
          navLinks: [{ path: "/", label: "Home" }],
          concept: "OAuth-only app",
        }),
      ),
    );

    const { data } = await scout("https://example.com");

    expect(data.classification).toBe("oauth_only");
    expect(data.authAutomatable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runQuickstartScoutAuthed
//
// The authed scout has two prompt shapes, chosen by `preAuthenticated` — which
// `actions.ts` derives from `browserSession.authApplied`. That substitution is
// the whole point of the branch: when core already injected the stored session
// into the EB, re-driving the login form through the model costs minutes for
// nothing. These assert the branch on the *prompt text actually sent*, since
// that is the only externally visible difference.
// ---------------------------------------------------------------------------

const AUTHED_JSON = JSON.stringify({
  inAppNavLinks: [
    { path: "/dashboard", label: "Dashboard" },
    { path: "/projects", label: "Projects" },
  ],
  safeCtaCandidates: [
    {
      label: "Create project",
      selectorHint: "button with name 'Create project'",
    },
  ],
  observedRoutes: ["/dashboard", "/projects"],
  friction: [],
});

const SEED_CODE = "await page.goto(baseUrl + '/login');";

const authedScout = (preAuthenticated?: boolean) =>
  runQuickstartScoutAuthed(
    ai,
    session,
    REPO_ID,
    "https://app.example.com",
    SEED_CODE,
    preAuthenticated === undefined ? undefined : { preAuthenticated },
  );

/** The prompt string passed to the Nth `ai.generate` call. */
const promptOf = (call = 0) => mockGenerate.mock.calls[call][0] as string;

describe("runQuickstartScoutAuthed — preAuthenticated substitution", () => {
  it("omits the seed and tells the model it is already signed in", async () => {
    mockGenerate.mockResolvedValueOnce(aiResult(AUTHED_JSON));

    const { data } = await authedScout(true);

    const prompt = promptOf();
    expect(prompt).not.toContain(SEED_CODE);
    expect(prompt).toContain("ALREADY signed in");
    expect(prompt).toContain("SKIP step 1");
    expect(data.inAppNavLinks).toHaveLength(2);
  });

  it("embeds the seed for replay when the session was not pre-authenticated", async () => {
    mockGenerate.mockResolvedValueOnce(aiResult(AUTHED_JSON));

    await authedScout(false);

    const prompt = promptOf();
    expect(prompt).toContain(SEED_CODE);
    expect(prompt).toContain("run this FIRST");
    expect(prompt).not.toContain("ALREADY signed in");
  });

  it("defaults to seed replay when no options are passed", async () => {
    mockGenerate.mockResolvedValueOnce(aiResult(AUTHED_JSON));

    await authedScout();

    expect(promptOf()).toContain(SEED_CODE);
  });

  it("passes the claimed browser session as browserTools on every call", async () => {
    mockGenerate.mockResolvedValueOnce(aiResult(AUTHED_JSON));

    await authedScout(true);

    expect(mockGenerate.mock.calls[0][1]).toMatchObject({
      actionType: "agent_discover",
      repositoryId: REPO_ID,
      json: true,
      browserTools: session,
    });
  });
});

describe("runQuickstartScoutAuthed — parsing", () => {
  it("retries once on non-JSON and keeps the chosen prompt shape", async () => {
    mockGenerate
      .mockResolvedValueOnce(aiResult("I browsed the app but here is prose."))
      .mockResolvedValueOnce(aiResult(AUTHED_JSON));

    const { data, retryCount } = await authedScout(true);

    expect(retryCount).toBe(1);
    expect(mockGenerate).toHaveBeenCalledTimes(2);
    // The retry re-sends the same pre-authenticated prompt plus the parse
    // error — it must not silently fall back to the seed-replay shape.
    expect(promptOf(1)).toContain("ALREADY signed in");
    expect(promptOf(1)).toContain("not valid JSON");
    expect(data.observedRoutes).toEqual(["/dashboard", "/projects"]);
  });

  it("degrades to an empty scout when both attempts are unusable", async () => {
    mockGenerate
      .mockResolvedValueOnce(aiResult("nope"))
      .mockResolvedValueOnce(aiResult("still nope"));

    const { data, retryCount } = await authedScout(true);

    expect(retryCount).toBe(1);
    expect(data).toEqual({
      inAppNavLinks: [],
      safeCtaCandidates: [],
      observedRoutes: [],
      friction: [],
    });
  });

  it("drops malformed nav links, CTAs and routes rather than throwing", async () => {
    mockGenerate.mockResolvedValueOnce(
      aiResult(
        JSON.stringify({
          inAppNavLinks: [
            { path: "/ok", label: "Ok" },
            { path: "not-a-path", label: "Relative" },
            { label: "no path at all" },
          ],
          safeCtaCandidates: [
            { label: "Create project" },
            { selectorHint: "no label" },
          ],
          observedRoutes: ["/dashboard", 42, null],
          friction: [{ kind: "slow_route", note: "3s" }, { kind: "bad" }],
        }),
      ),
    );

    const { data } = await authedScout(true);

    expect(data.inAppNavLinks).toEqual([{ path: "/ok", label: "Ok" }]);
    expect(data.safeCtaCandidates).toEqual([
      { label: "Create project", selectorHint: undefined },
    ]);
    expect(data.observedRoutes).toEqual(["/dashboard"]);
    expect(data.friction).toEqual([{ kind: "slow_route", note: "3s" }]);
  });

  it("unwraps JSON wrapped in a fence with trailing prose", async () => {
    mockGenerate.mockResolvedValueOnce(
      aiResult("Here you go:\n```json\n" + AUTHED_JSON + "\n```\nDone!"),
    );

    const { data, retryCount } = await authedScout(true);

    expect(retryCount).toBe(0);
    expect(data.inAppNavLinks).toHaveLength(2);
  });
});
