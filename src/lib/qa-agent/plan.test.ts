import { describe, it, expect } from "vitest";
import {
  buildApiDefinition,
  buildDiscoveryDigest,
  buildExistingCoverageDigest,
  buildExistingPlanDigest,
  buildGeneratorPrompt,
  buildJourneyRefinerUserPrompt,
  buildPlannerUserPrompt,
  computeQaSummary,
  enabledPlanItems,
  explainInvalidRefinedJourneys,
  groupPlaywrightOverrides,
  isQaTestPlan,
  isRefinedJourneys,
  itemGroups,
  itemPlaywrightOverrides,
  matchPlanToExistingTests,
  mergeRefinedJourneys,
  dedupePlanIds,
  normalizeQaGroups,
  sanitizeQaPlan,
  MAX_PLAN_ITEMS,
  type RefinedJourneys,
} from "./plan";
import type {
  QaDiscovery,
  QaGeneratedTest,
  QaPageSnapshot,
  QaPlanItem,
  QaTestPlan,
} from "@/lib/db/schema";

const page = (overrides: Partial<QaPageSnapshot> = {}): QaPageSnapshot => ({
  url: "https://app.example.com/",
  finalUrl: "https://app.example.com/",
  title: "Example Bank",
  headings: [{ level: 1, text: "Welcome" }],
  forms: [
    {
      name: "login",
      action: "/login",
      method: "post",
      inputs: [
        {
          tag: "input",
          type: "email",
          name: "email",
          id: "email",
          label: "Email",
        },
        {
          tag: "input",
          type: "password",
          name: "password",
          id: "password",
          label: "Password",
        },
      ],
    },
  ],
  buttons: ["Sign in", "Transfer"],
  links: [{ text: "Accounts", href: "/accounts" }],
  testIds: ["login-submit"],
  candidateSelectors: ["getByTestId('login-submit')"],
  apiEndpoints: [{ method: "GET", path: "/api/accounts", status: 200 }],
  ...overrides,
});

const discovery = (overrides: Partial<QaDiscovery> = {}): QaDiscovery => ({
  targetUrl: "https://app.example.com",
  crawledPages: [page()],
  githubConnected: false,
  ...overrides,
});

const validPlan = (): QaTestPlan => ({
  appProfile: {
    summary: "A demo bank",
    businessDomain: "banking",
    primaryOutcome: "a transfer is completed",
  },
  journeys: [
    {
      id: "J1",
      title: "Transfer money",
      priority: "P1",
      steps: ["Log in", "Open transfer", "Submit"],
      businessOutcome: "money moved between accounts",
      endStateVerification: "destination balance increased",
    },
  ],
  items: [
    {
      id: "T1",
      group: "journey",
      title: "Complete a transfer",
      priority: "P1",
      journeyId: "J1",
      pagePath: "/transfer",
      scenario: "1. Log in 2. Transfer 10 3. Verify balance",
    },
    {
      id: "T2",
      group: "smoke",
      title: "Landing renders",
      priority: "P1",
      scenario: "1. Open / 2. Expect heading Welcome",
    },
    {
      id: "T3",
      group: "api",
      title: "Accounts endpoint",
      priority: "P2",
      scenario: "GET /api/accounts returns 200",
      api: { method: "GET", path: "/api/accounts", expectedStatus: 200 },
    },
  ],
});

describe("normalizeQaGroups", () => {
  it("always includes journey and keeps canonical order", () => {
    expect(normalizeQaGroups(["smoke"])).toEqual(["journey", "smoke"]);
    expect(normalizeQaGroups([])).toEqual(["journey"]);
  });

  it("drops unknown groups", () => {
    expect(normalizeQaGroups(["nope" as never, "a11y", "perf"])).toEqual([
      "journey",
      "a11y",
      "perf",
    ]);
  });
});

describe("groupPlaywrightOverrides", () => {
  it("enforces the a11y layer for a11y tests", () => {
    expect(groupPlaywrightOverrides("a11y")).toEqual({ a11yMode: "enforce" });
  });
  it("enforces the perf layer for perf tests", () => {
    expect(groupPlaywrightOverrides("perf")).toEqual({ perfMode: "enforce" });
  });
  it("downgrades network/console noise for failure-injection groups", () => {
    expect(groupPlaywrightOverrides("resilience")).toEqual({
      networkMode: "log",
      consoleMode: "log",
    });
    expect(groupPlaywrightOverrides("negative")).toEqual({
      networkMode: "log",
      consoleMode: "log",
    });
  });
  it("leaves other groups on repo defaults", () => {
    expect(groupPlaywrightOverrides("smoke")).toBeUndefined();
    expect(groupPlaywrightOverrides("journey")).toBeUndefined();
  });
});

describe("isQaTestPlan", () => {
  it("accepts a valid plan", () => {
    expect(isQaTestPlan(validPlan())).toBe(true);
  });

  it("rejects a plan without items", () => {
    expect(isQaTestPlan({ ...validPlan(), items: [] })).toBe(false);
  });

  it("rejects malformed journeys", () => {
    const plan = validPlan();
    (plan.journeys[0] as unknown as Record<string, unknown>).steps = "no";
    expect(isQaTestPlan(plan)).toBe(false);
  });

  it("rejects api items with a bad method", () => {
    const plan = validPlan();
    (plan.items[2].api as unknown as Record<string, unknown>).method = "HEAD";
    expect(isQaTestPlan(plan)).toBe(false);
  });

  it("rejects attacker-shaped objects (wrong keys)", () => {
    expect(isQaTestPlan({ evil: true })).toBe(false);
    expect(isQaTestPlan(null)).toBe(false);
    expect(isQaTestPlan("plan")).toBe(false);
  });
});

describe("sanitizeQaPlan", () => {
  it("drops items in unselected groups", () => {
    const out = sanitizeQaPlan(validPlan(), ["journey", "smoke"]);
    expect(out.items.map((i) => i.id)).toEqual(["T1", "T2"]);
  });

  it("clears orphaned journey references", () => {
    const plan = validPlan();
    plan.items[1].journeyId = "J404";
    const out = sanitizeQaPlan(plan, ["journey", "smoke", "api"]);
    expect(out.items[1].journeyId).toBeUndefined();
    expect(out.items[0].journeyId).toBe("J1");
  });
});

describe("enabledPlanItems", () => {
  it("filters explicitly disabled items only", () => {
    const plan = validPlan();
    plan.items[1].enabled = false;
    expect(enabledPlanItems(plan).map((i) => i.id)).toEqual(["T1", "T3"]);
  });
});

describe("buildDiscoveryDigest", () => {
  it("includes selectors, forms, and observed API endpoints", () => {
    const digest = buildDiscoveryDigest(discovery());
    expect(digest).toContain("getByTestId('login-submit')");
    expect(digest).toContain("GET /api/accounts → 200");
    expect(digest).toContain('input[email] "Email"');
  });

  it("includes static routes when present and caps length", () => {
    const digest = buildDiscoveryDigest(
      discovery({
        githubConnected: true,
        framework: "nextjs",
        staticRoutes: [{ path: "/accounts", type: "page" }],
      }),
    );
    expect(digest).toContain("/accounts (page)");
    const huge = buildDiscoveryDigest(
      discovery({
        crawledPages: Array.from({ length: 40 }, (_, i) =>
          page({
            url: `https://app.example.com/p${i}`,
            finalUrl: `https://app.example.com/p${i}`,
            headings: Array.from({ length: 10 }, (_, j) => ({
              level: 2,
              text: `Section ${"x".repeat(80)} ${j}`,
            })),
          }),
        ),
      }),
    );
    // Truncates at a page boundary (never mid-page) with an omission note,
    // and drops the last crawled page rather than slicing it in half.
    expect(huge.length).toBeLessThanOrEqual(24_000 + 100);
    expect(huge).toContain("omitted to fit the context budget");
    expect(huge).not.toContain("/p39");
  });
});

describe("buildPlannerUserPrompt", () => {
  it("states auth availability and embeds feedback", () => {
    const authed = buildPlannerUserPrompt({
      digest: "D",
      groups: ["journey", "smoke"],
      authenticated: true,
    });
    expect(authed).toContain("Authenticated session available: YES");
    expect(authed).toContain("in-app surface");
    const rejected = buildPlannerUserPrompt({
      digest: "D",
      groups: ["journey"],
      authenticated: false,
      feedback: "Cover the transfer form too",
    });
    expect(rejected).toContain("Cover the transfer form too");
    expect(rejected).toContain("Authenticated session available: NO");
  });
});

describe("buildGeneratorPrompt", () => {
  it("includes group guidance, journey outcome, and selector hints", () => {
    const plan = validPlan();
    const prompt = buildGeneratorPrompt({
      item: {
        ...plan.items[0],
        selectorHints: ["getByTestId('login-submit')"],
      },
      plan,
      targetUrl: "https://app.example.com",
    });
    expect(prompt).toContain("BUSINESS-OUTCOME JOURNEY");
    expect(prompt).toContain("destination balance increased");
    expect(prompt).toContain("getByTestId('login-submit')");
  });

  it("passes credentials only when provided", () => {
    const plan = validPlan();
    const noCreds = buildGeneratorPrompt({
      item: plan.items[1],
      plan,
      targetUrl: "https://app.example.com",
    });
    expect(noCreds).not.toContain("password");
    const withCreds = buildGeneratorPrompt({
      item: plan.items[1],
      plan,
      targetUrl: "https://app.example.com",
      credentials: { email: "qa@example.com", password: "s3cret" },
    });
    expect(withCreds).toContain("qa@example.com");
  });

  it("pre-authenticated sessions forbid login steps and omit credentials", () => {
    const plan = validPlan();
    const prompt = buildGeneratorPrompt({
      item: plan.items[1],
      plan,
      targetUrl: "https://app.example.com",
      auth: { preAuthenticated: true },
    });
    expect(prompt).toContain("already authenticated");
    expect(prompt).toContain("Do NOT write login steps");
    expect(prompt).not.toContain("s3cret");

    const notPreAuthed = buildGeneratorPrompt({
      item: plan.items[1],
      plan,
      targetUrl: "https://app.example.com",
      credentials: { email: "qa@example.com", password: "s3cret" },
      auth: { preAuthenticated: false },
    });
    expect(notPreAuthed).not.toContain("already authenticated");
    expect(notPreAuthed).toContain("qa@example.com");
  });

  it("threads the login context into every auth mode", () => {
    const plan = validPlan();
    const loginContext = {
      loginUrl: "https://app.example.com/login",
      signupUrl: "https://app.example.com/register",
    };
    // Pre-authenticated: still names the login page (for lapse reporting).
    const preAuth = buildGeneratorPrompt({
      item: plan.items[1],
      plan,
      targetUrl: "https://app.example.com",
      auth: { preAuthenticated: true },
      loginContext,
    });
    expect(preAuth).toContain("/login");
    // Credentials: log in AT the real login URL.
    const creds = buildGeneratorPrompt({
      item: plan.items[1],
      plan,
      targetUrl: "https://app.example.com",
      credentials: { email: "qa@example.com", password: "s3cret" },
      loginContext,
    });
    expect(creds).toContain("at https://app.example.com/login");
    // Public-only run: no session, no creds — still names where auth lives.
    const publicOnly = buildGeneratorPrompt({
      item: plan.items[1],
      plan,
      targetUrl: "https://app.example.com",
      loginContext,
    });
    expect(publicOnly).toContain("No authenticated session");
    expect(publicOnly).toContain("/register");
  });
});

describe("buildApiDefinition", () => {
  it("builds an absolute URL from the target base and asserts status", () => {
    const def = buildApiDefinition(
      validPlan().items[2],
      "https://app.example.com/",
    );
    expect(def).not.toBeNull();
    expect(def!.url).toBe("https://app.example.com/api/accounts");
    expect(def!.method).toBe("GET");
    expect(def!.assertions[0]).toMatchObject({ kind: "status", equals: 200 });
  });

  it("returns null for non-api items", () => {
    expect(
      buildApiDefinition(validPlan().items[0], "https://app.example.com"),
    ).toBeNull();
  });
});

describe("computeQaSummary", () => {
  it("aggregates counts and journey traceability", () => {
    const plan = validPlan();
    const generated: QaGeneratedTest[] = [
      {
        planItemId: "T1",
        group: "journey",
        testId: "test-1",
        name: "Complete a transfer",
        status: "passed",
      },
      {
        planItemId: "T2",
        group: "smoke",
        testId: "test-2",
        name: "Landing renders",
        status: "healed",
      },
      {
        planItemId: "T3",
        group: "api",
        name: "Accounts endpoint",
        status: "generation_failed",
      },
    ];
    const summary = computeQaSummary(plan, generated);
    expect(summary.planned).toBe(3);
    expect(summary.generated).toBe(2);
    expect(summary.passed).toBe(2);
    expect(summary.healed).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.byGroup.journey).toMatchObject({ planned: 1, passed: 1 });
    expect(summary.journeyCoverage.J1).toEqual(["test-1"]);
  });

  it("excludes disabled items from planned counts", () => {
    const plan = validPlan();
    plan.items[2].enabled = false;
    const summary = computeQaSummary(plan, []);
    expect(summary.planned).toBe(2);
  });
});

describe("matchPlanToExistingTests", () => {
  const items = () => validPlan().items;
  const existing = [
    { id: "ex-1", name: "Complete a transfer" },
    { id: "ex-2", name: "landing RENDERS!" },
  ];

  it("matches by normalized title", () => {
    const m = matchPlanToExistingTests(items(), existing);
    expect(m.get("T1")).toBe("ex-1");
    expect(m.get("T2")).toBe("ex-2");
    expect(m.has("T3")).toBe(false);
  });

  it("prefers prior-ledger links and ignores dead test ids", () => {
    const ledger: QaGeneratedTest[] = [
      {
        planItemId: "T3",
        group: "api",
        testId: "ex-1",
        name: "old name",
        status: "passed",
      },
      {
        planItemId: "T2",
        group: "smoke",
        testId: "deleted-test",
        name: "Landing renders",
        status: "passed",
      },
    ];
    const m = matchPlanToExistingTests(items(), existing, ledger);
    expect(m.get("T3")).toBe("ex-1"); // ledger link wins
    expect(m.get("T2")).toBe("ex-2"); // dead id falls back to title match
  });

  it("returns empty when nothing exists", () => {
    expect(matchPlanToExistingTests(items(), []).size).toBe(0);
  });
});

describe("buildExistingCoverageDigest", () => {
  it("lists names with area and api marker", () => {
    const digest = buildExistingCoverageDigest([
      { id: "1", name: "Login smoke", functionalAreaName: "QA: Smoke" },
      { id: "2", name: "Accounts endpoint", testType: "api" },
    ]);
    expect(digest).toContain('"Login smoke" (area: QA: Smoke)');
    expect(digest).toContain('"Accounts endpoint" [api]');
  });
});

describe("existing coverage in planner prompt", () => {
  it("embeds the existing-tests section when provided", () => {
    const prompt = buildPlannerUserPrompt({
      digest: "D",
      groups: ["journey"],
      authenticated: false,
      existingCoverage: '- "Login smoke"',
    });
    expect(prompt).toContain("ALREADY CONTAINS");
    expect(prompt).toContain('- "Login smoke"');
  });
});

describe("journey refiner — validation + prompts", () => {
  const validRefined = (): RefinedJourneys => ({
    journeys: [
      {
        id: "U1",
        title: "Invite a teammate",
        priority: "P1",
        businessArea: "Team",
        steps: ["Open settings", "Invite", "Verify pending"],
        businessOutcome: "an invite is created",
        endStateVerification: "invitee appears in the pending list",
      },
    ],
    items: [
      {
        id: "UT1",
        group: "journey",
        groups: ["journey", "ui"],
        title: "Invite teammate flow",
        priority: "P1",
        journeyId: "U1",
        businessArea: "Team",
        scenario: "1. Open settings 2. Invite 3. Assert pending row",
      },
    ],
  });

  it("accepts a well-formed refiner payload and rejects junk", () => {
    expect(isRefinedJourneys(validRefined())).toBe(true);
    expect(isRefinedJourneys({ journeys: [], items: [] })).toBe(false);
    expect(explainInvalidRefinedJourneys({ journeys: [], items: [] })).toMatch(
      /no journeys and no items/,
    );
    const bad = validRefined();
    (bad.items[0] as unknown as Record<string, unknown>).scenario = 42;
    expect(isRefinedJourneys(bad)).toBe(false);
  });

  it("embeds user journeys + existing plan digest in the prompt", () => {
    const prompt = buildJourneyRefinerUserPrompt({
      digest: "DIGEST",
      groups: ["journey", "ui"],
      userJourneys: ["Invite a teammate", "Delete a project"],
      existingPlanDigest: buildExistingPlanDigest(validPlan()),
      authenticated: true,
    });
    expect(prompt).toContain("1. Invite a teammate");
    expect(prompt).toContain("2. Delete a project");
    expect(prompt).toContain('test: "Complete a transfer"');
    expect(prompt).toContain("Authenticated session available: YES");
  });
});

describe("mergeRefinedJourneys", () => {
  const refined = (): RefinedJourneys => ({
    journeys: [
      {
        id: "A",
        title: "Invite a teammate",
        priority: "P1",
        businessArea: "Team",
        steps: ["Invite"],
        businessOutcome: "invite created",
        endStateVerification: "pending row",
      },
    ],
    items: [
      {
        id: "X",
        group: "ui",
        groups: ["ui"],
        title: "Invite teammate flow",
        priority: "P1",
        journeyId: "A",
        businessArea: "Team",
        scenario: "invite steps",
      },
    ],
  });

  it("appends new journeys/items with fresh ids, preserving the existing plan", () => {
    const plan = validPlan();
    const {
      plan: merged,
      addedJourneys,
      addedItems,
    } = mergeRefinedJourneys(plan, refined(), [
      "journey",
      "smoke",
      "api",
      "ui",
    ]);
    expect(addedJourneys).toBe(1);
    expect(addedItems).toBe(1);
    // Existing items are untouched.
    expect(merged.items.slice(0, 3).map((i) => i.id)).toEqual([
      "T1",
      "T2",
      "T3",
    ]);
    const newItem = merged.items[merged.items.length - 1];
    // Fresh, collision-free id; journeyId remapped to the new journey.
    expect(newItem.id).not.toBe("X");
    const newJourney = merged.journeys[merged.journeys.length - 1];
    expect(newItem.journeyId).toBe(newJourney.id);
    // journey-linked item is forced to carry the "journey" group.
    expect(itemGroups(newItem)).toContain("journey");
  });

  it("mints ids that clear existing non-contiguous U-ids plan-wide", () => {
    // Existing plan whose ids are U-prefixed but non-contiguous (as left by
    // prior dedup/trim). Length-based seeding would remint `U2` for the new
    // journey — a duplicate React key. Ids must clear the highest existing id
    // across BOTH journeys and items.
    const plan: QaTestPlan = {
      appProfile: validPlan().appProfile,
      journeys: [
        {
          id: "U2",
          title: "Existing journey",
          priority: "P1",
          steps: ["x"],
          businessOutcome: "o",
          endStateVerification: "v",
        },
      ],
      items: [
        {
          id: "U5",
          group: "smoke",
          title: "Existing item",
          priority: "P2",
          scenario: "s",
        },
      ],
    };
    const { plan: merged } = mergeRefinedJourneys(plan, refined(), [
      "journey",
      "ui",
    ]);
    const allIds = [
      ...merged.journeys.map((j) => j.id),
      ...merged.items.map((i) => i.id),
    ];
    // Every id (journeys + items) is unique — no duplicate React keys.
    expect(new Set(allIds).size).toBe(allIds.length);
    // The new journey clears the highest existing numeric id (U5).
    const newJourney = merged.journeys[merged.journeys.length - 1];
    expect(Number(newJourney.id.slice(1))).toBeGreaterThan(5);
  });

  it("dedupePlanIds repairs colliding legacy ids without dropping entries", () => {
    // Two DIFFERENT journeys share `U6` (the legacy collision) and an item also
    // reuses `U6`. All three entries must survive with unique ids; the first
    // occurrence keeps its id so its coverage/links stay valid.
    const corrupt: QaTestPlan = {
      appProfile: validPlan().appProfile,
      journeys: [
        {
          id: "U6",
          title: "First journey",
          priority: "P1",
          steps: ["a"],
          businessOutcome: "o1",
          endStateVerification: "v1",
        },
        {
          id: "U6",
          title: "Second journey",
          priority: "P2",
          steps: ["b"],
          businessOutcome: "o2",
          endStateVerification: "v2",
        },
      ],
      items: [
        {
          id: "U6",
          group: "smoke",
          title: "Reused item id",
          priority: "P2",
          scenario: "s",
        },
      ],
    };
    const repaired = dedupePlanIds(corrupt);
    const allIds = [
      ...repaired.journeys.map((j) => j.id),
      ...repaired.items.map((i) => i.id),
    ];
    expect(new Set(allIds).size).toBe(allIds.length); // all unique
    expect(repaired.journeys).toHaveLength(2); // nothing dropped
    expect(repaired.items).toHaveLength(1);
    // First occurrence keeps its id; titles are preserved on every entry.
    expect(repaired.journeys[0].id).toBe("U6");
    expect(repaired.journeys.map((j) => j.title)).toEqual([
      "First journey",
      "Second journey",
    ]);
  });

  it("dedupePlanIds returns an already-unique plan unchanged", () => {
    const plan = validPlan();
    expect(dedupePlanIds(plan)).toBe(plan);
  });

  it("strips groups the user did not select", () => {
    const r = refined();
    r.items[0].groups = ["ui", "perf"];
    const { plan: merged } = mergeRefinedJourneys(validPlan(), r, [
      "journey",
      "ui",
    ]);
    const newItem = merged.items[merged.items.length - 1];
    expect(itemGroups(newItem)).not.toContain("perf");
    expect(itemGroups(newItem)).toContain("ui");
  });

  it("dedupes against existing item titles", () => {
    const r = refined();
    r.items[0].title = "Landing renders"; // already in validPlan()
    const { addedItems } = mergeRefinedJourneys(validPlan(), r, [
      "journey",
      "smoke",
      "ui",
    ]);
    expect(addedItems).toBe(0);
  });

  it("bounds newly added items when the plan is already full", () => {
    const plan = validPlan();
    // Pad the plan to the cap so the budget floor (4) governs.
    plan.items = Array.from({ length: MAX_PLAN_ITEMS }, (_, i) => ({
      id: `P${i}`,
      group: "ui" as const,
      title: `Existing ${i}`,
      priority: "P2" as const,
      scenario: "x",
    }));
    const many: RefinedJourneys = {
      journeys: [],
      items: Array.from({ length: 20 }, (_, i) => ({
        id: `N${i}`,
        group: "ui" as const,
        groups: ["ui" as const],
        title: `New journey item ${i}`,
        priority: (i < 6 ? "P1" : "P3") as "P1" | "P3",
        scenario: "y",
      })),
    };
    const { addedItems, trimmed } = mergeRefinedJourneys(plan, many, [
      "journey",
      "ui",
    ]);
    expect(addedItems).toBe(4); // max(4, MAX - full) === 4
    expect(trimmed).toBe(16);
  });
});

describe("computeQaSummary with covered entries", () => {
  it("counts covered separately and keeps journey traceability", () => {
    const plan = validPlan();
    const summary = computeQaSummary(plan, [
      {
        planItemId: "T1",
        group: "journey",
        testId: "ex-1",
        name: "Complete a transfer",
        status: "covered",
      },
      {
        planItemId: "T2",
        group: "smoke",
        testId: "new-1",
        name: "Landing renders",
        status: "passed",
      },
    ]);
    expect(summary.covered).toBe(1);
    expect(summary.generated).toBe(1);
    expect(summary.byGroup.journey).toMatchObject({ covered: 1, generated: 0 });
    expect(summary.journeyCoverage.J1).toEqual(["ex-1"]);
  });
});

describe("coverage matrix", () => {
  it("builds business-area × group cells from plan + ledger", () => {
    const plan = validPlan();
    plan.items[0].businessArea = "Payments";
    plan.items[1].businessArea = "Marketing";
    // T3 (api) left without a businessArea → rolls up under "General"
    const summary = computeQaSummary(plan, [
      {
        planItemId: "T1",
        group: "journey",
        testId: "t-1",
        name: "Complete a transfer",
        status: "passed",
      },
      {
        planItemId: "T3",
        group: "api",
        testId: "ex-1",
        name: "Accounts endpoint",
        status: "covered",
      },
    ]);
    expect(summary.matrix?.Payments?.journey).toEqual({
      planned: 1,
      covered: 0,
      generated: 1,
      passed: 1,
    });
    expect(summary.matrix?.General?.api).toEqual({
      planned: 1,
      covered: 1,
      generated: 0,
      passed: 0,
    });
    // Marketing smoke item has no ledger entry — a pure gap.
    expect(summary.matrix?.Marketing?.smoke).toEqual({
      planned: 1,
      covered: 0,
      generated: 0,
      passed: 0,
    });
  });

  it("accepts plans with and without businessArea (validator tolerance)", () => {
    const plan = validPlan();
    expect(isQaTestPlan(plan)).toBe(true);
    plan.items[0].businessArea = "Payments";
    plan.journeys[0].businessArea = "Payments";
    expect(isQaTestPlan(plan)).toBe(true);
    (plan.items[0] as unknown as Record<string, unknown>).businessArea = 42;
    expect(isQaTestPlan(plan)).toBe(false);
  });
});

describe("multi-group plan items", () => {
  const multiItem = (overrides: Partial<QaPlanItem> = {}): QaPlanItem => ({
    id: "T9",
    group: "smoke",
    groups: ["smoke", "a11y", "perf"],
    title: "Landing renders, accessible, fast",
    priority: "P1",
    scenario: "1. Open / 2. Expect heading Welcome",
    ...overrides,
  });

  it("itemGroups falls back to [group] and normalizes order/dupes", () => {
    expect(itemGroups(validPlan().items[1])).toEqual(["smoke"]);
    // Primary first, rest in canonical order, dupes dropped.
    expect(
      itemGroups(multiItem({ groups: ["a11y", "perf", "smoke", "a11y"] })),
    ).toEqual(["a11y", "smoke", "perf"]);
  });

  it("validator accepts groups arrays and rejects invalid ids in them", () => {
    const plan = validPlan();
    plan.items.push(multiItem());
    expect(isQaTestPlan(plan)).toBe(true);
    // groups-only item (no primary group) is accepted; sanitize backfills.
    const groupsOnly = multiItem();
    delete (groupsOnly as Partial<QaPlanItem>).group;
    plan.items[plan.items.length - 1] = groupsOnly;
    expect(isQaTestPlan(plan)).toBe(true);
    plan.items[plan.items.length - 1] = multiItem({
      groups: ["smoke", "nope" as never],
    });
    expect(isQaTestPlan(plan)).toBe(false);
  });

  it("sanitize strips unselected groups, keeps the item, backfills group", () => {
    const plan = validPlan();
    const groupsOnly = multiItem({ groups: ["a11y", "smoke", "perf"] });
    delete (groupsOnly as Partial<QaPlanItem>).group;
    plan.items.push(groupsOnly);
    const out = sanitizeQaPlan(plan, ["journey", "smoke"]);
    const kept = out.items.find((i) => i.id === "T9")!;
    expect(kept.groups).toEqual(["smoke"]);
    expect(kept.group).toBe("smoke");
    // Item with no surviving group is dropped (T3 is api-only).
    expect(out.items.some((i) => i.id === "T3")).toBe(false);
  });

  it("itemPlaywrightOverrides merges overrides across groups", () => {
    expect(itemPlaywrightOverrides(["smoke", "a11y", "perf"])).toEqual({
      a11yMode: "enforce",
      perfMode: "enforce",
    });
    expect(itemPlaywrightOverrides(["ui", "resilience"])).toEqual({
      networkMode: "log",
      consoleMode: "log",
    });
    expect(itemPlaywrightOverrides(["smoke", "ui"])).toBeUndefined();
  });

  it("generator prompt lists all groups and stacks their guidance", () => {
    const plan = validPlan();
    const prompt = buildGeneratorPrompt({
      item: multiItem(),
      plan,
      targetUrl: "https://app.example.com",
    });
    expect(prompt).toContain("Coverage groups: smoke + a11y + perf");
    expect(prompt).toContain("SMOKE test");
    expect(prompt).toContain("ACCESSIBILITY test");
    expect(prompt).toContain("PERFORMANCE test");
  });

  it("summary counts a multi-group test in every tagged bucket and cell", () => {
    const plan = validPlan();
    plan.items = [multiItem({ businessArea: "Marketing" })];
    const summary = computeQaSummary(plan, [
      {
        planItemId: "T9",
        group: "smoke",
        groups: ["smoke", "a11y", "perf"],
        testId: "t-9",
        name: "Landing renders, accessible, fast",
        status: "passed",
      },
    ]);
    // One test, three coverage marks.
    expect(summary.planned).toBe(1);
    expect(summary.generated).toBe(1);
    expect(summary.passed).toBe(1);
    for (const g of ["smoke", "a11y", "perf"] as const) {
      expect(summary.byGroup[g]).toMatchObject({
        planned: 1,
        generated: 1,
        passed: 1,
      });
      expect(summary.matrix?.Marketing?.[g]).toEqual({
        planned: 1,
        covered: 0,
        generated: 1,
        passed: 1,
      });
    }
    expect(summary.byGroup.ui).toBeUndefined();
  });
});
