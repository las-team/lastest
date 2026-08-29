import { describe, it, expect } from "vitest";

import { buildFindingIssueBody, type FindingIssueInput } from "./issue-body";

const base: FindingIssueInput = {
  finding: {
    id: "f-1",
    title: "Saving a project silently fails",
    description: "The save button spins forever and the row never appears.",
    severity: "high",
    kind: "defect",
    url: "https://app.example.com/projects/new",
    rootCauseCluster: null,
    pageStateHash: "abc123",
    scenario: {
      id: "it0-s0",
      title: "Create a project",
      style: "curious",
      steps: ["Open the form", "Fill the name", "Submit"],
      rationale: "Core CRUD flow",
      expectedOutcome: "Project appears in the list",
    },
    evidence: {
      consoleErrors: ["TypeError: undefined is not a function"],
      failedRequests: [
        {
          url: "https://api.example.com/projects",
          status: 500,
          method: "POST",
        },
      ],
    },
    createdAt: new Date("2026-08-26T10:00:00.000Z"),
  },
  session: {
    id: "s-1",
    targetUrl: "https://app.example.com",
    actionLog: {
      scenarioId: "it0-s0",
      status: "failed",
      steps: [
        {
          intent: "Submit the form",
          action: "click",
          selector: "#save",
          result: "error",
          note: "no navigation",
        },
      ],
    },
  },
  cluster: {
    rootCause: "POST /projects returns 500",
    severity: "high",
    kind: "defect",
    findingIds: ["f-1"],
    summary: "Every create path fails at the API.",
  },
  repoFullName: "acme/web",
  reporterEmail: "qa@acme.test",
  appBaseUrl: "https://lastest.acme.test/",
  note: null,
};

describe("buildFindingIssueBody", () => {
  it("carries the evidence a reviewer would otherwise retype", () => {
    const { title, body, labels } = buildFindingIssueBody(base);

    expect(title).toBe("[Explorer] Saving a project silently fails");
    expect(labels).toEqual(["lastest", "explorer", "severity:high"]);
    // Description, planned steps, what the agent actually did, and both
    // evidence channels.
    expect(body).toContain("The save button spins forever");
    expect(body).toContain("1. Open the form");
    expect(body).toContain("**Expected:** Project appears in the list");
    expect(body).toContain("Submit the form");
    expect(body).toContain("TypeError: undefined is not a function");
    expect(body).toContain("| POST | https://api.example.com/projects | 500 |");
    expect(body).toContain("POST /projects returns 500");
    expect(body).toContain("acme/web");
    expect(body).toContain("qa@acme.test");
    // Back-link, with the trailing slash on the base URL collapsed.
    expect(body).toContain("(https://lastest.acme.test/explorer)");
    expect(body).toContain("finding `f-1`");
  });

  it("puts a reviewer note above the agent's own description", () => {
    const { body } = buildFindingIssueBody({
      ...base,
      note: "  Blocks the launch demo.  ",
    });
    expect(body.indexOf("Blocks the launch demo.")).toBeLessThan(
      body.indexOf("The save button spins forever"),
    );
    expect(body).not.toContain("  Blocks the launch demo.  ");
  });

  it("takes the reviewer's title verbatim, with no second prefix", () => {
    const { title } = buildFindingIssueBody({
      ...base,
      titleOverride: "[Explorer] Save is broken",
    });
    expect(title).toBe("[Explorer] Save is broken");
  });

  it("renders a finding with no scenario, session or evidence", () => {
    const { body } = buildFindingIssueBody({
      ...base,
      finding: {
        ...base.finding,
        scenario: null,
        evidence: null,
        pageStateHash: null,
        url: null,
      },
      session: null,
      cluster: null,
      repoFullName: null,
      reporterEmail: null,
    });
    expect(body).toContain("### What the explorer saw");
    expect(body).not.toContain("### Steps to reproduce");
    expect(body).not.toContain("### Evidence");
    // No empty table rows left behind by the missing context.
    expect(body).not.toContain("| Page |");
  });

  it("escapes pipes so a table row cannot break the table", () => {
    const { body } = buildFindingIssueBody({
      ...base,
      finding: {
        ...base.finding,
        url: "https://app.example.com/s?q=a|b",
      },
    });
    expect(body).toContain("https://app.example.com/s?q=a\\|b");
  });
});
