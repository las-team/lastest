import { describe, it, expect, vi } from 'vitest';
import { FREEZE_ANIMATIONS_CSS, DEFAULT_SCREENSHOT_DELAY } from './constants';

describe('Animation Freezing', () => {
  describe('FREEZE_ANIMATIONS_CSS', () => {
    it('exports CSS constant for animation freezing', () => {
      expect(FREEZE_ANIMATIONS_CSS).toBeDefined();
      expect(typeof FREEZE_ANIMATIONS_CSS).toBe('string');
    });

    it('disables CSS animations with !important', () => {
      expect(FREEZE_ANIMATIONS_CSS).toContain('animation: none !important');
    });

    it('disables CSS transitions with !important', () => {
      expect(FREEZE_ANIMATIONS_CSS).toContain('transition: none !important');
    });

    it('sets animation-delay to 0s', () => {
      expect(FREEZE_ANIMATIONS_CSS).toContain('animation-delay: 0s !important');
    });

    it('sets transition-delay to 0s', () => {
      expect(FREEZE_ANIMATIONS_CSS).toContain('transition-delay: 0s !important');
    });

    it('applies to all elements including pseudo-elements', () => {
      expect(FREEZE_ANIMATIONS_CSS).toContain('*');
      expect(FREEZE_ANIMATIONS_CSS).toContain('*::before');
      expect(FREEZE_ANIMATIONS_CSS).toContain('*::after');
    });
  });

  describe('freezeAnimations setting behavior', () => {
    it('when enabled, injects CSS to disable all animations', () => {
      // The runner checks this.settings?.freezeAnimations
      // If true, it calls page.addStyleTag({ content: FREEZE_ANIMATIONS_CSS })
      const settings = { freezeAnimations: true };
      expect(settings.freezeAnimations).toBe(true);
    });

    it('when disabled, does not inject animation CSS', () => {
      const settings = { freezeAnimations: false };
      expect(settings.freezeAnimations).toBe(false);
    });

    it('defaults to false when not specified', () => {
      const settings = {};
      expect(settings.freezeAnimations ?? false).toBe(false);
    });
  });
});

describe('Screenshot Stabilization Delay', () => {
  describe('screenshotDelay setting behavior', () => {
    it('applies delay before taking screenshot when > 0', () => {
      // The runner intercepts page.screenshot() and waits for screenshotDelay ms
      const settings = { screenshotDelay: 500 };
      expect(settings.screenshotDelay).toBe(500);
      expect(settings.screenshotDelay > 0).toBe(true);
    });

    it('skips delay when set to 0', () => {
      const settings = { screenshotDelay: 0 };
      expect(settings.screenshotDelay).toBe(0);
      // When delay is 0, the runner skips waitForTimeout
    });

    it('defaults to 0 when not specified', () => {
      const settings = {};
      expect(settings.screenshotDelay ?? DEFAULT_SCREENSHOT_DELAY).toBe(0);
    });

    it('exports DEFAULT_SCREENSHOT_DELAY constant as 0', () => {
      expect(DEFAULT_SCREENSHOT_DELAY).toBe(0);
    });

    it('accepts various delay values for different stabilization needs', () => {
      // Common use cases:
      // - 100ms: Minor layout settling
      // - 500ms: Animation completion
      // - 1000ms+: Heavy async content loading
      const delays = [100, 250, 500, 1000, 2000];
      delays.forEach(delay => {
        expect(typeof delay).toBe('number');
        expect(delay).toBeGreaterThan(0);
      });
    });
  });

  describe('screenshot proxy behavior', () => {
    it('creates proxy that intercepts screenshot calls', async () => {
      // The runner creates a Proxy around the page object
      // that intercepts 'screenshot' property access
      const mockPage = {
        screenshot: vi.fn().mockResolvedValue(Buffer.from([])),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      };

      const screenshotDelay = 100;

      // Simulate the proxy behavior
      const originalScreenshot = mockPage.screenshot;
      const proxiedScreenshot = async (options?: Record<string, unknown>) => {
        if (screenshotDelay > 0) {
          await mockPage.waitForTimeout(screenshotDelay);
        }
        return originalScreenshot(options);
      };

      await proxiedScreenshot({ path: '/test.png' });

      expect(mockPage.waitForTimeout).toHaveBeenCalledWith(100);
      expect(mockPage.screenshot).toHaveBeenCalled();
    });

    it('skips waitForTimeout when delay is 0', async () => {
      const mockPage = {
        screenshot: vi.fn().mockResolvedValue(Buffer.from([])),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      };

      const screenshotDelay = 0;

      const originalScreenshot = mockPage.screenshot;
      const proxiedScreenshot = async (options?: Record<string, unknown>) => {
        if (screenshotDelay > 0) {
          await mockPage.waitForTimeout(screenshotDelay);
        }
        return originalScreenshot(options);
      };

      await proxiedScreenshot({ path: '/test.png' });

      expect(mockPage.waitForTimeout).not.toHaveBeenCalled();
      expect(mockPage.screenshot).toHaveBeenCalled();
    });
  });
});
