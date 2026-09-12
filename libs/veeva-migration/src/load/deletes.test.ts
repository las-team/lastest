import { describe, expect, it } from "vitest";
import { to18 } from "../transform/ids";
import { instantOf, isLater, latestDeletes } from "./deletes";

const ID = to18("001000000000001");

describe("delete ordering (§4.3 step 5 last-wins)", () => {
  it("compares instants, not strings, across the SFDC timestamp forms", () => {
    const z = "2026-01-10T10:00:00.000Z";
    const plus = "2026-01-10T10:00:00.000+0000";
    const colon = "2026-01-10T10:00:00.000+00:00";
    expect(instantOf(z)).toBe(instantOf(plus));
    expect(instantOf(z)).toBe(instantOf(colon));
    // 'Z' (0x5A) > '+' (0x2B) would make the string compare call an equal instant "later"
    expect(z > plus).toBe(true);
    expect(isLater(z, plus)).toBe(false);
    expect(isLater("2026-01-10T10:00:01.000+0000", z)).toBe(true);
    expect(isLater("garbage", z)).toBe(false);
  });

  it("latestDeletes keeps the latest event per id regardless of literal form", () => {
    const out = latestDeletes([
      { sfdcId: ID, deletedDate: "2026-01-10T10:00:00.000Z" },
      { sfdcId: ID.slice(0, 15), deletedDate: "2026-01-10T11:00:00.000+0000" },
      { sfdcId: ID, deletedDate: "2026-01-10T09:00:00.000Z" },
    ]);
    expect(out).toEqual([
      { sfdcId: ID, deletedDate: "2026-01-10T11:00:00.000+0000" },
    ]);
  });
});
