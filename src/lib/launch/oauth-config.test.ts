import { describe, it, expect, afterEach } from 'vitest';
import { isValidClientId, isAllowedRedirectUri, scopeIncludes, LAUNCH_CLIENT_ID } from './oauth-config';

describe('launch/oauth-config', () => {
  afterEach(() => {
    delete process.env.LAUNCH_REDIRECT_ORIGINS;
  });

  it('only accepts the launch-www client id', () => {
    expect(isValidClientId(LAUNCH_CLIENT_ID)).toBe(true);
    expect(isValidClientId('something-else')).toBe(false);
    expect(isValidClientId(null)).toBe(false);
  });

  it('allows the production launch origin by default and localhost in dev', () => {
    expect(isAllowedRedirectUri('https://launch.lastest.cloud/auth/callback')).toBe(true);
    // NODE_ENV is 'test' (not production) → localhost is permitted.
    expect(isAllowedRedirectUri('http://localhost:3000/x')).toBe(true);
    expect(isAllowedRedirectUri('https://evil.example.com/x')).toBe(false);
    expect(isAllowedRedirectUri('not a url')).toBe(false);
    expect(isAllowedRedirectUri(null)).toBe(false);
  });

  it('honors the LAUNCH_REDIRECT_ORIGINS env allowlist', () => {
    process.env.LAUNCH_REDIRECT_ORIGINS = 'https://staging.launch.lastest.cloud';
    expect(isAllowedRedirectUri('https://staging.launch.lastest.cloud/cb')).toBe(true);
    expect(isAllowedRedirectUri('https://launch.lastest.cloud/cb')).toBe(false);
  });

  it('scopeIncludes checks a space-separated scope string', () => {
    expect(scopeIncludes('launch:vote launch:submit', 'launch:vote')).toBe(true);
    expect(scopeIncludes('launch:submit', 'launch:vote')).toBe(false);
    expect(scopeIncludes(null, 'launch:vote')).toBe(false);
    expect(scopeIncludes('', 'launch:vote')).toBe(false);
  });
});
