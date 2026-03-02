import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getExecutionMode,
  isLocalMode,
  isRunnerMode,
  isEmbeddedMode,
  shouldUseLocalRunner,
} from './mode';

describe('Execution Mode Detection', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('getExecutionMode()', () => {
    it('returns "local" when EXECUTION_MODE=local', () => {
      vi.stubEnv('EXECUTION_MODE', 'local');
      expect(getExecutionMode()).toBe('local');
    });

    it('returns "runner" when EXECUTION_MODE=runner', () => {
      vi.stubEnv('EXECUTION_MODE', 'runner');
      expect(getExecutionMode()).toBe('runner');
    });

    it('returns "embedded" when EXECUTION_MODE=embedded', () => {
      vi.stubEnv('EXECUTION_MODE', 'embedded');
      expect(getExecutionMode()).toBe('embedded');
    });

    it('ignores invalid EXECUTION_MODE values', () => {
      vi.stubEnv('EXECUTION_MODE', 'invalid');
      vi.stubEnv('NODE_ENV', 'development');
      expect(getExecutionMode()).toBe('local');
    });

    it('defaults to "local" in development when EXECUTION_MODE not set', () => {
      delete process.env.EXECUTION_MODE;
      vi.stubEnv('NODE_ENV', 'development');
      expect(getExecutionMode()).toBe('local');
    });

    it('defaults to "runner" in production when EXECUTION_MODE not set', () => {
      delete process.env.EXECUTION_MODE;
      vi.stubEnv('NODE_ENV', 'production');
      expect(getExecutionMode()).toBe('runner');
    });

    it('EXECUTION_MODE overrides NODE_ENV', () => {
      vi.stubEnv('EXECUTION_MODE', 'embedded');
      vi.stubEnv('NODE_ENV', 'development');
      expect(getExecutionMode()).toBe('embedded');
    });
  });

  describe('isLocalMode()', () => {
    it('returns true when mode is local', () => {
      vi.stubEnv('EXECUTION_MODE', 'local');
      expect(isLocalMode()).toBe(true);
    });

    it('returns false when mode is runner', () => {
      vi.stubEnv('EXECUTION_MODE', 'runner');
      expect(isLocalMode()).toBe(false);
    });
  });

  describe('isRunnerMode()', () => {
    it('returns true when mode is runner', () => {
      vi.stubEnv('EXECUTION_MODE', 'runner');
      expect(isRunnerMode()).toBe(true);
    });

    it('returns false when mode is local', () => {
      vi.stubEnv('EXECUTION_MODE', 'local');
      expect(isRunnerMode()).toBe(false);
    });
  });

  describe('isEmbeddedMode()', () => {
    it('returns true when mode is embedded', () => {
      vi.stubEnv('EXECUTION_MODE', 'embedded');
      expect(isEmbeddedMode()).toBe(true);
    });

    it('returns false when mode is local', () => {
      vi.stubEnv('EXECUTION_MODE', 'local');
      expect(isEmbeddedMode()).toBe(false);
    });
  });

  describe('shouldUseLocalRunner()', () => {
    it('returns true when forceLocal is true regardless of mode', () => {
      vi.stubEnv('EXECUTION_MODE', 'runner');
      expect(shouldUseLocalRunner(true)).toBe(true);
    });

    it('returns true when mode is local and forceLocal not set', () => {
      vi.stubEnv('EXECUTION_MODE', 'local');
      expect(shouldUseLocalRunner()).toBe(true);
    });

    it('returns false when mode is runner and forceLocal not set', () => {
      vi.stubEnv('EXECUTION_MODE', 'runner');
      expect(shouldUseLocalRunner()).toBe(false);
    });

    it('returns false when forceLocal is false and mode is runner', () => {
      vi.stubEnv('EXECUTION_MODE', 'runner');
      expect(shouldUseLocalRunner(false)).toBe(false);
    });
  });
});
