/**
 * QuickStart Scout — single AI loop with Playwright MCP that:
 *   - mode 'public': browses the landing page + first few public routes,
 *     classifies the auth flow as `email_password | magic_link_only |
 *     oauth_only | captcha_gated | otp | no_public_register` and emits the
 *     concept + DOM-discovered nav links.
 *   - mode 'authed': replays the stored auth setup, then walks the in-app
 *     surface via DOM-discovered nav + safe-CTA candidates.
 *
 * The classification table mirrors `gtm-lastest-saas-demo`'s Phase-3
 * `AUTH_AUTOMATABLE` table verbatim — it is the source of truth for whether
 * Test 1 (auth setup) gets built at all.
 */

import * as queries from "@/lib/db/queries";
import { generateWithAI, type GenerateWithAIOptions } from "@/lib/ai";
import type { AIProviderConfig } from "@/lib/ai/types";
import type { MCPServerConfig } from "@/lib/ai/mcp-bridge";
import { getAIConfig } from "./agent-context";
import type {
  QuickstartPublicScout,
  QuickstartAuthedScout,
  QuickstartBusinessInteraction,
} from "@/lib/db/schema";

/**
 * Apply the EB-aware MCP wiring used by healer/generator. When a CDP endpoint
 * is provided, both the SDK-native MCP path and the bridge path get pointed at
 * a dedicated containerized browser instead of spawning a local Chromium that
 * fights for the user-data-dir held by any ambient Playwright MCP process
 * (e.g. the user's terminal Claude session). Strict mode + an explicit
 * disallowedTools list also stops the SDK from trying to fall back to WebFetch
 * (which it can't get permission for in this headless context).
 */
function applyScoutMcpWiring(
  config: AIProviderConfig,
  cdpEndpoint: string | undefined,
): Pick<GenerateWithAIOptions, "useMCP" | "mcpConfig"> {
  // A CDP endpoint (Embedded Browser) is mandatory — without it @playwright/mcp
  // launches Chromium in THIS host process, running the scout's browser actions
  // outside the sandbox. Callers must claim an EB first.
  if (!cdpEndpoint) {
    throw new Error(
      "applyScoutMcpWiring requires a cdpEndpoint — refusing to launch a host-process browser. Claim an Embedded Browser first.",
    );
  }
  const mcpArgs = [
    "@playwright/mcp@latest",
    "--cdp-endpoint",
    cdpEndpoint,
    "--headless",
  ];
  const playwrightServer: MCPServerConfig = { command: "npx", args: mcpArgs };

  if (config.provider === "claude-agent-sdk") {
    config.agentSdkStrictMcpConfig = true;
    config.agentSdkMcpServers = { playwright: playwrightServer };
    config.agentSdkAllowedTools = ["mcp__playwright__*"];
    config.agentSdkDisallowedTools = [
      "Bash",
      "Write",
      "Edit",
      "NotebookEdit",
      "WebFetch",
    ];
    // SDK path consumes the mcpServers above; bridge path is unused.
    return { useMCP: false };
  }

  return {
    useMCP: true,
    mcpConfig: {
      servers: { playwright: playwrightServer },
      cdpEndpoint,
    },
  };
}

const PUBLIC_SCOUT_SYSTEM_PROMPT = `You are a web app reconnaissance agent. Your job is to (1) describe what a SaaS does, (2) extract its primary business interaction, and (3) classify whether its sign-up flow is automatable.

Use Playwright MCP browser tools (browser_navigate, browser_snapshot, browser_click) to:
1. Visit the base URL.
2. Capture the tagline and concept from the hero (one to two sentences, in your own words — do NOT invent features that aren't on the page).
3. Read \`<a href>\` paths from the navigation; collect the public ones.
4. Extract the **primary business interaction** the product is built around. From the hero \`h1\` + supporting paragraph + the most-prominent visible CTA button, derive:
   - primaryInputLabel: the visible label / placeholder of the input the founder's hero CTA points at (e.g. "Paste a startup idea", "Search anything", "Enter a URL"). If no input is visible publicly, return null.
   - primaryCtaLabel: the literal text of the hero CTA button (e.g. "Validate idea", "Generate brief", "Run search").
   - demoInputValue: a SAFE additive demo string to type into primaryInputLabel that exercises the product's core function. Examples: "AI-powered birthday-card generator for parents of 3-7 year olds" for an idea-validator, "https://example.com/article" for a URL summariser, "best coffee shops in Berlin" for a search tool. NEVER pick a value that triggers destructive actions, real payments, outbound messaging on the founder's behalf, or scans of real third-party accounts.
5. Find the registration page by examining the landing page DOM ONLY. Look for any visible \`<a>\` or \`<button>\` whose visible text matches /sign ?up|register|create.+account|get started|join (free|now|us)/i. Accept both same-origin links (href starts with /) AND cross-subdomain links (e.g. https://auth.example.com/register, https://app.example.com/signup). Click the first match and snapshot the destination. NEVER guess paths like /signup, /register, /join — if no CTA exists in the DOM, return registerPath: null and classification: "no_public_register". Record registerPath as either a relative path starting with / (same-origin) or the FULL absolute URL (cross-subdomain, e.g. "https://auth.example.com/register"). NEVER mix the two formats (do not prefix a path with a partial URL).
6. Snapshot the register page and classify the sign-up flow.
7. Find the LOGIN page the same DOM-only way (link/button whose visible text matches /sign ?in|log ?in/i). Record loginPath as either a relative path starting with / OR the FULL absolute URL — same format rules as registerPath; null if none found. Note whether the login form exposes email + password fields.
8. Detect the auth library + its REST sign-in endpoint when actually visible: footer text like "SECURED BY BETTER AUTH", a login form whose action is under /api/auth/, or SDK hints in the page source (Firebase, Supabase, Clerk, NextAuth, Lucia). Report authLibrary (one of better-auth | nextauth | supabase | firebase | clerk | lucia | unknown) and apiLoginEndpoint (the sign-in REST path you SAW, e.g. "/api/auth/sign-in/email" for better-auth; null if you didn't see one — never guess).
9. Report tokenLocation best-effort from the detected library: better-auth/nextauth/lucia → cookie; firebase/clerk → indexeddb; supabase → localstorage; otherwise unknown.

CLASSIFICATION TABLE (pick ONE, in priority order — if multiple apply, pick the first match):

| Signal in snapshot | classification | authAutomatable |
|---|---|---|
| Browser failed to load / page returned no content | unknown | false |
| Register page is behind login / 404 / not reachable | no_public_register | false |
| iframe from google.com/recaptcha, hcaptcha.com, cloudflare.com challenge | captcha_gated | false |
| textbox "Phone" or visible OTP step | otp | false |
| Only OAuth buttons (Google / GitHub / Apple / SSO) | oauth_only | false |
| textbox "Email" only + button "Send magic link" / "Continue" | magic_link_only | false |
| textbox "Email" + textbox "Password" + submit button | email_password | true |
| Register is oauth-only / magic-link / gated / unreachable, BUT a conventional email + password LOGIN form exists | login_email_password | false |

OVERRIDE: if you would otherwise classify the REGISTER flow as oauth_only / magic_link_only / captcha_gated / otp / no_public_register, but the site ALSO has a standard email + password LOGIN form, classify as "login_email_password" instead. Signup is not automatable there, but login IS — when the user supplies their own credentials.

You MUST have actually loaded a register page (or confirmed no such page exists by following step 4) before classifying as anything other than "no_public_register" or "unknown". If the browser failed, you could not snapshot the landing page, or you have no concrete observations, return "classification": "unknown".

Return STRICT JSON (no markdown, no prose), shape:
{
  "tagline": "string or null",
  "concept": "1-2 sentence description, no marketing fluff",
  "navLinks": [{ "path": "/features", "label": "Features" }, ...],
  "registerPath": "/sign-up | https://auth.example.com/register | null",
  "loginPath": "/login | https://auth.example.com/sign-in | null",
  "apiLoginEndpoint": "/api/auth/sign-in/email | null",
  "authLibrary": "better-auth | nextauth | supabase | firebase | clerk | lucia | unknown",
  "tokenLocation": "cookie | localstorage | indexeddb | sessionstorage | unknown",
  "classification": "email_password | login_email_password | magic_link_only | oauth_only | captcha_gated | otp | no_public_register | unknown",
  "authAutomatable": true | false,
  "cookieBannerSelectorHint": "optional — if you saw a cookie banner, the button label that dismisses it",
  "businessInteraction": {
    "primaryInputLabel": "Paste a startup idea | null",
    "primaryCtaLabel": "Validate idea | null",
    "demoInputValue": "AI birthday-card generator for parents of 3-7yos | null"
  },
  "friction": [{ "kind": "cookie_overlap | slow_route | console_error | ...", "note": "string" }]
}`;

const AUTHED_SCOUT_SYSTEM_PROMPT = `You are a web app reconnaissance agent operating inside an authenticated browser session. The seed test below has already logged you in using the demo credentials.

Use Playwright MCP browser tools to:
1. Run the seed test FIRST to authenticate.
2. Navigate to the base URL.
3. Read in-app navigation links from \`nav a[href]\`, \`aside a[href]\`, \`[role="navigation"] a[href]\`, \`header a[href]\`. Filter out logout/destroy links.
4. Visit two of those links and observe what loads.
5. Identify additive primary CTAs whose label matches /^(create|new|add|view|open|explore|browse|start|continue|get started)\\b/i. NEVER include destructive CTAs (delete, pay, subscribe, upgrade, scan, import, sync, send).

Return STRICT JSON (no markdown), shape:
{
  "inAppNavLinks": [{ "path": "/dashboard", "label": "Dashboard" }, ...],
  "safeCtaCandidates": [{ "label": "Create project", "selectorHint": "button with name 'Create project'" }, ...],
  "observedRoutes": ["/dashboard", "/projects"],
  "friction": [{ "kind": "string", "note": "string" }]
}`;

/** Return the first balanced {...} or [...] substring, honoring string literals
 *  and escapes so braces inside strings don't throw off the depth count. Returns
 *  null when no balanced object/array is present. */
function firstBalancedJson(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start === -1) return null;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/**
 * Extract a JSON value from a model response. The response may wrap the JSON in
 * a markdown fence and/or append a trailing summary sentence after the closing
 * brace — the claude-agent-sdk final message routinely does the latter, which a
 * strict `JSON.parse` rejects with "Unexpected non-whitespace character after
 * JSON". Strategy:
 *   1. Prefer fenced ```json … ``` content when present.
 *   2. Try a strict parse of the trimmed candidate (clean case).
 *   3. Fall back to the first balanced {...}/[...] slice — tolerates leading
 *      AND trailing prose around an otherwise-valid object.
 */
function extractJson(response: string): unknown {
  const fence = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const candidate = (fence?.[1] ?? response).trim();
  try {
    return JSON.parse(candidate);
  } catch (err) {
    const sliced = firstBalancedJson(candidate);
    if (sliced === null) throw err;
    return JSON.parse(sliced);
  }
}

function safeArray<T>(
  value: unknown,
  mapper: (item: unknown) => T | null,
): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value) {
    const mapped = mapper(item);
    if (mapped !== null) out.push(mapped);
  }
  return out;
}

function asNavLink(item: unknown): { path: string; label: string } | null {
  if (!item || typeof item !== "object") return null;
  const obj = item as Record<string, unknown>;
  const path = typeof obj.path === "string" ? obj.path : null;
  const label = typeof obj.label === "string" ? obj.label : "";
  if (!path || !path.startsWith("/")) return null;
  return { path, label };
}

function asFriction(item: unknown): { kind: string; note: string } | null {
  if (!item || typeof item !== "object") return null;
  const obj = item as Record<string, unknown>;
  if (typeof obj.kind !== "string" || typeof obj.note !== "string") return null;
  return { kind: obj.kind, note: obj.note };
}

function asCta(item: unknown): { label: string; selectorHint?: string } | null {
  if (!item || typeof item !== "object") return null;
  const obj = item as Record<string, unknown>;
  if (typeof obj.label !== "string") return null;
  return {
    label: obj.label,
    selectorHint:
      typeof obj.selectorHint === "string" ? obj.selectorHint : undefined,
  };
}

function asBusinessInteraction(
  value: unknown,
): QuickstartBusinessInteraction | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  const out: QuickstartBusinessInteraction = {};
  if (
    typeof obj.primaryInputLabel === "string" &&
    obj.primaryInputLabel.length > 0
  ) {
    out.primaryInputLabel = obj.primaryInputLabel.slice(0, 200);
  }
  if (
    typeof obj.primaryCtaLabel === "string" &&
    obj.primaryCtaLabel.length > 0
  ) {
    out.primaryCtaLabel = obj.primaryCtaLabel.slice(0, 200);
  }
  if (typeof obj.demoInputValue === "string" && obj.demoInputValue.length > 0) {
    out.demoInputValue = obj.demoInputValue.slice(0, 500);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function classify(value: unknown): QuickstartPublicScout["classification"] {
  const allowed = [
    "email_password",
    "login_email_password",
    "magic_link_only",
    "oauth_only",
    "captcha_gated",
    "otp",
    "no_public_register",
    "unknown",
  ] as const;
  return (allowed as readonly string[]).includes(value as string)
    ? (value as QuickstartPublicScout["classification"])
    : "unknown";
}

function asTokenLocation(
  value: unknown,
): QuickstartPublicScout["tokenLocation"] {
  const allowed = [
    "cookie",
    "localstorage",
    "indexeddb",
    "sessionstorage",
    "unknown",
  ] as const;
  return (allowed as readonly string[]).includes(value as string)
    ? (value as QuickstartPublicScout["tokenLocation"])
    : undefined;
}

/** Normalise a scout-reported path/URL: a relative path (starts with /) or a full
 *  https URL passes through; anything else (guessed bare word, partial URL) → null. */
function asPathOrUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value.startsWith("/")) return value;
  if (/^https?:\/\//i.test(value)) return value;
  return null;
}

export interface QuickstartScoutPublicResult {
  data: QuickstartPublicScout;
  promptLogId?: string;
}

export interface QuickstartScoutAuthedResult {
  data: QuickstartAuthedScout;
  promptLogId?: string;
}

export async function runQuickstartScoutPublic(
  repositoryId: string,
  baseUrl: string,
  options?: { onLogCreated?: (logId: string) => void; cdpEndpoint?: string },
): Promise<QuickstartScoutPublicResult> {
  const settings = await queries.getAISettings(repositoryId);
  const config = getAIConfig(settings);
  const mcpOpts = applyScoutMcpWiring(config, options?.cdpEndpoint);

  const prompt = `Reconnoiter ${baseUrl}. Follow the workflow in the system prompt and return strict JSON.`;

  let promptLogId: string | undefined;
  const response = await generateWithAI(
    config,
    prompt,
    PUBLIC_SCOUT_SYSTEM_PROMPT,
    {
      ...mcpOpts,
      repositoryId,
      actionType: "agent_discover",
      onLogCreated: (id) => {
        promptLogId = id;
        options?.onLogCreated?.(id);
      },
      responseFormat: "json_object",
    },
  );

  let parsed: Record<string, unknown> | null = null;
  let parseError: string | undefined;
  try {
    const json = extractJson(response);
    if (json && typeof json === "object")
      parsed = json as Record<string, unknown>;
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
    console.warn(
      "[QuickStartScout] non-JSON response on first try:",
      response.slice(0, 400),
    );
  }

  // One retry with an explicit "JSON only" reminder when the first response wasn't JSON.
  // Catches the "Playwright MCP browser locked → LLM returned prose" failure mode.
  if (!parsed) {
    const retryPrompt = `${prompt}\n\nIMPORTANT: Your previous response was not valid JSON. Browse the site with MCP tools and return ONLY the strict JSON object specified in the system prompt, no prose, no markdown fences.`;
    const retryResponse = await generateWithAI(
      config,
      retryPrompt,
      PUBLIC_SCOUT_SYSTEM_PROMPT,
      {
        ...mcpOpts,
        repositoryId,
        actionType: "agent_discover",
        onLogCreated: (id) => {
          promptLogId = id;
          options?.onLogCreated?.(id);
        },
        responseFormat: "json_object",
      },
    );
    try {
      const json = extractJson(retryResponse);
      if (json && typeof json === "object")
        parsed = json as Record<string, unknown>;
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
    }
  }

  if (!parsed) {
    throw new Error(
      `Public scout returned non-JSON on both attempts: ${parseError ?? "unknown error"}. Likely a browser MCP failure, see prompt log ${promptLogId ?? "(none)"}.`,
    );
  }

  const rawClassification = classify(parsed.classification);
  const tagline =
    typeof parsed.tagline === "string" ? parsed.tagline : undefined;
  const concept =
    typeof parsed.concept === "string" ? parsed.concept : undefined;
  const navLinks = safeArray(parsed.navLinks, asNavLink);

  // Validation gate: if the model claimed "no_public_register" but produced no
  // tagline, no concept, and no navLinks, it almost certainly didn't browse.
  // Downgrade to 'unknown' so the agent treats it as a scout failure rather
  // than confidently mislabelling the app.
  const wroteAnything =
    (tagline !== undefined && tagline.length > 0) ||
    (concept !== undefined && concept.length > 0) ||
    navLinks.length > 0;
  const classification: QuickstartPublicScout["classification"] =
    rawClassification === "no_public_register" && !wroteAnything
      ? "unknown"
      : rawClassification;
  const automatable =
    parsed.authAutomatable === true && classification === "email_password";

  const data: QuickstartPublicScout = {
    classification,
    authAutomatable: automatable,
    tagline,
    concept,
    navLinks,
    registerPath: asPathOrUrl(parsed.registerPath),
    loginPath: asPathOrUrl(parsed.loginPath),
    apiLoginEndpoint: asPathOrUrl(parsed.apiLoginEndpoint),
    authLibrary:
      typeof parsed.authLibrary === "string" && parsed.authLibrary.length > 0
        ? parsed.authLibrary
        : undefined,
    tokenLocation: asTokenLocation(parsed.tokenLocation),
    cookieBannerSelectorHint:
      typeof parsed.cookieBannerSelectorHint === "string"
        ? parsed.cookieBannerSelectorHint
        : undefined,
    businessInteraction: asBusinessInteraction(parsed.businessInteraction),
    friction: safeArray(parsed.friction, asFriction),
  };

  return { data, promptLogId };
}

export async function runQuickstartScoutAuthed(
  repositoryId: string,
  baseUrl: string,
  authSetupCode: string,
  options?: { onLogCreated?: (logId: string) => void; cdpEndpoint?: string },
): Promise<QuickstartScoutAuthedResult> {
  const settings = await queries.getAISettings(repositoryId);
  const config = getAIConfig(settings);
  const mcpOpts = applyScoutMcpWiring(config, options?.cdpEndpoint);

  const prompt = `Walk the authenticated app at ${baseUrl}.

## Seed (run this FIRST using MCP browser tools to authenticate)
\`\`\`javascript
${authSetupCode}
\`\`\`

After the seed completes successfully, navigate to ${baseUrl} and proceed with the workflow in the system prompt. Return strict JSON.`;

  let promptLogId: string | undefined;
  const response = await generateWithAI(
    config,
    prompt,
    AUTHED_SCOUT_SYSTEM_PROMPT,
    {
      ...mcpOpts,
      repositoryId,
      actionType: "agent_discover",
      onLogCreated: (id) => {
        promptLogId = id;
        options?.onLogCreated?.(id);
      },
      responseFormat: "json_object",
    },
  );

  let parsed: Record<string, unknown> = {};
  try {
    const json = extractJson(response);
    if (json && typeof json === "object")
      parsed = json as Record<string, unknown>;
  } catch {
    // fall through
  }

  const data: QuickstartAuthedScout = {
    inAppNavLinks: safeArray(parsed.inAppNavLinks, asNavLink),
    safeCtaCandidates: safeArray(parsed.safeCtaCandidates, asCta),
    observedRoutes: Array.isArray(parsed.observedRoutes)
      ? parsed.observedRoutes.filter((r): r is string => typeof r === "string")
      : [],
    friction: safeArray(parsed.friction, asFriction),
  };

  return { data, promptLogId };
}
