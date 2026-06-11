"use server";

import {
  getEnabledSocialProvidersMap,
  type SocialProvider,
} from "@/lib/auth/social-providers";

/**
 * Reports which social OAuth providers are configured (client id + secret set),
 * so the auth UI can render only the buttons that will actually work. Public by
 * design — it leaks no secret values, only on/off flags.
 */
export async function getEnabledSocialProviders(): Promise<
  Record<SocialProvider, boolean>
> {
  return getEnabledSocialProvidersMap();
}
