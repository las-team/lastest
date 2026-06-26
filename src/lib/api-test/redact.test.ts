import { describe, it, expect } from "vitest";
import {
  redactApiDefinition,
  renderApiDefinitionForCode,
  redactSensitiveText,
  REDACTED,
} from "./redact";
import type { ApiTestDefinition } from "@/lib/db/schema";

describe("redactApiDefinition", () => {
  it("masks bearer tokens", () => {
    const def: ApiTestDefinition = {
      method: "GET",
      url: "/api/me",
      auth: { type: "bearer", token: "super-secret-123" },
      assertions: [{ kind: "status", in: [200] }],
    };
    const out = redactApiDefinition(def);
    expect(out.auth).toEqual({ type: "bearer", token: REDACTED });
    // Original is not mutated.
    expect(def.auth).toEqual({ type: "bearer", token: "super-secret-123" });
  });

  it("masks basic-auth passwords but keeps the username", () => {
    const def: ApiTestDefinition = {
      method: "GET",
      url: "/api/me",
      auth: { type: "basic", username: "alice", password: "hunter2" },
      assertions: [{ kind: "status", equals: 200 }],
    };
    const out = redactApiDefinition(def);
    expect(out.auth).toEqual({
      type: "basic",
      username: "alice",
      password: REDACTED,
    });
  });

  it("masks sensitive headers case-insensitively, leaves others intact", () => {
    const def: ApiTestDefinition = {
      method: "POST",
      url: "/api/x",
      headers: {
        Authorization: "Bearer abc",
        "X-Api-Key": "k-123",
        "Content-Type": "application/json",
      },
      assertions: [{ kind: "status", equals: 200 }],
    };
    const out = redactApiDefinition(def);
    expect(out.headers).toEqual({
      Authorization: REDACTED,
      "X-Api-Key": REDACTED,
      "Content-Type": "application/json",
    });
  });

  it("renders credential-free JSON for the code column", () => {
    const def: ApiTestDefinition = {
      method: "GET",
      url: "/api/me",
      auth: { type: "bearer", token: "leak-me" },
      assertions: [{ kind: "status", equals: 200 }],
    };
    const code = renderApiDefinitionForCode(def);
    expect(code).not.toContain("leak-me");
    expect(code).toContain(REDACTED);
  });
});

describe("redactSensitiveText", () => {
  it("scrubs JWTs from response bodies", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4";
    expect(redactSensitiveText(`{"token":"${jwt}"}`)).not.toContain(jwt);
  });

  it("scrubs bearer echoes and provider keys", () => {
    expect(redactSensitiveText("Authorization: Bearer abcdef123456")).toContain(
      REDACTED,
    );
    expect(redactSensitiveText("key=sk-ABCDEFGHIJKLMNOP1234567890")).toContain(
      REDACTED,
    );
  });

  it("leaves ordinary text untouched", () => {
    expect(redactSensitiveText('{"id":1,"name":"ok"}')).toBe(
      '{"id":1,"name":"ok"}',
    );
  });
});
