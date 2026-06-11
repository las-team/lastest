import * as queries from "@/lib/db/queries";
import { refreshGitHubAccessToken } from "./oauth";

// Refresh a little ahead of the real expiry so a request that starts just
// before the boundary doesn't race the clock with a token about to die.
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

/**
 * Return a usable GitHub access token for a team, transparently refreshing it
 * via the stored refresh token when it is at/near expiry.
 *
 * GitHub OAuth Apps only issue a `refresh_token` + `expires_in` when "Expire
 * user authorization tokens" is enabled; otherwise the access token never
 * expires and there is nothing to refresh — in that case `tokenExpiresAt` is
 * null and we return the stored token unchanged. When a refresh fails (the
 * refresh token itself expired or was revoked), we fall back to the stored
 * access token so the caller's API call surfaces a real 401 rather than a
 * silent null.
 */
export async function getValidGithubAccessToken(
  teamId: string,
): Promise<string | null> {
  const account = await queries.getGithubAccountByTeam(teamId);
  if (!account?.accessToken) return null;

  const needsRefresh =
    !!account.tokenExpiresAt &&
    !!account.refreshToken &&
    account.tokenExpiresAt.getTime() < Date.now() + EXPIRY_SKEW_MS;

  if (!needsRefresh) return account.accessToken;

  const refreshed = await refreshGitHubAccessToken(account.refreshToken!);
  if (!refreshed) return account.accessToken;

  await queries.updateGithubAccount(account.id, {
    accessToken: refreshed.access_token,
    // GitHub rotates the refresh token on every refresh — persist the new one.
    ...(refreshed.refresh_token
      ? { refreshToken: refreshed.refresh_token }
      : {}),
    tokenExpiresAt: refreshed.expires_in
      ? new Date(Date.now() + refreshed.expires_in * 1000)
      : null,
  });

  return refreshed.access_token;
}
