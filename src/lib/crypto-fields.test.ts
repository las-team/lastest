import { describe, it, expect, beforeAll } from "vitest";

// A valid 32-byte (64 hex char) key for the AES-256-GCM primitives. Set before
// any helper runs — crypto.ts reads ENCRYPTION_KEY lazily inside getKey().
const TEST_KEY =
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = TEST_KEY;
});
process.env.ENCRYPTION_KEY = TEST_KEY;

import {
  encrypt,
  decrypt,
  encryptField,
  decryptField,
  ENC_PREFIX,
} from "./crypto";
import {
  encryptAuthConfig,
  decryptAuthConfig,
  encryptSessionMetadata,
  decryptSessionMetadata,
} from "./crypto-fields";
import type { SetupAuthConfig, AgentSessionMetadata } from "./db/schema";

describe("crypto primitives", () => {
  it("round-trips arbitrary strings, including unicode and large blobs", () => {
    const samples = [
      "hunter2",
      "пароль-日本語-🔐",
      "",
      JSON.stringify({ cookies: Array(2000).fill({ name: "s", value: "x" }) }),
    ];
    for (const s of samples) {
      const enc = encrypt(s);
      expect(enc.startsWith(ENC_PREFIX)).toBe(true);
      expect(enc).not.toBe(s);
      expect(decrypt(enc)).toBe(s);
    }
  });

  it("uses a fresh IV so ciphertext differs but decrypts identically", () => {
    const a = encrypt("same-input");
    const b = encrypt("same-input");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("same-input");
    expect(decrypt(b)).toBe("same-input");
  });

  it("passes plaintext through on decrypt (legacy rows)", () => {
    expect(decrypt("plain-legacy-value")).toBe("plain-legacy-value");
  });

  it("rejects tampered ciphertext (GCM auth tag)", () => {
    const enc = encrypt("secret");
    const tampered = enc.slice(0, -2) + (enc.endsWith("A") ? "B" : "A");
    expect(() => decrypt(tampered)).toThrow();
  });

  it("encryptField/decryptField pass null and undefined through", () => {
    expect(encryptField(null)).toBeNull();
    expect(encryptField(undefined)).toBeUndefined();
    expect(decryptField(null)).toBeNull();
    expect(decryptField(undefined)).toBeUndefined();
  });
});

describe("encryptAuthConfig / decryptAuthConfig", () => {
  it("round-trips token, password and header values; leaves username plaintext", () => {
    const cfg: SetupAuthConfig = {
      token: "bearer-tok",
      username: "admin@example.com",
      password: "s3cret",
      headers: { "X-Api-Key": "abc123", "X-Trace": "keep" },
    };
    const enc = encryptAuthConfig(cfg)!;
    expect(enc.token!.startsWith(ENC_PREFIX)).toBe(true);
    expect(enc.password!.startsWith(ENC_PREFIX)).toBe(true);
    expect(enc.headers!["X-Api-Key"].startsWith(ENC_PREFIX)).toBe(true);
    // username is a low-sensitivity identifier — never encrypted
    expect(enc.username).toBe("admin@example.com");

    const dec = decryptAuthConfig(enc)!;
    expect(dec).toEqual(cfg);
  });

  it("is idempotent — already-encrypted values are not double-encrypted", () => {
    const cfg: SetupAuthConfig = { token: "t", password: "p" };
    const once = encryptAuthConfig(cfg)!;
    const twice = encryptAuthConfig(once)!;
    expect(twice.token).toBe(once.token);
    expect(twice.password).toBe(once.password);
    expect(decryptAuthConfig(twice)).toEqual(cfg);
  });

  it("passes null/undefined through", () => {
    expect(encryptAuthConfig(null)).toBeNull();
    expect(encryptAuthConfig(undefined)).toBeNull();
    expect(decryptAuthConfig(null)).toBeNull();
  });

  it("decrypts a legacy plaintext authConfig unchanged", () => {
    const plain: SetupAuthConfig = { token: "plain", password: "plain2" };
    expect(decryptAuthConfig(plain)).toEqual(plain);
  });
});

describe("encryptSessionMetadata / decryptSessionMetadata", () => {
  it("encrypts only quickstartPassword, leaving email and other fields intact", () => {
    const meta: AgentSessionMetadata = {
      quickstartEmail: "viktor@example.com",
      quickstartPassword: "app-login-pw",
      quickstartSlug: "acme",
      credsProvided: true,
    };
    const enc = encryptSessionMetadata(meta)!;
    expect(enc.quickstartPassword!.startsWith(ENC_PREFIX)).toBe(true);
    expect(enc.quickstartEmail).toBe("viktor@example.com");
    expect(enc.quickstartSlug).toBe("acme");
    expect(enc.credsProvided).toBe(true);

    const dec = decryptSessionMetadata(enc)!;
    expect(dec).toEqual(meta);
  });

  it("is idempotent and order-independent (read-merge-rewrite cycle)", () => {
    const meta: AgentSessionMetadata = { quickstartPassword: "pw" };
    const once = encryptSessionMetadata(meta)!;
    const twice = encryptSessionMetadata(once)!;
    expect(twice.quickstartPassword).toBe(once.quickstartPassword);
    expect(decryptSessionMetadata(twice)!.quickstartPassword).toBe("pw");
  });

  it("no-ops when there is no quickstartPassword", () => {
    const meta: AgentSessionMetadata = { quickstartSlug: "x" };
    expect(encryptSessionMetadata(meta)).toBe(meta);
    expect(decryptSessionMetadata(meta)).toBe(meta);
  });

  it("passes null/undefined through", () => {
    expect(encryptSessionMetadata(null)).toBeNull();
    expect(encryptSessionMetadata(undefined)).toBeUndefined();
    expect(decryptSessionMetadata(null)).toBeNull();
  });
});
