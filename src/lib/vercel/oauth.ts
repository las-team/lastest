/**
 * Vercel Marketplace integration OAuth + REST client.
 *
 * Mirrors src/lib/github/oauth.ts. The integration client id/secret come from
 * the Vercel Integrations Console (see docs/todo Vercel spec §2). The client
 * secret doubles as the webhook signature key (see ./webhooks.ts).
 *
 * ⚠ Endpoint versions are pinned to what Vercel documents as of 2026-07 and are
 * isolated here so they're a one-line swap if a live response differs:
 *   - token exchange:   POST https://api.vercel.com/v2/oauth/access_token
 *   - projects list:    GET  https://api.vercel.com/v9/projects
 * The Checks API lives in ./checks.ts.
 */

const VERCEL_CLIENT_ID = process.env.VERCEL_INTEGRATION_CLIENT_ID || "";
const VERCEL_CLIENT_SECRET = process.env.VERCEL_INTEGRATION_CLIENT_SECRET || "";
const VERCEL_REDIRECT_URI =
  process.env.VERCEL_INTEGRATION_REDIRECT_URI ||
  "http://localhost:3000/api/connect/vercel/callback";

const VERCEL_API = "https://api.vercel.com";

export function isVercelIntegrationConfigured(): boolean {
  return Boolean(VERCEL_CLIENT_ID && VERCEL_CLIENT_SECRET);
}

/**
 * The Marketplace "install" entry point. Vercel appends `code`,
 * `configurationId`, `teamId` and `next` to the redirect URI after the user
 * approves. `state` is our CSRF nonce (verified in the callback).
 */
export function getVercelAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: VERCEL_CLIENT_ID,
    redirect_uri: VERCEL_REDIRECT_URI,
    state,
  });
  return `https://vercel.com/integrations/authorize?${params.toString()}`;
}

export interface VercelTokenResponse {
  access_token: string;
  token_type: string;
  installation_id?: string;
  user_id?: string;
  team_id?: string | null;
}

/**
 * Exchange the one-time `code` for an OAuth2 integration access token. Vercel's
 * token endpoint is form-encoded (not JSON). Returns null on any failure.
 */
export async function exchangeCodeForToken(
  code: string,
): Promise<VercelTokenResponse | null> {
  try {
    const body = new URLSearchParams({
      client_id: VERCEL_CLIENT_ID,
      client_secret: VERCEL_CLIENT_SECRET,
      code,
      redirect_uri: VERCEL_REDIRECT_URI,
    });

    const response = await fetch(`${VERCEL_API}/v2/oauth/access_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });

    if (!response.ok) {
      console.error(
        "[vercel] token exchange failed:",
        response.status,
        await response.text().catch(() => ""),
      );
      return null;
    }

    const data = (await response.json()) as VercelTokenResponse;
    if (!data.access_token) return null;
    return data;
  } catch (error) {
    console.error("[vercel] token exchange error:", error);
    return null;
  }
}

export interface VercelProject {
  id: string;
  name: string;
  framework?: string | null;
}

/**
 * List projects visible to the integration token. When the install is on a
 * Vercel team, `teamId` must be threaded through as a query param or the API
 * returns the personal-scope projects instead.
 */
export async function getVercelProjects(
  accessToken: string,
  teamId?: string | null,
): Promise<VercelProject[]> {
  try {
    const url = new URL(`${VERCEL_API}/v9/projects`);
    url.searchParams.set("limit", "100");
    if (teamId) url.searchParams.set("teamId", teamId);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      console.error(
        "[vercel] project list failed:",
        response.status,
        await response.text().catch(() => ""),
      );
      return [];
    }
    const data = (await response.json()) as { projects?: VercelProject[] };
    return data.projects ?? [];
  } catch (error) {
    console.error("[vercel] project list error:", error);
    return [];
  }
}
