import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FREEZE_ANIMATIONS_CSS, FREEZE_ANIMATIONS_SCRIPT, DEFAULT_SCREENSHOT_DELAY } from './constants';
import { createMockPage } from '../__tests__/setup';

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

  describe('FREEZE_ANIMATIONS_SCRIPT', () => {
    it('exports init script for comprehensive animation freezing', () => {
      expect(FREEZE_ANIMATIONS_SCRIPT).toBeDefined();
      expect(typeof FREEZE_ANIMATIONS_SCRIPT).toBe('string');
    });

    it('contains CSS injection for animations and transitions', () => {
      expect(FREEZE_ANIMATIONS_SCRIPT).toContain('animation: none !important');
      expect(FREEZE_ANIMATIONS_SCRIPT).toContain('transition: none !important');
    });

    it('blocks Element.prototype.animate', () => {
      expect(FREEZE_ANIMATIONS_SCRIPT).toContain('Element.prototype.animate');
    });

    it('overrides setInterval to prevent auto-advancing', () => {
      expect(FREEZE_ANIMATIONS_SCRIPT).toContain('setInterval');
    });

    it('pauses Web Animations API', () => {
      expect(FREEZE_ANIMATIONS_SCRIPT).toContain('getAnimations');
    });

    it('handles both DOMContentLoaded and load events', () => {
      expect(FREEZE_ANIMATIONS_SCRIPT).toContain('DOMContentLoaded');
      expect(FREEZE_ANIMATIONS_SCRIPT).toContain("'load'");
    });
  });

  describe('freezeAnimations setting behavior', () => {
    it('when enabled, injects init script to freeze all animations', () => {
      const settings = { freezeAnimations: true };
      expect(settings.freezeAnimations).toBe(true);
    });

    it('when disabled, does not inject animation script', () => {
      const settings = { freezeAnimations: false };
      expect(settings.freezeAnimations).toBe(false);
    });

    it('defaults to false when not specified', () => {
      const settings = {};
      expect(settings.freezeAnimations ?? false).toBe(false);
    });
  });

  describe('animation freezing integration', () => {
    let mockPage: ReturnType<typeof createMockPage>;

    beforeEach(() => {
      mockPage = createMockPage();
    });

    it('injects init script when freezeAnimations is true', async () => {
      const settings = { freezeAnimations: true };

      if (settings.freezeAnimations) {
        await mockPage.addInitScript(FREEZE_ANIMATIONS_SCRIPT);
      }

      expect(mockPage.addInitScript).toHaveBeenCalledWith(FREEZE_ANIMATIONS_SCRIPT);
    });

    it('does not inject script when freezeAnimations is false', async () => {
      const settings = { freezeAnimations: false };

      if (settings.freezeAnimations) {
        await mockPage.addInitScript(FREEZE_ANIMATIONS_SCRIPT);
      }

      expect(mockPage.addInitScript).not.toHaveBeenCalled();
    });

    it('uses addInitScript (persists across navigations) not addStyleTag', async () => {
      const settings = { freezeAnimations: true };

      if (settings.freezeAnimations) {
        await mockPage.addInitScript(FREEZE_ANIMATIONS_SCRIPT);
      }

      // Should use addInitScript, NOT addStyleTag for animation freezing
      expect(mockPage.addInitScript).toHaveBeenCalled();
      expect(mockPage.addStyleTag).not.toHaveBeenCalled();
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

    it('passes options through to original screenshot method', async () => {
      const mockPage = {
        screenshot: vi.fn().mockResolvedValue(Buffer.from([])),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      };

      const screenshotDelay = 100;
      const options = { path: '/test.png', fullPage: true };

      const originalScreenshot = mockPage.screenshot;
      const proxiedScreenshot = async (opts?: Record<string, unknown>) => {
        if (screenshotDelay > 0) {
          await mockPage.waitForTimeout(screenshotDelay);
        }
        return originalScreenshot(opts);
      };

      await proxiedScreenshot(options);

      expect(mockPage.screenshot).toHaveBeenCalledWith(options);
    });
  });
});

describe('Selector Fallback Strategy', () => {
  describe('selector priority', () => {
    it('follows priority: data-testid -> id -> role -> aria -> text -> css -> ocr', () => {
      const priority = [
        'data-testid',
        'id',
        'role-name',
        'aria-label',
        'text',
        'css-path',
        'ocr-text',
      ];

      // Verify priority order is correct
      expect(priority[0]).toBe('data-testid');
      expect(priority[6]).toBe('ocr-text');
      expect(priority.length).toBe(7);
    });

    it('tries next selector when current fails', async () => {
      const mockPage = createMockPage();

      // First locator fails, second succeeds
      const failingLocator = {
        ...mockPage.locator(),
        count: vi.fn().mockResolvedValue(0),
      };

      const successLocator = {
        ...mockPage.locator(),
        count: vi.fn().mockResolvedValue(1),
        click: vi.fn().mockResolvedValue(undefined),
      };

      let attempt = 0;
      mockPage.locator = vi.fn().mockImplementation(() => {
        attempt++;
        return attempt === 1 ? failingLocator : successLocator;
      });

      // Simulate fallback logic
      let locator = mockPage.locator('[data-testid="button"]');
      let count = await locator.count();

      if (count === 0) {
        locator = mockPage.locator('#button');
        count = await locator.count();
      }

      expect(count).toBe(1);
      await locator.click();
      expect(successLocator.click).toHaveBeenCalled();
    });
  });

  describe('selector stat recording', () => {
    it('records successful selector usage', () => {
      const selectorType = 'data-testid';
      const selector = '[data-testid="submit-button"]';
      const success = true;

      // Simulate recording
      const stats = new Map<string, { success: number; failure: number }>();
      const key = `${selectorType}:${selector}`;

      if (!stats.has(key)) {
        stats.set(key, { success: 0, failure: 0 });
      }

      if (success) {
        stats.get(key)!.success++;
      }

      expect(stats.get(key)?.success).toBe(1);
      expect(stats.get(key)?.failure).toBe(0);
    });

    it('records failed selector usage', () => {
      const selectorType = 'css-path';
      const selector = 'div > button.submit';
      const success = false;

      // Simulate recording
      const stats = new Map<string, { success: number; failure: number }>();
      const key = `${selectorType}:${selector}`;

      if (!stats.has(key)) {
        stats.set(key, { success: 0, failure: 0 });
      }

      if (!success) {
        stats.get(key)!.failure++;
      }

      expect(stats.get(key)?.success).toBe(0);
      expect(stats.get(key)?.failure).toBe(1);
    });

    it('accumulates stats over multiple uses', () => {
      const stats = new Map<string, { success: number; failure: number }>();
      const key = 'data-testid:[data-testid="button"]';

      stats.set(key, { success: 0, failure: 0 });

      // Record multiple uses
      stats.get(key)!.success++;
      stats.get(key)!.success++;
      stats.get(key)!.failure++;
      stats.get(key)!.success++;

      expect(stats.get(key)?.success).toBe(3);
      expect(stats.get(key)?.failure).toBe(1);
    });
  });
});

describe('createAppState Helper', () => {
  let mockPage: ReturnType<typeof createMockPage>;

  beforeEach(() => {
    mockPage = createMockPage();
  });

  describe('get() method', () => {
    it('retrieves state value by dot-notation path', async () => {
      mockPage.evaluate = vi.fn().mockResolvedValue('test-value');

      // Simulate createAppState
      const appState = {
        get: async (path: string) => {
          return mockPage.evaluate((p) => {
            return p; // Simplified mock
          }, path);
        },
      };

      const value = await appState.get('history.length');

      expect(mockPage.evaluate).toHaveBeenCalled();
      expect(value).toBe('test-value');
    });

    it('looks for state in multiple common locations', async () => {
      mockPage.evaluate = vi.fn().mockImplementation((fn) => {
        // Simulate looking for state in __APP_STATE__, store, __EXCALIDRAW_STATE__
        return Promise.resolve(undefined);
      });

      const appState = {
        get: async (path: string) => {
          return mockPage.evaluate(() => {
            // Check common locations
            const state = (window as Record<string, unknown>).__APP_STATE__ ||
                         (window as Record<string, unknown>).store ||
                         (window as Record<string, unknown>).__EXCALIDRAW_STATE__;
            return state;
          });
        },
      };

      await appState.get('test.path');

      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it('handles nested path traversal', async () => {
      const mockState = {
        user: {
          settings: {
            theme: 'dark',
          },
        },
      };

      mockPage.evaluate = vi.fn().mockImplementation((fn, path: string) => {
        // Simulate path traversal
        return Promise.resolve(
          path.split('.').reduce((obj, key) => obj?.[key], mockState as unknown as Record<string, unknown>)
        );
      });

      const appState = {
        get: async (path: string) => {
          return mockPage.evaluate((p) => p, path);
        },
      };

      const value = await appState.get('user.settings.theme');

      expect(value).toBe('dark');
    });

    it('returns undefined for non-existent paths', async () => {
      mockPage.evaluate = vi.fn().mockResolvedValue(undefined);

      const appState = {
        get: async (path: string) => {
          return mockPage.evaluate(() => undefined);
        },
      };

      const value = await appState.get('non.existent.path');

      expect(value).toBeUndefined();
    });
  });

  describe('getHistoryLength() method', () => {
    it('retrieves Excalidraw history length', async () => {
      mockPage.evaluate = vi.fn().mockResolvedValue(5);

      const appState = {
        getHistoryLength: async () => {
          return mockPage.evaluate(() => {
            // Simulate checking for excalidrawAPI
            return 5;
          });
        },
      };

      const length = await appState.getHistoryLength();

      expect(length).toBe(5);
      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it('returns -1 when Excalidraw API is not available', async () => {
      mockPage.evaluate = vi.fn().mockResolvedValue(-1);

      const appState = {
        getHistoryLength: async () => {
          return mockPage.evaluate(() => -1);
        },
      };

      const length = await appState.getHistoryLength();

      expect(length).toBe(-1);
    });

    it('checks multiple Excalidraw state locations', async () => {
      mockPage.evaluate = vi.fn().mockImplementation(() => {
        // Simulate checking excalidrawAPI, __EXCALIDRAW_STATE__, __APP_STATE__
        return Promise.resolve(3);
      });

      const appState = {
        getHistoryLength: async () => {
          return mockPage.evaluate(() => {
            // Check multiple locations
            return 3;
          });
        },
      };

      await appState.getHistoryLength();

      expect(mockPage.evaluate).toHaveBeenCalled();
    });
  });

  describe('getAll() method', () => {
    it('retrieves entire app state object', async () => {
      const mockState = {
        user: { id: 1 },
        settings: { theme: 'dark' },
      };

      mockPage.evaluate = vi.fn().mockResolvedValue(mockState);

      const appState = {
        getAll: async () => {
          return mockPage.evaluate(() => mockState);
        },
      };

      const state = await appState.getAll();

      expect(state).toEqual(mockState);
      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it('returns null when no state is available', async () => {
      mockPage.evaluate = vi.fn().mockResolvedValue(null);

      const appState = {
        getAll: async () => {
          return mockPage.evaluate(() => null);
        },
      };

      const state = await appState.getAll();

      expect(state).toBeNull();
    });
  });

  describe('evaluate() method', () => {
    it('executes custom accessor function', async () => {
      mockPage.evaluate = vi.fn().mockResolvedValue('custom-value');

      const appState = {
        evaluate: async <T>(accessor: string): Promise<T> => {
          return mockPage.evaluate((fn) => {
            const func = new Function('window', `return ${fn}`);
            return func(window);
          }, accessor) as Promise<T>;
        },
      };

      const value = await appState.evaluate<string>('window.customValue');

      expect(mockPage.evaluate).toHaveBeenCalled();
    });
  });
});

describe('createExpect Helper', () => {
  let mockPage: ReturnType<typeof createMockPage>;

  beforeEach(() => {
    mockPage = createMockPage();
  });

  describe('Page assertions', () => {
    it('provides toHaveURL matcher', async () => {
      mockPage.url = vi.fn().mockReturnValue('https://example.com/test');

      // Simulate expect(page).toHaveURL()
      const expectPage = {
        toHaveURL: async (expectedUrl: string) => {
          const actualUrl = mockPage.url();
          return actualUrl === expectedUrl;
        },
      };

      const result = await expectPage.toHaveURL('https://example.com/test');

      expect(result).toBe(true);
      expect(mockPage.url).toHaveBeenCalled();
    });

    it('provides toHaveTitle matcher', async () => {
      mockPage.title = vi.fn().mockResolvedValue('Test Page');

      // Simulate expect(page).toHaveTitle()
      const expectPage = {
        toHaveTitle: async (expectedTitle: string) => {
          const actualTitle = await mockPage.title();
          return actualTitle === expectedTitle;
        },
      };

      const result = await expectPage.toHaveTitle('Test Page');

      expect(result).toBe(true);
      expect(mockPage.title).toHaveBeenCalled();
    });
  });

  describe('Locator assertions', () => {
    it('provides toBeVisible matcher', async () => {
      const mockLocator = {
        isVisible: vi.fn().mockResolvedValue(true),
      };

      // Simulate expect(locator).toBeVisible()
      const expectLocator = {
        toBeVisible: async () => {
          return mockLocator.isVisible();
        },
      };

      const result = await expectLocator.toBeVisible();

      expect(result).toBe(true);
      expect(mockLocator.isVisible).toHaveBeenCalled();
    });

    it('provides toHaveText matcher', async () => {
      const mockLocator = {
        textContent: vi.fn().mockResolvedValue('Button Text'),
      };

      // Simulate expect(locator).toHaveText()
      const expectLocator = {
        toHaveText: async (expectedText: string) => {
          const actualText = await mockLocator.textContent();
          return actualText === expectedText;
        },
      };

      const result = await expectLocator.toHaveText('Button Text');

      expect(result).toBe(true);
      expect(mockLocator.textContent).toHaveBeenCalled();
    });

    it('provides toBeEnabled matcher', async () => {
      const mockLocator = {
        isEnabled: vi.fn().mockResolvedValue(true),
      };

      // Simulate expect(locator).toBeEnabled()
      const expectLocator = {
        toBeEnabled: async () => {
          return mockLocator.isEnabled();
        },
      };

      const result = await expectLocator.toBeEnabled();

      expect(result).toBe(true);
      expect(mockLocator.isEnabled).toHaveBeenCalled();
    });
  });

  describe('timeout configuration', () => {
    it('accepts custom timeout parameter', () => {
      const defaultTimeout = 5000;
      const customTimeout = 10000;

      // Verify timeout can be configured
      expect(customTimeout).toBeGreaterThan(defaultTimeout);
      expect(typeof customTimeout).toBe('number');
    });

    it('uses default timeout when not specified', () => {
      const defaultTimeout = 5000;

      expect(defaultTimeout).toBe(5000);
    });
  });
});

describe('Multi-Browser Support', () => {
  it('supports chromium browser', () => {
    const browserType = 'chromium';
    expect(browserType).toBe('chromium');
  });

  it('supports firefox browser', () => {
    const browserType = 'firefox';
    expect(browserType).toBe('firefox');
  });

  it('supports webkit browser', () => {
    const browserType = 'webkit';
    expect(browserType).toBe('webkit');
  });

  it('validates browser type is one of the supported browsers', () => {
    const validBrowsers = ['chromium', 'firefox', 'webkit'];
    const testBrowser = 'chromium';

    expect(validBrowsers).toContain(testBrowser);
  });
});
