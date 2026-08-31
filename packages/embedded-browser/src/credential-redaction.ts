/**
 * Scrub credential plaintext out of anything the EB sends back.
 *
 * Storing a secret safely and then printing it is not storing it safely. The
 * EB is the only process that ever holds a decrypted credential, and it holds
 * it for the duration of one run — which also makes it the only process that
 * *can* scrub its own output. Three consumers:
 *
 *   - `logFn` / `stepLogger` lines: a test that echoes what it filled.
 *   - thrown error messages: Playwright puts the fill() argument in the
 *     message when a locator times out.
 *   - DOM snapshots: a password `<input>` renders as dots in a screenshot, but
 *     its `value` attribute and surrounding text do not.
 *
 * Nothing here is a substitute for not persisting credentials in the first
 * place (`assignedVariables` and friends) — it is the second line, for the
 * paths where the value legitimately passes through in the clear.
 */

export const CREDENTIAL_MASK = "••••";

/**
 * Values short enough that masking them would scrub ordinary prose.
 *
 * Applies ONLY to keyword-guessed secrets. A field the user explicitly marked
 * secret is masked at any length — otherwise a 3-character PIN, which the hint
 * list names, would never be masked, and the rule would be invisible at the
 * point where a user sets one.
 */
const MIN_SCRUBBABLE_LENGTH = 4;

/**
 * A reusable scrubber over one run's secret values. Build it once per run and
 * pass it down; `scrub` is a no-op function when there is nothing to hide, so
 * call sites need no conditionals.
 */
export interface CredentialScrubber {
  scrub: (text: string) => string;
  /** True when at least one value is being watched for. */
  active: boolean;
}

const NOOP: CredentialScrubber = { scrub: (t) => t, active: false };

export interface CredentialScrubberOptions {
  /**
   * Which keys are secret, per credential name, as declared by the user when
   * the credential was created. Authoritative when present — see the note in
   * `createCredentialScrubber`. Absent for older hosts, which fall back to the
   * keyword guess below.
   */
  secretKeys?: Record<string, string[]>;
  /** Fallback used only when `secretKeys` has no entry for a credential. */
  isSecretKey?: (key: string) => boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a scrubber for the secret values in a `credentials` payload.
 *
 * Only fields whose key looks secret are masked. A username is a credential
 * field, but masking it would turn every log line mentioning an email address
 * into dots and make failures unreadable — the same call the storage layer
 * makes when it keeps non-secret fields in the clear.
 */
export function createCredentialScrubber(
  credentials: Record<string, Record<string, string>> | undefined,
  options: CredentialScrubberOptions | ((key: string) => boolean) = {},
): CredentialScrubber {
  if (!credentials) return NOOP;

  const opts: CredentialScrubberOptions =
    typeof options === "function" ? { isSecretKey: options } : options;
  const isSecretKey = opts.isSecretKey ?? defaultIsSecretKey;
  const declared = opts.secretKeys;

  const values = new Set<string>();
  for (const [name, entry] of Object.entries(credentials)) {
    if (!entry) continue;
    // The field's own `secret` flag when the host sent it. It is authoritative
    // — it is what decided encryption at rest — and the keyword guess below
    // cannot reproduce it: `passphrase`, `vaultCode` and `clientAssertion` all
    // match no hint, so a field the user deliberately marked secret would be
    // encrypted in the database and printed in the clear here.
    const declaredForEntry = declared?.[name];
    for (const [key, value] of Object.entries(entry)) {
      if (typeof value !== "string" || value.length === 0) continue;
      if (declaredForEntry) {
        // Declared list present: it is the whole answer, at any length.
        if (declaredForEntry.includes(key)) values.add(value);
        continue;
      }
      if (value.length < MIN_SCRUBBABLE_LENGTH) continue;
      if (!isSecretKey(key)) continue;
      values.add(value);
    }
  }
  if (values.size === 0) return NOOP;

  // Longest first, so a value that contains another is masked whole rather
  // than leaving its unique prefix visible around an inner mask.
  const pattern = new RegExp(
    [...values]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join("|"),
    "g",
  );

  return {
    active: true,
    scrub: (text: string) =>
      typeof text === "string" ? text.replace(pattern, CREDENTIAL_MASK) : text,
  };
}

const SECRET_KEY_HINTS = [
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "key",
  "pin",
  "otp",
  "totp",
];

/**
 * Whether a field key names something that must never be printed. Mirrors the
 * host-side key list in `src/lib/security/redact.ts`; kept local because the
 * EB package must not depend on the app.
 */
export function defaultIsSecretKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_KEY_HINTS.some((hint) => lower.includes(hint));
}

/** Scrub an error's message in place-ish, returning a new Error when needed. */
export function scrubError(
  err: unknown,
  scrubber: CredentialScrubber,
): unknown {
  if (!scrubber.active) return err;
  if (err instanceof Error) {
    const scrubbed = scrubber.scrub(err.message);
    if (scrubbed === err.message) return err;
    const next = new Error(scrubbed);
    next.stack = err.stack ? scrubber.scrub(err.stack) : undefined;
    next.name = err.name;
    return next;
  }
  if (typeof err === "string") return scrubber.scrub(err);
  return err;
}

/**
 * Scrub the text-bearing parts of a DOM snapshot: element text, and any
 * selector whose value embeds a typed-in string (`input[value="hunter2"]`,
 * `text=hunter2`).
 */
export function scrubDomSnapshot<
  T extends {
    elements: Array<{
      textContent?: string;
      selectors: Array<{ type: string; value: string }>;
    }>;
  },
>(snapshot: T, scrubber: CredentialScrubber): T {
  if (!scrubber.active) return snapshot;
  return {
    ...snapshot,
    elements: snapshot.elements.map((el) => ({
      ...el,
      textContent:
        el.textContent === undefined
          ? el.textContent
          : scrubber.scrub(el.textContent),
      selectors: el.selectors.map((s) => ({
        ...s,
        value: scrubber.scrub(s.value),
      })),
    })),
  };
}

/**
 * Deep-freeze the injected object so a test body can't mutate the credential
 * map other tests in the same EB will see. Cheap, and it makes the parameter
 * behave like the read-only view of repo config that it is.
 */
export function freezeCredentials(
  credentials: Record<string, Record<string, string>> | undefined,
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [name, entry] of Object.entries(credentials ?? {})) {
    out[name] = Object.freeze({ ...entry });
  }
  return Object.freeze(out);
}

/**
 * Scrub every text-bearing field of a captured network request.
 *
 * The single most certain place a plaintext credential ends up: `postData` on
 * a form submit, the JSON body of an API login, and the bearer token that
 * comes back in `responseHeaders`. All of it is persisted for the `network`
 * check layer, so scrubbing the logs and leaving this alone would undo most of
 * the point.
 *
 * Header *values* are scrubbed, not header names — a masked name would break
 * the network diff's keying for no gain.
 */
export function scrubNetworkRequests<
  T extends {
    url: string;
    errorText?: string;
    requestHeaders?: Record<string, string>;
    responseHeaders?: Record<string, string>;
    postData?: string;
    responseBody?: string;
  },
>(requests: T[], scrubber: CredentialScrubber): T[] {
  if (!scrubber.active) return requests;
  const headers = (h: Record<string, string> | undefined) => {
    if (!h) return h;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(h)) {
      out[k] = typeof v === "string" ? scrubber.scrub(v) : v;
    }
    return out;
  };
  return requests.map((r) => ({
    ...r,
    // A credential submitted as a query parameter is in the URL itself.
    url: scrubber.scrub(r.url),
    errorText:
      r.errorText === undefined ? r.errorText : scrubber.scrub(r.errorText),
    requestHeaders: headers(r.requestHeaders),
    responseHeaders: headers(r.responseHeaders),
    postData:
      r.postData === undefined ? r.postData : scrubber.scrub(r.postData),
    responseBody:
      r.responseBody === undefined
        ? r.responseBody
        : scrubber.scrub(r.responseBody),
  }));
}
