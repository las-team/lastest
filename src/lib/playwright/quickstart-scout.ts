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

import * as queries from '@/lib/db/queries';
import { generateWithAI } from '@/lib/ai';
import { getAIConfig } from './agent-context';
import type {
  QuickstartPublicScout,
  QuickstartAuthedScout,
} from '@/lib/db/schema';

const PUBLIC_SCOUT_SYSTEM_PROMPT = `You are a web app reconnaissance agent. Your job is to (1) describe what a SaaS does and (2) classify whether its sign-up flow is automatable.

Use Playwright MCP browser tools (browser_navigate, browser_snapshot, browser_click) to:
1. Visit the base URL.
2. Capture the tagline and concept from the hero (one to two sentences, in your own words — do NOT invent features that aren't on the page).
3. Read \`<a href>\` paths from the navigation; collect the public ones.
4. Try /register, /signup, or /users/register; record which path actually loaded the register page (or null if none did).
5. Snapshot the register page and classify the sign-up flow.

CLASSIFICATION TABLE (pick ONE, in priority order — if multiple apply, pick the first match):

| Signal in snapshot | classification | authAutomatable |
|---|---|---|
| Register page is behind login / 404 / not reachable | no_public_register | false |
| iframe from google.com/recaptcha, hcaptcha.com, cloudflare.com challenge | captcha_gated | false |
| textbox "Phone" or visible OTP step | otp | false |
| Only OAuth buttons (Google / GitHub / Apple / SSO) | oauth_only | false |
| textbox "Email" only + button "Send magic link" / "Continue" | magic_link_only | false |
| textbox "Email" + textbox "Password" + submit button | email_password | true |

Return STRICT JSON (no markdown), shape:
{
  "tagline": "string or null",
  "concept": "1-2 sentence description, no marketing fluff",
  "navLinks": [{ "path": "/features", "label": "Features" }, ...],
  "registerPath": "/register | /signup | ... | null",
  "classification": "email_password | magic_link_only | oauth_only | captcha_gated | otp | no_public_register",
  "authAutomatable": true | false,
  "cookieBannerSelectorHint": "optional — if you saw a cookie banner, the button label that dismisses it",
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

function extractJson(response: string): unknown {
  const fence = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const raw = (fence?.[1] ?? response).trim();
  return JSON.parse(raw);
}

function safeArray<T>(value: unknown, mapper: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value) {
    const mapped = mapper(item);
    if (mapped !== null) out.push(mapped);
  }
  return out;
}

function asNavLink(item: unknown): { path: string; label: string } | null {
  if (!item || typeof item !== 'object') return null;
  const obj = item as Record<string, unknown>;
  const path = typeof obj.path === 'string' ? obj.path : null;
  const label = typeof obj.label === 'string' ? obj.label : '';
  if (!path || !path.startsWith('/')) return null;
  return { path, label };
}

function asFriction(item: unknown): { kind: string; note: string } | null {
  if (!item || typeof item !== 'object') return null;
  const obj = item as Record<string, unknown>;
  if (typeof obj.kind !== 'string' || typeof obj.note !== 'string') return null;
  return { kind: obj.kind, note: obj.note };
}

function asCta(item: unknown): { label: string; selectorHint?: string } | null {
  if (!item || typeof item !== 'object') return null;
  const obj = item as Record<string, unknown>;
  if (typeof obj.label !== 'string') return null;
  return {
    label: obj.label,
    selectorHint: typeof obj.selectorHint === 'string' ? obj.selectorHint : undefined,
  };
}

function classify(value: unknown): QuickstartPublicScout['classification'] {
  const allowed = ['email_password', 'magic_link_only', 'oauth_only', 'captcha_gated', 'otp', 'no_public_register'] as const;
  return (allowed as readonly string[]).includes(value as string)
    ? (value as QuickstartPublicScout['classification'])
    : 'no_public_register';
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
  options?: { onLogCreated?: (logId: string) => void },
): Promise<QuickstartScoutPublicResult> {
  const settings = await queries.getAISettings(repositoryId);
  const config = getAIConfig(settings);

  const prompt = `Reconnoiter ${baseUrl}. Follow the workflow in the system prompt and return strict JSON.`;

  let promptLogId: string | undefined;
  const response = await generateWithAI(config, prompt, PUBLIC_SCOUT_SYSTEM_PROMPT, {
    useMCP: true,
    repositoryId,
    actionType: 'agent_discover',
    onLogCreated: (id) => { promptLogId = id; options?.onLogCreated?.(id); },
    responseFormat: 'json_object',
  });

  let parsed: Record<string, unknown> = {};
  try {
    const json = extractJson(response);
    if (json && typeof json === 'object') parsed = json as Record<string, unknown>;
  } catch {
    // fall through with empty parsed; downstream defaults handle it
  }

  const classification = classify(parsed.classification);
  const automatable = parsed.authAutomatable === true && classification === 'email_password';

  const data: QuickstartPublicScout = {
    classification,
    authAutomatable: automatable,
    tagline: typeof parsed.tagline === 'string' ? parsed.tagline : undefined,
    concept: typeof parsed.concept === 'string' ? parsed.concept : undefined,
    navLinks: safeArray(parsed.navLinks, asNavLink),
    registerPath: typeof parsed.registerPath === 'string' ? parsed.registerPath : null,
    cookieBannerSelectorHint:
      typeof parsed.cookieBannerSelectorHint === 'string' ? parsed.cookieBannerSelectorHint : undefined,
    friction: safeArray(parsed.friction, asFriction),
  };

  return { data, promptLogId };
}

export async function runQuickstartScoutAuthed(
  repositoryId: string,
  baseUrl: string,
  authSetupCode: string,
  options?: { onLogCreated?: (logId: string) => void },
): Promise<QuickstartScoutAuthedResult> {
  const settings = await queries.getAISettings(repositoryId);
  const config = getAIConfig(settings);

  const prompt = `Walk the authenticated app at ${baseUrl}.

## Seed (run this FIRST using MCP browser tools to authenticate)
\`\`\`javascript
${authSetupCode}
\`\`\`

After the seed completes successfully, navigate to ${baseUrl} and proceed with the workflow in the system prompt. Return strict JSON.`;

  let promptLogId: string | undefined;
  const response = await generateWithAI(config, prompt, AUTHED_SCOUT_SYSTEM_PROMPT, {
    useMCP: true,
    repositoryId,
    actionType: 'agent_discover',
    onLogCreated: (id) => { promptLogId = id; options?.onLogCreated?.(id); },
    responseFormat: 'json_object',
  });

  let parsed: Record<string, unknown> = {};
  try {
    const json = extractJson(response);
    if (json && typeof json === 'object') parsed = json as Record<string, unknown>;
  } catch {
    // fall through
  }

  const data: QuickstartAuthedScout = {
    inAppNavLinks: safeArray(parsed.inAppNavLinks, asNavLink),
    safeCtaCandidates: safeArray(parsed.safeCtaCandidates, asCta),
    observedRoutes: Array.isArray(parsed.observedRoutes)
      ? parsed.observedRoutes.filter((r): r is string => typeof r === 'string')
      : [],
    friction: safeArray(parsed.friction, asFriction),
  };

  return { data, promptLogId };
}
