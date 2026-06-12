/**
 * Run-failure classifier.
 *
 * Test runs fail for many reasons that are indistinguishable to a user when
 * the only thing surfaced is a raw Playwright stack or a bare
 * "Test execution timed out". This maps the runner error + captured network
 * signals to a human-readable category, headline, and (when we have one) an
 * actionable suggestion — so the failure toast and error panel can tell a
 * user *why* a run failed (bot challenge, DNS, connection refused, …) instead
 * of a cryptic string.
 *
 * Pure + dependency-free (other than the NetworkRequest type) so it runs on
 * both the server (executor) and the client (test detail UI).
 */
import type { NetworkRequest } from "@/lib/db/schema";

export type RunErrorCategory =
  | "bot_challenge"
  | "dns"
  | "connection_refused"
  | "connection_timeout"
  | "tls"
  | "navigation_timeout"
  | "runner_timeout"
  | "runner_disconnected"
  | "unknown";

export interface ClassifiedRunError {
  category: RunErrorCategory;
  /** Short human-readable headline. Always contains enough of the original
   *  signal ("timed out", "disconnected") that downstream substring
   *  heuristics keep working. */
  title: string;
  /** One-line actionable suggestion, when we have one. */
  suggestion?: string;
}

export interface ClassifyInput {
  errorMessage?: string | null;
  consoleErrors?: string[] | null;
  networkRequests?: NetworkRequest[] | null;
  /** Set when the runner reported a bare timeout/disconnect with no result
   *  payload (so there is no Playwright error or network trace to inspect). */
  runnerStatus?: "timeout" | "disconnected" | null;
}

const SUGGESTIONS: Record<RunErrorCategory, string | undefined> = {
  bot_challenge:
    "The site served a bot/anti-automation challenge (e.g. Cloudflare). Set a custom User-Agent under Settings → Playwright, or point the test at a non-protected environment.",
  dns: "The hostname couldn't be resolved. Check the base URL for typos and that the site is publicly reachable from the runner.",
  connection_refused:
    "The server refused the connection. Make sure the target URL is running and reachable from the test runner.",
  connection_timeout:
    "The connection timed out. The site may be slow, down, or blocking the runner's network.",
  tls: "The site's TLS/SSL certificate couldn't be verified. Check the certificate or use a trusted environment.",
  navigation_timeout:
    "The page took too long to load. Increase the navigation timeout under Settings → Playwright, or confirm the URL loads.",
  runner_timeout: undefined,
  runner_disconnected: undefined,
  unknown: undefined,
};

const CHALLENGE_BODY_MARKERS = [
  "just a moment",
  "attention required",
  "challenge-platform",
  "cf-browser-verification",
  "checking your browser",
  "enable javascript and cookies to continue",
  "ddos protection by",
  "/cdn-cgi/challenge",
];

function looksLikeCloudflare(req: NetworkRequest): boolean {
  const headers = {
    ...(req.responseHeaders ?? {}),
  } as Record<string, string>;
  const lowerKeys = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v ?? "")]),
  );
  if ("cf-ray" in lowerKeys || "cf-mitigated" in lowerKeys) return true;
  const server = (lowerKeys["server"] ?? "").toLowerCase();
  if (server.includes("cloudflare")) return true;
  const body = (req.responseBody ?? "").slice(0, 4000).toLowerCase();
  return CHALLENGE_BODY_MARKERS.some((m) => body.includes(m));
}

/** A blocking challenge: the main document (or any request) came back with a
 *  challenge status from an anti-bot service. */
function detectBotChallenge(
  networkRequests?: NetworkRequest[] | null,
): boolean {
  if (!networkRequests || networkRequests.length === 0) return false;
  const CHALLENGE_STATUS = new Set([403, 429, 503]);
  return networkRequests.some((req) => {
    const isDoc =
      req.resourceType === "document" || req.resourceType === "navigation";
    const challengeStatus = CHALLENGE_STATUS.has(req.status);
    if (challengeStatus && looksLikeCloudflare(req)) return true;
    // A document request that failed/got a challenge status against a
    // Cloudflare-looking origin is the strongest signal.
    return isDoc && challengeStatus && looksLikeCloudflare(req);
  });
}

/**
 * Classify a run failure. Returns `null` when the failure is an ordinary
 * test/assertion failure (selector not found, content mismatch, …) — those
 * carry a meaningful message already and should be shown verbatim.
 */
export function classifyRunError(
  input: ClassifyInput,
): ClassifiedRunError | null {
  const { runnerStatus } = input;

  if (runnerStatus === "timeout") {
    return {
      category: "runner_timeout",
      title:
        "The test ran longer than the allowed time and was stopped (timed out).",
      suggestion:
        "Increase the test timeout under Settings → Playwright, or check the run for a step that hangs.",
    };
  }
  if (runnerStatus === "disconnected") {
    return {
      category: "runner_disconnected",
      title:
        "The browser runner disconnected before the test finished. This is usually transient — try running again.",
    };
  }

  const haystacks: string[] = [];
  if (input.errorMessage) haystacks.push(input.errorMessage);
  for (const req of input.networkRequests ?? []) {
    if (req.errorText) haystacks.push(req.errorText);
  }
  for (const c of input.consoleErrors ?? []) haystacks.push(c);
  const text = haystacks.join("\n");

  // Bot challenge is checked first: a Cloudflare interstitial typically
  // surfaces as a navigation timeout, so it would otherwise be misread.
  if (detectBotChallenge(input.networkRequests)) {
    return {
      category: "bot_challenge",
      title: "The site blocked the test with a bot/anti-automation challenge.",
      suggestion: SUGGESTIONS.bot_challenge,
    };
  }

  const tests: Array<[RegExp, RunErrorCategory, string]> = [
    [
      /ERR_NAME_NOT_RESOLVED|ENOTFOUND|getaddrinfo/i,
      "dns",
      "The site's hostname couldn't be resolved (DNS lookup failed).",
    ],
    [
      /ERR_CONNECTION_REFUSED|ECONNREFUSED/i,
      "connection_refused",
      "The server refused the connection — the test couldn't connect to the site.",
    ],
    [
      /ERR_CERT|ERR_SSL|ERR_BAD_SSL|SSL certificate|certificate has expired|self.signed certificate/i,
      "tls",
      "The site's TLS/SSL certificate couldn't be verified.",
    ],
    [
      /ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT|ETIMEDOUT|ERR_CONNECTION_RESET|ECONNRESET/i,
      "connection_timeout",
      "The connection to the site timed out or was reset.",
    ],
    [
      /Timeout .*exceeded|navigation timeout|Timeout exceeded while|page\.goto: Timeout|waiting for navigation/i,
      "navigation_timeout",
      "The page took too long to load (navigation timed out).",
    ],
  ];

  for (const [re, category, title] of tests) {
    if (re.test(text)) {
      return { category, title, suggestion: SUGGESTIONS[category] };
    }
  }

  return null;
}

/**
 * Render a classified error into a single user-facing string for storage in
 * `errorMessage` / display in a toast. Keeps a trimmed slice of the raw
 * technical message for debugging when it adds information.
 */
export function formatClassifiedError(
  c: ClassifiedRunError,
  rawMessage?: string | null,
): string {
  const parts = [c.title];
  if (c.suggestion) parts.push(c.suggestion);
  let out = parts.join(" ");
  const raw = (rawMessage ?? "").split("\n")[0]?.trim();
  if (raw && !out.includes(raw)) {
    const trimmed = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
    out += ` (details: ${trimmed})`;
  }
  return out;
}
