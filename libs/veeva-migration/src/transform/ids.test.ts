import { describe, expect, it } from "vitest";
import {
  formatLegacyId,
  idChecksum,
  isContactId,
  isQueueId,
  isSfdcId,
  isUserId,
  to15,
  to18,
} from "./ids";

describe("ids", () => {
  it("computes the standard 18-char checksum", () => {
    // well-known example: 001D000000IqhSL → 001D000000IqhSLIAZ
    expect(to18("001D000000IqhSL")).toBe("001D000000IqhSLIAZ");
    expect(idChecksum("001D000000IqhSL")).toBe("IAZ");
    expect(to18("00D000000000001")).toBe("00D000000000001EAA"); // uppercase D at position 2 sets bit 2 of block 1
    expect(to18("005000000000001")).toBe("005000000000001AAA");
  });
  it("repairs a mis-cased suffix and is idempotent", () => {
    expect(to18("001D000000IqhSLiaz")).toBe("001D000000IqhSLIAZ");
    expect(to18(to18("001D000000IqhSL"))).toBe("001D000000IqhSLIAZ");
  });
  it("distinguishes case-differing 15-char ids", () => {
    expect(to18("a0K000000000ABC")).not.toBe(to18("a0K000000000abc"));
  });
  it("rejects non-ids", () => {
    expect(isSfdcId("nope")).toBe(false);
    expect(isSfdcId(123)).toBe(false);
    expect(() => to18("x")).toThrow(/Not a Salesforce id/);
    expect(to15("001D000000IqhSLIAZ")).toBe("001D000000IqhSL");
  });
  it("classifies prefixes", () => {
    expect(isUserId("005000000000001AAA")).toBe(true);
    expect(isQueueId("00G000000000001AAA")).toBe(true);
    expect(isContactId("003000000000001AAA")).toBe(true);
    expect(isUserId("001000000000001AAA")).toBe(false);
  });
  it("formats legacy ids per legacyId.format", () => {
    expect(formatLegacyId("001D000000IqhSL", "{id18}")).toBe(
      "001D000000IqhSLIAZ",
    );
    expect(formatLegacyId("001D000000IqhSLIAZ", "{id15}")).toBe(
      "001D000000IqhSL",
    );
    expect(
      formatLegacyId(
        "001D000000IqhSL",
        "SF:{orgId15}:{id18}",
        "00D000000000001",
      ),
    ).toBe("SF:00D000000000001:001D000000IqhSLIAZ");
  });
});
