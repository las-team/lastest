/**
 * Redact secrets from Playwright test source before it is rendered on a PUBLIC
 * page (e.g. the `/r/<slug>` share teaser). Test code frequently embeds real
 * auth material — a baked storage-state, a Supabase session JSON, hardcoded
 * bearer tokens — that must never appear on a shareable URL.
 *
 * This is a best-effort textual scrub, not a parser. It errs toward redacting:
 * a false positive shows a `•••` where a value used to be; a false negative
 * leaks a credential. When in doubt, mask.
 */

const MASK = "•••";

// Secret-shaped signatures used to decide whether a whole string literal should
// be collapsed. Matching any one is enough: JWTs (access/id tokens), Google
// OAuth tokens (`ya29.…` provider tokens), or a sensitive key immediately
// followed by a value delimiter (covers JSON keys like `"access_token":` even
// when the quotes are backslash-escaped inside an outer JS string).
const JWT = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/;
const GOOGLE_OAUTH = /ya29\.[A-Za-z0-9_-]{10,}/;
const SENSITIVE_KEY_ASSIGN =
  /(?:access_token|refresh_token|provider_token|id_token|client_secret|api[_-]?key|password|passwd|secret|bearer|authorization)["'`\\\s]*[:=]/i;

const SECRET_SIGNATURE = new RegExp(
  `${JWT.source}|${GOOGLE_OAUTH.source}|${SENSITIVE_KEY_ASSIGN.source}`,
  "i",
);

// A single-, double-, or backtick-quoted string literal. Inner escaped chars
// (`\"`, `\\`, `\n`, …) are consumed by `\\.` so an escaped quote never ends
// the literal early — this is what lets us swallow a whole JSON-in-a-string.
const STRING_LITERAL = /(["'`])((?:\\.|(?!\1)[\s\S])*)\1/g;

// A sensitive key followed by a quoted value: `password: "x"`, `"token":"y"`,
// or the backslash-escaped `\"refresh_token\":\"z\"` form. Masks the value,
// keeps the key and quoting so the shape of the code still reads as real.
const SENSITIVE_KEY_VALUE =
  /((?:access_token|refresh_token|provider_token|id_token|client_secret|api[_-]?key|password|passwd|secret|bearer|authorization|token)\\?["'`]?\s*[:=]\s*)(\\?["'`])(?:\\.|(?!\2)[\s\S])*?\2/gi;

// Playwright typed-in payloads: the second string argument of `.fill()` /
// `.type()` is whatever was recorded at authoring time (emails, passwords).
const FILL_TYPE_ARG =
  /(\.(?:fill|type)\(\s*(['"`])(?:\\.|(?!\2).)*\2\s*,\s*)(['"`])(?:\\.|(?!\3).)*\3/g;

/**
 * Return `code` with embedded secrets masked. Safe to render publicly.
 */
export function redactCodeSecrets(code: string): string {
  let out = code;

  // 1. Collapse any string literal whose contents are secret-shaped. This is
  //    the decisive pass for baked session blobs: it also removes the PII
  //    (email, user id, avatar url) riding alongside the tokens.
  out = out.replace(STRING_LITERAL, (whole, quote: string, body: string) =>
    SECRET_SIGNATURE.test(body) ? `${quote}${MASK}${quote}` : whole,
  );

  // 2. Mask values attached to a sensitive key that survived pass 1 (e.g. a
  //    lone `{ password: "hunter2" }` where the key sits outside the literal).
  out = out.replace(
    SENSITIVE_KEY_VALUE,
    (_m, keyOpen: string, valQuote: string) => {
      return `${keyOpen}${valQuote}${MASK}${valQuote}`;
    },
  );

  // 3. Belt-and-braces: scrub any bare JWT / Google OAuth token left in the
  //    open (unquoted URLs, comments, template fragments).
  out = out
    .replace(new RegExp(JWT.source, "g"), `eyJ${MASK}`)
    .replace(new RegExp(GOOGLE_OAUTH.source, "g"), `ya29.${MASK}`);

  // 4. Redact recorded `.fill()` / `.type()` payloads.
  out = out.replace(FILL_TYPE_ARG, `$1$3${MASK}$3`);

  return out;
}
