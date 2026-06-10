// Single source of truth for which social OAuth providers are configured.
//
// A provider counts as "enabled" only when BOTH its client id and secret are
// present in the env. This gates two things off the same check:
//   1. Provider registration in auth.ts — an unconfigured provider is never
//      registered, so better-auth never emits a broken
//      `client_id=undefined` authorize URL (the Discord regression).
//   2. The login/register OAuth buttons — an unconfigured provider's button is
//      hidden instead of rendering a button that 500s on click.
//
// Server-only: reads non-public env vars. Surfaced to the client via the
// getEnabledSocialProviders() server action.

export const socialProviderEnabled = {
  github: () =>
    !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
  google: () =>
    !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  discord: () =>
    !!(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET),
} as const;

export type SocialProvider = keyof typeof socialProviderEnabled;

export function getEnabledSocialProvidersMap(): Record<
  SocialProvider,
  boolean
> {
  return {
    github: socialProviderEnabled.github(),
    google: socialProviderEnabled.google(),
    discord: socialProviderEnabled.discord(),
  };
}
