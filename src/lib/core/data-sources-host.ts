import "server-only";

import type { DataSourcesHost } from "@lastest/plugin-data-sources/host";

import * as queries from "@/lib/db/queries";

/**
 * The app's fill for `DataSourcesHost`.
 *
 * Three adapters, no new behaviour — each is a call the pre-plugin
 * `src/server/actions/google-sheets.ts` made inline, moved to the side of
 * the boundary that is allowed to make it.
 *
 * **`refreshAccessToken` lives here, not in a `CORE_SRC_PATHS` module.** It
 * reads `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, the same credential
 * material `src/app/api/auth/google-sheets/callback/route.ts` exchanges an
 * authorization code for — but unlike `github`/`gitlab` OAuth (imported by
 * three other core modules before `ci`'s split), nothing outside this host
 * calls it. A `CORE_SRC_PATHS` entry earns its CODEOWNERS line by having
 * more than one caller; this has exactly one, so the credential boundary is
 * the host file itself.
 */

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";

async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
} | null> {
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

export const appDataSourcesHost: DataSourcesHost = {
  async googleSheetsAccessToken(
    teamId: string,
  ): Promise<{ token: string; accountId: string } | null> {
    const account = await queries.getGoogleSheetsAccount(teamId);
    if (!account) return null;

    const isExpired =
      account.tokenExpiresAt &&
      account.tokenExpiresAt.getTime() < Date.now() + 5 * 60 * 1000;

    if (isExpired && account.refreshToken) {
      const refreshed = await refreshAccessToken(account.refreshToken);
      if (refreshed) {
        await queries.updateGoogleSheetsAccountTokens(
          account.id,
          refreshed.access_token,
          new Date(Date.now() + refreshed.expires_in * 1000),
        );
        return { token: refreshed.access_token, accountId: account.id };
      }
    }

    return { token: account.accessToken, accountId: account.id };
  },

  async googleSheetsAccountInfo(teamId: string) {
    const account = await queries.getGoogleSheetsAccount(teamId);
    if (!account) return null;
    return {
      id: account.id,
      googleEmail: account.googleEmail,
      googleName: account.googleName,
      createdAt: account.createdAt,
    };
  },

  async disconnectGoogleSheets(teamId: string): Promise<void> {
    await queries.deleteGoogleSheetsAccount(teamId);
  },
};
