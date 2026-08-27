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
  encryptCredentialFields,
  decryptCredentialFields,
  maskCredentialFields,
} from "./crypto-fields";
import type {
  SetupAuthConfig,
  AgentSessionMetadata,
  CredentialField,
} from "./db/schema";

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

  it("encrypts qaAuthContext (Explore sign-in prose) alongside the password", () => {
    const meta: AgentSessionMetadata = {
      qaAuthContext: "Log in with demo@acme.com / hunter2, then tap Continue",
      quickstartPassword: "pw",
      qaTargetUrl: "https://app.acme.test",
    };
    const enc = encryptSessionMetadata(meta)!;
    expect(enc.qaAuthContext!.startsWith(ENC_PREFIX)).toBe(true);
    expect(enc.quickstartPassword!.startsWith(ENC_PREFIX)).toBe(true);
    expect(enc.qaTargetUrl).toBe("https://app.acme.test");

    const twice = encryptSessionMetadata(enc)!;
    expect(twice.qaAuthContext).toBe(enc.qaAuthContext);

    const dec = decryptSessionMetadata(enc)!;
    expect(dec).toEqual(meta);
  });

  it("passes null/undefined through", () => {
    expect(encryptSessionMetadata(null)).toBeNull();
    expect(encryptSessionMetadata(undefined)).toBeUndefined();
    expect(decryptSessionMetadata(null)).toBeNull();
  });
});

describe("repo_credentials field crypto", () => {
  const fields: CredentialField[] = [
    { key: "username", value: "svc-qa@acme.com", secret: false },
    { key: "password", value: "hunter2-🔐", secret: true },
    { key: "totpSecret", value: "JBSWY3DPEHPK3PXP", secret: true },
  ];

  it("encrypts only the secret fields and round-trips them", () => {
    const enc = encryptCredentialFields(fields);
    const byKey = Object.fromEntries(enc.map((f) => [f.key, f]));

    // Non-secret values stay readable so the list can render them without a
    // decrypt per row.
    expect(byKey.username.value).toBe("svc-qa@acme.com");
    expect(byKey.password.value.startsWith(ENC_PREFIX)).toBe(true);
    expect(byKey.totpSecret.value.startsWith(ENC_PREFIX)).toBe(true);
    expect(byKey.password.value).not.toContain("hunter2");

    expect(decryptCredentialFields(enc)).toEqual(fields);
  });

  it("never double-encrypts an already-encrypted value", () => {
    // The update path re-submits stored ciphertext for any secret the editor
    // left untouched, so encrypt-on-write has to be idempotent.
    const once = encryptCredentialFields(fields);
    const twice = encryptCredentialFields(once);
    expect(twice).toEqual(once);
    expect(decryptCredentialFields(twice)).toEqual(fields);
  });

  it("passes legacy plaintext through on read", () => {
    // A row written before field crypto, or by a future import path.
    const legacy: CredentialField[] = [
      { key: "password", value: "plain-text-password", secret: true },
    ];
    expect(decryptCredentialFields(legacy)).toEqual(legacy);
  });

  it("does not mutate its input", () => {
    const input = fields.map((f) => ({ ...f }));
    encryptCredentialFields(input);
    expect(input).toEqual(fields);
  });

  it("masks secret values while keeping the field shape", () => {
    // This is what leaves the server for the browser. Values are write-only:
    // no read path returns a secret's plaintext.
    const masked = maskCredentialFields(encryptCredentialFields(fields));
    expect(masked.map((f) => f.key)).toEqual([
      "username",
      "password",
      "totpSecret",
    ]);
    expect(masked.find((f) => f.key === "username")?.value).toBe(
      "svc-qa@acme.com",
    );
    for (const f of masked.filter((f) => f.secret)) {
      expect(f.value).toBe("");
    }
    // Neither plaintext nor ciphertext survives the mask.
    const serialized = JSON.stringify(masked);
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain(ENC_PREFIX);
  });

  it("treats null / undefined / empty as an empty field list", () => {
    expect(encryptCredentialFields(null)).toEqual([]);
    expect(decryptCredentialFields(undefined)).toEqual([]);
    expect(maskCredentialFields([])).toEqual([]);
  });
});
