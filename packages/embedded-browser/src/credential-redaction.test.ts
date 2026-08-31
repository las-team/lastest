import { describe, it, expect } from "vitest";
import {
  createCredentialScrubber,
  freezeCredentials,
  scrubDomSnapshot,
  scrubError,
  scrubNetworkRequests,
  defaultIsSecretKey,
  CREDENTIAL_MASK,
} from "./credential-redaction.js";

const CREDS = {
  vaultAdmin: {
    username: "svc-qa@acme.com",
    password: "hunter2-correct-horse",
    totpSecret: "JBSWY3DPEHPK3PXP",
  },
};

describe("createCredentialScrubber", () => {
  it("masks secret values in log lines", () => {
    const s = createCredentialScrubber(CREDS);
    expect(s.scrub("filled password hunter2-correct-horse into #pw")).toBe(
      `filled password ${CREDENTIAL_MASK} into #pw`,
    );
  });

  it("leaves non-secret fields alone", () => {
    // Masking a username would turn every log line mentioning the account
    // into dots and make failures unreadable. The storage layer makes the
    // same call when it keeps non-secret fields in the clear.
    const s = createCredentialScrubber(CREDS);
    expect(s.scrub("logged in as svc-qa@acme.com")).toBe(
      "logged in as svc-qa@acme.com",
    );
  });

  it("masks every occurrence, and every secret field", () => {
    const s = createCredentialScrubber(CREDS);
    const out = s.scrub(
      "hunter2-correct-horse then JBSWY3DPEHPK3PXP then hunter2-correct-horse",
    );
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("JBSWY3DPEHPK3PXP");
    expect(out.match(new RegExp(CREDENTIAL_MASK, "g"))).toHaveLength(3);
  });

  it("masks a containing value whole rather than leaving its prefix", () => {
    // Longest-first ordering: masking "pass" first would leave "word123"
    // dangling beside a mask and expose the longer secret's tail.
    const s = createCredentialScrubber({
      a: { password: "pass" },
      b: { password: "passwordLonger123" },
    });
    const out = s.scrub("value=passwordLonger123");
    expect(out).toBe(`value=${CREDENTIAL_MASK}`);
  });

  it("treats regex metacharacters in a secret literally", () => {
    const s = createCredentialScrubber({ a: { password: "a.*b+c(d)" } });
    expect(s.scrub("pw is a.*b+c(d) ok")).toBe(`pw is ${CREDENTIAL_MASK} ok`);
    // The pattern must not match anything else it would have as a regex.
    expect(s.scrub("axxxbbbcd")).toBe("axxxbbbcd");
  });

  it("skips values too short to mask without scrubbing prose", () => {
    const s = createCredentialScrubber({ a: { password: "ab" } });
    expect(s.active).toBe(false);
    expect(s.scrub("about")).toBe("about");
  });

  it("is inert when there are no credentials", () => {
    expect(createCredentialScrubber(undefined).active).toBe(false);
    expect(createCredentialScrubber({}).active).toBe(false);
    expect(createCredentialScrubber({ a: {} }).active).toBe(false);
    expect(createCredentialScrubber(undefined).scrub("anything")).toBe(
      "anything",
    );
  });
});

describe("defaultIsSecretKey", () => {
  it("recognises the secret-shaped field names", () => {
    for (const k of [
      "password",
      "Password",
      "totpSecret",
      "apiKey",
      "api_key",
      "accessToken",
      "pin",
    ]) {
      expect(defaultIsSecretKey(k)).toBe(true);
    }
  });

  it("does not claim ordinary identifiers", () => {
    for (const k of ["username", "email", "docId", "role", "tenant"]) {
      expect(defaultIsSecretKey(k)).toBe(false);
    }
  });
});

describe("scrubError", () => {
  it("scrubs the message and stack of a thrown Error", () => {
    // Playwright puts the fill() argument in the message when a locator
    // times out, which is the common real leak.
    const s = createCredentialScrubber(CREDS);
    const err = new Error(
      'locator.fill: Timeout 3000ms exceeded filling "hunter2-correct-horse"',
    );
    err.stack = `Error: filling "hunter2-correct-horse"\n    at test`;
    const out = scrubError(err, s) as Error;
    expect(out).toBeInstanceOf(Error);
    expect(out.message).not.toContain("hunter2");
    expect(out.stack).not.toContain("hunter2");
  });

  it("scrubs a thrown string and passes other values through", () => {
    const s = createCredentialScrubber(CREDS);
    expect(scrubError("hunter2-correct-horse", s)).toBe(CREDENTIAL_MASK);
    const obj = { code: 1 };
    expect(scrubError(obj, s)).toBe(obj);
  });

  it("returns the original error untouched when nothing matched", () => {
    const s = createCredentialScrubber(CREDS);
    const err = new Error("something unrelated failed");
    expect(scrubError(err, s)).toBe(err);
  });
});

describe("scrubDomSnapshot", () => {
  it("scrubs element text and selector values", () => {
    // A password input renders as dots in a screenshot; a DOM snapshot
    // capturing its `value` attribute does not.
    const s = createCredentialScrubber(CREDS);
    const snapshot = {
      elements: [
        {
          textContent: "signed in with hunter2-correct-horse",
          selectors: [
            { type: "css", value: '#pw[value="hunter2-correct-horse"]' },
            { type: "css", value: "#username" },
          ],
        },
      ],
    };
    const out = scrubDomSnapshot(snapshot, s);
    expect(JSON.stringify(out)).not.toContain("hunter2");
    expect(out.elements[0].selectors[1].value).toBe("#username");
    // Non-destructive: the input is untouched.
    expect(snapshot.elements[0].textContent).toContain("hunter2");
  });

  it("returns the snapshot as-is when inert", () => {
    const snapshot = { elements: [] };
    expect(
      scrubDomSnapshot(snapshot, createCredentialScrubber(undefined)),
    ).toBe(snapshot);
  });
});

describe("freezeCredentials", () => {
  it("freezes the map and each entry", () => {
    const frozen = freezeCredentials(CREDS);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.vaultAdmin)).toBe(true);
    expect(frozen.vaultAdmin.password).toBe(CREDS.vaultAdmin.password);
  });

  it("does not freeze the caller's object", () => {
    // The payload is reused across tests in one EB; freezing it in place
    // would make the second test's map immutable for reasons the first test
    // caused.
    const source = { a: { password: "x" } };
    freezeCredentials(source);
    expect(Object.isFrozen(source.a)).toBe(false);
  });

  it("yields an empty frozen map for undefined", () => {
    const frozen = freezeCredentials(undefined);
    expect(frozen).toEqual({});
    expect(Object.isFrozen(frozen)).toBe(true);
  });
});

describe("declared secret keys", () => {
  // The field's own `secret` flag is what decided encryption at rest. Before
  // it was carried on the wire, the EB re-guessed from the key name — so a
  // field the user marked secret and named `passphrase` was encrypted in the
  // database and printed in the clear here.
  const CREDS_ODD_NAMES = {
    vault: {
      username: "svc-qa@acme.com",
      passphrase: "correct-horse-battery",
      clientAssertion: "eyJhbGciOiJSUzI1NiJ9.payload.sig",
    },
  };

  it("masks a declared secret whose key matches no keyword hint", () => {
    expect(defaultIsSecretKey("passphrase")).toBe(false);
    expect(defaultIsSecretKey("clientAssertion")).toBe(false);

    const s = createCredentialScrubber(CREDS_ODD_NAMES, {
      secretKeys: { vault: ["passphrase", "clientAssertion"] },
    });
    const line = s.scrub(
      "sent correct-horse-battery and eyJhbGciOiJSUzI1NiJ9.payload.sig",
    );
    expect(line).not.toContain("correct-horse-battery");
    expect(line).not.toContain("eyJhbGciOiJSUzI1NiJ9");
  });

  it("leaves a declared non-secret in the clear", () => {
    // Masking the username would turn every log line mentioning the account
    // into dots and make failures unreadable.
    const s = createCredentialScrubber(CREDS_ODD_NAMES, {
      secretKeys: { vault: ["passphrase", "clientAssertion"] },
    });
    expect(s.scrub("logged in as svc-qa@acme.com")).toContain(
      "svc-qa@acme.com",
    );
  });

  it("masks a declared secret shorter than the keyword-guess floor", () => {
    // `pin` is in the hint list, but a 3-character PIN never reached the
    // keyword path because of the length floor. A declared secret has no floor.
    const s = createCredentialScrubber(
      { kiosk: { pin: "042" } },
      { secretKeys: { kiosk: ["pin"] } },
    );
    expect(s.scrub("entered 042")).toBe(`entered ${CREDENTIAL_MASK}`);
  });

  it("falls back to the keyword guess for a credential with no declared list", () => {
    // An older host sends no secretKeys at all; the guarantee narrows but does
    // not regress.
    const s = createCredentialScrubber(CREDS, {});
    expect(s.scrub("pw hunter2-correct-horse")).toContain(CREDENTIAL_MASK);
  });
});

describe("scrubNetworkRequests", () => {
  const scrubber = createCredentialScrubber(CREDS);

  it("masks the credential everywhere a request can carry it", () => {
    const [out] = scrubNetworkRequests(
      [
        {
          url: "https://app.test/login?p=hunter2-correct-horse",
          postData: "username=svc-qa%40acme.com&password=hunter2-correct-horse",
          responseBody: '{"token":"hunter2-correct-horse"}',
          requestHeaders: { authorization: "Basic hunter2-correct-horse" },
          responseHeaders: { "set-cookie": "s=hunter2-correct-horse" },
          errorText: "failed sending hunter2-correct-horse",
        },
      ],
      scrubber,
    );
    expect(JSON.stringify(out)).not.toContain("hunter2-correct-horse");
    // Header NAMES survive — masking them would break the network diff's keying.
    expect(out.requestHeaders).toHaveProperty("authorization");
    expect(out.responseHeaders).toHaveProperty("set-cookie");
  });

  it("leaves undefined fields undefined rather than masking them into strings", () => {
    const [out] = scrubNetworkRequests(
      [{ url: "https://app.test/x" }],
      scrubber,
    );
    expect(out.postData).toBeUndefined();
    expect(out.responseBody).toBeUndefined();
    expect(out.requestHeaders).toBeUndefined();
  });

  it("returns the array untouched when inert", () => {
    const list = [{ url: "https://app.test/x" }];
    expect(
      scrubNetworkRequests(list, createCredentialScrubber(undefined)),
    ).toBe(list);
  });
});
