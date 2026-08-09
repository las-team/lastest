import { describe, expect, it, vi } from "vitest";
import type { TeamRef } from "@lastest/contracts";

import { createTestsCapability } from "./tests";
import {
  MAX_AREA_NAME_LENGTH,
  MAX_TEST_CODE_LENGTH,
  MAX_TEST_NAME_LENGTH,
} from "./limits";
import type { TestsHost } from "./host";

const team: TeamRef = { id: "t1", plan: "pro", entitlements: new Set() };

function hostWith(overrides: Partial<TestsHost> = {}): TestsHost {
  return {
    repoTeamId: vi.fn(async () => "t1"),
    listCoverage: vi.fn(async () => ({ tests: [], areaPlans: [] })),
    resolveOrCreateArea: vi.fn(async () => ({ id: "area-1" })),
    createTest: vi.fn(async () => ({ id: "test-1" })),
    ...overrides,
  };
}

const validInput = {
  repositoryId: "r1",
  areaName: "Checkout",
  name: "Checkout flow",
  code: "export async function test(page) {}",
  targetUrl: "https://example.com/checkout",
};

describe("createTestsCapability.listCoverage", () => {
  it("resolves empty for a repo in another team, without throwing", async () => {
    const host = hostWith({ repoTeamId: vi.fn(async () => "someone-else") });
    const tests = createTestsCapability(host, team);

    expect(await tests.listCoverage("r1")).toEqual({
      tests: [],
      areaPlans: [],
    });
    expect(host.listCoverage).not.toHaveBeenCalled();
  });

  it("delegates to the host for a repo the team owns", async () => {
    const host = hostWith({
      listCoverage: vi.fn(async () => ({
        tests: [{ name: "Login", targetUrl: "/login" }],
        areaPlans: [],
      })),
    });
    const tests = createTestsCapability(host, team);

    expect(await tests.listCoverage("r1")).toEqual({
      tests: [{ name: "Login", targetUrl: "/login" }],
      areaPlans: [],
    });
  });
});

describe("createTestsCapability.createQuarantined", () => {
  it("rejects a repo the team does not own, without touching the host's writes", async () => {
    const host = hostWith({ repoTeamId: vi.fn(async () => "someone-else") });
    const tests = createTestsCapability(host, team);

    await expect(tests.createQuarantined(validInput)).rejects.toThrow(
      /not in this team/,
    );
    expect(host.resolveOrCreateArea).not.toHaveBeenCalled();
    expect(host.createTest).not.toHaveBeenCalled();
  });

  it("resolves the area then creates the test, unconditionally quarantined", async () => {
    const host = hostWith();
    const tests = createTestsCapability(host, team);

    const ref = await tests.createQuarantined(validInput);

    expect(ref).toEqual({ id: "test-1" });
    expect(host.resolveOrCreateArea).toHaveBeenCalledWith("r1", "Checkout");
    expect(host.createTest).toHaveBeenCalledWith({
      repositoryId: "r1",
      functionalAreaId: "area-1",
      name: "Checkout flow",
      code: validInput.code,
      targetUrl: "https://example.com/checkout",
    });
  });

  it("rejects an oversized name", async () => {
    const tests = createTestsCapability(hostWith(), team);
    await expect(
      tests.createQuarantined({
        ...validInput,
        name: "x".repeat(MAX_TEST_NAME_LENGTH + 1),
      }),
    ).rejects.toThrow(/name/);
  });

  it("rejects an oversized area name", async () => {
    const tests = createTestsCapability(hostWith(), team);
    await expect(
      tests.createQuarantined({
        ...validInput,
        areaName: "x".repeat(MAX_AREA_NAME_LENGTH + 1),
      }),
    ).rejects.toThrow(/areaName/);
  });

  it("rejects oversized code", async () => {
    const tests = createTestsCapability(hostWith(), team);
    await expect(
      tests.createQuarantined({
        ...validInput,
        code: "x".repeat(MAX_TEST_CODE_LENGTH + 1),
      }),
    ).rejects.toThrow(/code/);
  });

  it("rejects an empty name", async () => {
    const tests = createTestsCapability(hostWith(), team);
    await expect(
      tests.createQuarantined({ ...validInput, name: "" }),
    ).rejects.toThrow();
  });
});
