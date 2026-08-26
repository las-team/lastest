/**
 * Pure auth-surface matchers shared by the QA agent's crawl and login step.
 * Everything here operates on DOM-observed link text/hrefs — auth URLs are
 * never guessed (no probing /login or /signup that nothing links to).
 */

const LOGIN_RE = /\b(?:log[ _-]?in|sign[ _-]?in)\b/i;
const SIGNUP_RE =
  /\b(?:sign[ _-]?up|register|create[ _-]+(?:an?[ _-]+)?account)\b/i;

/** True when a link's text or href reads as an auth page (login OR signup). */
export function isAuthLink(text: string, href: string): boolean {
  return (
    LOGIN_RE.test(text) ||
    SIGNUP_RE.test(text) ||
    LOGIN_RE.test(href) ||
    SIGNUP_RE.test(href)
  );
}

/** True when a pathname looks like an auth page (used to decide "still on the
 *  login surface" after a login attempt). Segment-anchored so content paths
 *  like /blog/sign-language don't match. */
export function looksLikeAuthUrl(pathname: string): boolean {
  return /(?:^|\/)(?:log[_-]?in|sign[_-]?in|sign[_-]?up|register|auth)(?:$|[/?#._-])/i.test(
    pathname,
  );
}

/**
 * Pick the login and signup URLs out of a page's observed links. Same-origin
 * only, first match wins, returns absolute URLs (hash stripped).
 */
export function matchAuthLinks(
  links: Array<{ text: string; href: string }>,
  baseUrl: string,
): { loginUrl?: string; signupUrl?: string } {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return {};
  }
  let loginUrl: string | undefined;
  let signupUrl: string | undefined;
  for (const link of links) {
    if (!link.href || link.href.startsWith("javascript:")) continue;
    let url: URL;
    try {
      url = new URL(link.href, base);
    } catch {
      continue;
    }
    if (url.origin !== base.origin) continue;
    url.hash = "";
    const haystack = `${link.text} ${url.pathname}`;
    if (!loginUrl && LOGIN_RE.test(haystack)) loginUrl = url.href;
    if (!signupUrl && SIGNUP_RE.test(haystack)) signupUrl = url.href;
    if (loginUrl && signupUrl) break;
  }
  return { loginUrl, signupUrl };
}
