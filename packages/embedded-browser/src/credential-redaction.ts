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

/** Values short enough that masking them would scrub ordinary prose. */
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
  isSecretKey: (key: string) => boolean = defaultIsSecretKey,
): CredentialScrubber {
  if (!credentials) return NOOP;

  const values = new Set<string>();
  for (const entry of Object.values(credentials)) {
    if (!entry) continue;
    for (const [key, value] of Object.entries(entry)) {
      if (typeof value !== "string") continue;
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
