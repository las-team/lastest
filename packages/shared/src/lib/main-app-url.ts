/**
 * Returns the main app URL (where routing/rewrites happen).
 * All post-auth redirects and navigation from cloud-auth should use this
 * so the browser lands on the main app, which then rewrites auth paths
 * to the cloud-auth sub-zone when needed.
 */
export function getMainAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}
