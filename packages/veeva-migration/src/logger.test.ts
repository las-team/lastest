import { describe, expect, it } from "vitest";
import { REDACT_PATHS, getLogger } from "./logger";

describe("logger", () => {
  it("redacts the credential and payload keys required by §8.5 / §7.5", () => {
    for (const k of [
      "password",
      "sessionId",
      "access_token",
      "assertion",
      "authorization",
      "token",
      "secret",
      "row",
      "payload",
      "record",
      "values",
    ]) {
      expect(REDACT_PATHS).toContain(k);
      expect(REDACT_PATHS).toContain(`*.${k}`);
    }
  });
  it("creates scoped child loggers with bindings", () => {
    const log = getLogger("Load", {
      run_id: "r1",
      object_key: "account",
      country: "US",
    });
    expect(typeof log.info).toBe("function");
    expect(log.bindings()).toMatchObject({
      scope: "Load",
      run_id: "r1",
      object_key: "account",
      country: "US",
    });
  });
});
