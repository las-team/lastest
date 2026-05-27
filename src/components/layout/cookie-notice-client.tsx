'use client';

import Link from 'next/link';
import CookieConsent from 'react-cookie-consent';

/**
 * Site-wide cookie notice. Lastest only sets strictly-necessary cookies
 * (auth session + OAuth CSRF state, see /cookies), so this is an informational
 * acknowledgement, not a consent gate. No tracking/advertising cookies are set,
 * so there is nothing to opt out of. `disableStyles` keeps it CSP-clean (no
 * inline <style>) and lets the shadcn theme classes drive the look.
 */
export function CookieNotice() {
  return (
    <CookieConsent
      cookieName="lastest_cookie_notice"
      location="bottom"
      buttonText="Got it"
      expires={365}
      disableStyles
      disableButtonStyles
      containerClasses="fixed inset-x-0 bottom-0 z-50 flex flex-col gap-3 border-t bg-background/95 px-4 py-3 text-sm text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:flex-row sm:items-center sm:justify-between"
      contentClasses="flex-1"
      buttonWrapperClasses="flex shrink-0 items-center"
      buttonClasses="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
    >
      We only use cookies that are strictly necessary to keep you signed in and
      secure. No tracking or advertising cookies. See our{' '}
      <Link
        href="/cookies"
        className="underline underline-offset-4 hover:text-foreground"
      >
        Cookie Policy
      </Link>
      .
    </CookieConsent>
  );
}
