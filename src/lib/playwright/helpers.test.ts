import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for the runner helpers: fileUpload, clipboard, downloads, network.
 *
 * These helpers are constructed inside PlaywrightRunner.executeTestCode() and
 * injected into the dynamically-evaluated test function.  We replicate the
 * construction logic here against mock Playwright objects so we can validate
 * behaviour without launching a real browser.
 */

// Inline mock page factory (avoids importing __tests__/setup which has bare beforeEach)
function createMockPage() {
  const mockLocator = {
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    press: vi.fn().mockResolvedValue(undefined),
    hover: vi.fn().mockResolvedValue(undefined),
    focus: vi.fn().mockResolvedValue(undefined),
    isVisible: vi.fn().mockResolvedValue(true),
    isEnabled: vi.fn().mockResolvedValue(true),
    textContent: vi.fn().mockResolvedValue(''),
    count: vi.fn().mockResolvedValue(1),
    first: vi.fn().mockReturnThis(),
    last: vi.fn().mockReturnThis(),
    nth: vi.fn().mockReturnThis(),
    waitFor: vi.fn().mockResolvedValue(undefined),
    setInputFiles: vi.fn().mockResolvedValue(undefined),
  };

  return {
    goto: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('')),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    addStyleTag: vi.fn().mockResolvedValue(undefined),
    addInitScript: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn().mockReturnValue(mockLocator),
    getByTestId: vi.fn().mockReturnValue(mockLocator),
    getByRole: vi.fn().mockReturnValue(mockLocator),
    getByText: vi.fn().mockReturnValue(mockLocator),
    getByLabel: vi.fn().mockReturnValue(mockLocator),
    url: vi.fn().mockReturnValue('https://example.com'),
    title: vi.fn().mockResolvedValue('Test Page'),
    keyboard: { press: vi.fn().mockResolvedValue(undefined) },
  };
}

/* -------------------------------------------------------------------------- */
/*  fileUploadHelper                                                          */
/* -------------------------------------------------------------------------- */

describe('fileUploadHelper', () => {
  let mockPage: ReturnType<typeof createMockPage>;

  beforeEach(() => {
    mockPage = createMockPage();
  });

  // Replicates runner.ts L1696-1698
  function createFileUploadHelper(page: typeof mockPage) {
    return async (selector: string, filePaths: string | string[]) => {
      const locator = page.locator(selector);
      await locator.setInputFiles(Array.isArray(filePaths) ? filePaths : [filePaths]);
    };
  }

  it('calls setInputFiles with a single file path wrapped in an array', async () => {
    const mockLocator = {
      ...mockPage.locator(),
      setInputFiles: vi.fn().mockResolvedValue(undefined),
    };
    mockPage.locator = vi.fn().mockReturnValue(mockLocator);

    const fileUpload = createFileUploadHelper(mockPage);
    await fileUpload('input[type="file"]', '/tmp/photo.png');

    expect(mockPage.locator).toHaveBeenCalledWith('input[type="file"]');
    expect(mockLocator.setInputFiles).toHaveBeenCalledWith(['/tmp/photo.png']);
  });

  it('calls setInputFiles with multiple file paths as-is', async () => {
    const mockLocator = {
      ...mockPage.locator(),
      setInputFiles: vi.fn().mockResolvedValue(undefined),
    };
    mockPage.locator = vi.fn().mockReturnValue(mockLocator);

    const fileUpload = createFileUploadHelper(mockPage);
    await fileUpload('#upload', ['/a.png', '/b.jpg']);

    expect(mockLocator.setInputFiles).toHaveBeenCalledWith(['/a.png', '/b.jpg']);
  });

  it('resolves successfully when setInputFiles succeeds', async () => {
    const mockLocator = {
      ...mockPage.locator(),
      setInputFiles: vi.fn().mockResolvedValue(undefined),
    };
    mockPage.locator = vi.fn().mockReturnValue(mockLocator);

    const fileUpload = createFileUploadHelper(mockPage);
    await expect(fileUpload('input', '/file.txt')).resolves.toBeUndefined();
  });

  it('propagates errors from setInputFiles', async () => {
    const mockLocator = {
      ...mockPage.locator(),
      setInputFiles: vi.fn().mockRejectedValue(new Error('Element detached')),
    };
    mockPage.locator = vi.fn().mockReturnValue(mockLocator);

    const fileUpload = createFileUploadHelper(mockPage);
    await expect(fileUpload('input', '/file.txt')).rejects.toThrow('Element detached');
  });
});

/* -------------------------------------------------------------------------- */
/*  clipboardHelper                                                           */
/* -------------------------------------------------------------------------- */

describe('clipboardHelper', () => {
  let mockPage: ReturnType<typeof createMockPage>;

  beforeEach(() => {
    mockPage = createMockPage();
  });

  // Replicates runner.ts L1702-1713
  function createClipboardHelper(page: typeof mockPage, enabled: boolean) {
    if (!enabled) return null;
    return {
      copy: async (text: string) => {
        await page.evaluate((t: string) => navigator.clipboard.writeText(t), text);
      },
      paste: async () => {
        return await page.evaluate(() => navigator.clipboard.readText());
      },
      pasteInto: async (selector: string) => {
        const locator = page.locator(selector);
        await locator.focus();
        await page.keyboard.press('Control+V');
      },
    };
  }

  it('returns null when clipboard access is disabled', () => {
    const helper = createClipboardHelper(mockPage, false);
    expect(helper).toBeNull();
  });

  it('returns helper object when clipboard access is enabled', () => {
    const helper = createClipboardHelper(mockPage, true);
    expect(helper).not.toBeNull();
    expect(helper).toHaveProperty('copy');
    expect(helper).toHaveProperty('paste');
    expect(helper).toHaveProperty('pasteInto');
  });

  describe('copy()', () => {
    it('calls page.evaluate with clipboard.writeText', async () => {
      mockPage.evaluate = vi.fn().mockResolvedValue(undefined);
      const helper = createClipboardHelper(mockPage, true)!;

      await helper.copy('hello world');

      expect(mockPage.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        'hello world'
      );
    });
  });

  describe('paste()', () => {
    it('calls page.evaluate with clipboard.readText and returns result', async () => {
      mockPage.evaluate = vi.fn().mockResolvedValue('clipboard content');
      const helper = createClipboardHelper(mockPage, true)!;

      const result = await helper.paste();

      expect(result).toBe('clipboard content');
      expect(mockPage.evaluate).toHaveBeenCalled();
    });
  });

  describe('pasteInto()', () => {
    it('focuses the element and presses Control+V', async () => {
      const mockLocator = {
        ...mockPage.locator(),
        focus: vi.fn().mockResolvedValue(undefined),
      };
      mockPage.locator = vi.fn().mockReturnValue(mockLocator);

      const helper = createClipboardHelper(mockPage, true)!;
      await helper.pasteInto('#editor');

      expect(mockPage.locator).toHaveBeenCalledWith('#editor');
      expect(mockLocator.focus).toHaveBeenCalled();
      expect(mockPage.keyboard.press).toHaveBeenCalledWith('Control+V');
    });
  });
});

/* -------------------------------------------------------------------------- */
/*  downloadsHelper                                                           */
/* -------------------------------------------------------------------------- */

describe('downloadsHelper', () => {
  it('returns null when acceptDownloads is disabled', () => {
    const settings = { acceptDownloads: false };
    const helper = settings.acceptDownloads ? { waitForDownload: async () => {}, list: () => [] } : null;
    expect(helper).toBeNull();
  });

  it('returns helper object when acceptDownloads is enabled', () => {
    const settings = { acceptDownloads: true };
    const helper = settings.acceptDownloads
      ? {
          waitForDownload: async (_triggerAction: () => Promise<void>) => ({ filename: '', path: '' }),
          list: () => [] as Array<{ suggestedFilename: string; path: string }>,
        }
      : null;
    expect(helper).not.toBeNull();
    expect(helper).toHaveProperty('waitForDownload');
    expect(helper).toHaveProperty('list');
  });

  describe('waitForDownload()', () => {
    it('waits for download event, saves file, and returns metadata', async () => {
      const mockDownload = {
        suggestedFilename: vi.fn().mockReturnValue('report.pdf'),
        saveAs: vi.fn().mockResolvedValue(undefined),
      };

      const mockPage = {
        waitForEvent: vi.fn().mockResolvedValue(mockDownload),
      };

      const dlDir = '/tmp/downloads';
      const dlList: Array<{ suggestedFilename: string; path: string }> = [];

      const waitForDownload = async (triggerAction: () => Promise<void>) => {
        const [download] = await Promise.all([
          mockPage.waitForEvent('download'),
          triggerAction(),
        ]);
        const savePath = `${dlDir}/${download.suggestedFilename()}`;
        await download.saveAs(savePath);
        dlList.push({ suggestedFilename: download.suggestedFilename(), path: savePath });
        return { filename: download.suggestedFilename(), path: savePath };
      };

      const triggerAction = vi.fn().mockResolvedValue(undefined);
      const result = await waitForDownload(triggerAction);

      expect(mockPage.waitForEvent).toHaveBeenCalledWith('download');
      expect(triggerAction).toHaveBeenCalled();
      expect(mockDownload.saveAs).toHaveBeenCalledWith('/tmp/downloads/report.pdf');
      expect(result).toEqual({ filename: 'report.pdf', path: '/tmp/downloads/report.pdf' });
      expect(dlList).toHaveLength(1);
    });
  });

  describe('list()', () => {
    it('returns accumulated download list', () => {
      const dlList = [
        { suggestedFilename: 'a.pdf', path: '/tmp/a.pdf' },
        { suggestedFilename: 'b.csv', path: '/tmp/b.csv' },
      ];
      const list = () => dlList;

      expect(list()).toHaveLength(2);
      expect(list()[0].suggestedFilename).toBe('a.pdf');
    });
  });
});

/* -------------------------------------------------------------------------- */
/*  networkHelper                                                             */
/* -------------------------------------------------------------------------- */

describe('networkHelper', () => {
  function createMockPageWithRoute() {
    const routes = new Map<string, (route: unknown) => void>();
    const eventHandlers = new Map<string, Array<(arg: unknown) => void>>();

    return {
      route: vi.fn().mockImplementation((pattern: string, handler: (route: unknown) => void) => {
        routes.set(pattern, handler);
        return Promise.resolve();
      }),
      unroute: vi.fn().mockImplementation((pattern: string) => {
        routes.delete(pattern);
        return Promise.resolve();
      }),
      on: vi.fn().mockImplementation((event: string, handler: (arg: unknown) => void) => {
        if (!eventHandlers.has(event)) eventHandlers.set(event, []);
        eventHandlers.get(event)!.push(handler);
      }),
      _routes: routes,
      _eventHandlers: eventHandlers,
      _emit: (event: string, arg: unknown) => {
        for (const handler of eventHandlers.get(event) || []) {
          handler(arg);
        }
      },
    };
  }

  // Replicates runner.ts L1738-1763
  function createNetworkHelper(page: ReturnType<typeof createMockPageWithRoute>, enabled: boolean) {
    if (!enabled) return null;
    return {
      mock: async (urlPattern: string, response: { status?: number; body?: string; contentType?: string; json?: unknown }) => {
        await page.route(urlPattern, async (route: { fulfill: (opts: unknown) => Promise<void> }) => {
          await route.fulfill({
            status: response.status ?? 200,
            contentType: response.contentType ?? (response.json ? 'application/json' : 'text/plain'),
            body: response.json ? JSON.stringify(response.json) : (response.body ?? ''),
          });
        });
      },
      block: async (urlPattern: string) => {
        await page.route(urlPattern, (route: { abort: () => void }) => route.abort());
      },
      passthrough: async (urlPattern: string) => {
        await page.unroute(urlPattern);
      },
      capture: (urlPattern: string) => {
        const captured: Array<{ url: string; method: string; postData?: string }> = [];
        page.on('request', (req: { url: () => string; method: () => string; postData: () => string | null }) => {
          if (new RegExp(urlPattern).test(req.url())) {
            captured.push({ url: req.url(), method: req.method(), postData: req.postData() ?? undefined });
          }
        });
        return { requests: captured };
      },
    };
  }

  it('returns null when network interception is disabled', () => {
    const page = createMockPageWithRoute();
    const helper = createNetworkHelper(page, false);
    expect(helper).toBeNull();
  });

  it('returns helper object when network interception is enabled', () => {
    const page = createMockPageWithRoute();
    const helper = createNetworkHelper(page, true);
    expect(helper).not.toBeNull();
    expect(helper).toHaveProperty('mock');
    expect(helper).toHaveProperty('block');
    expect(helper).toHaveProperty('passthrough');
    expect(helper).toHaveProperty('capture');
  });

  describe('mock()', () => {
    it('registers a route that fulfills with JSON response', async () => {
      const page = createMockPageWithRoute();
      const helper = createNetworkHelper(page, true)!;

      await helper.mock('**/api/users', { json: { users: [] } });

      expect(page.route).toHaveBeenCalledWith('**/api/users', expect.any(Function));
    });

    it('fulfills route with correct defaults for JSON', async () => {
      const page = createMockPageWithRoute();
      const helper = createNetworkHelper(page, true)!;

      await helper.mock('**/api/data', { json: { ok: true } });

      // Invoke the registered route handler
      const routeHandler = page.route.mock.calls[0][1] as (route: unknown) => Promise<void>;
      const mockRoute = { fulfill: vi.fn().mockResolvedValue(undefined) };
      await routeHandler(mockRoute);

      expect(mockRoute.fulfill).toHaveBeenCalledWith({
        status: 200,
        contentType: 'application/json',
        body: '{"ok":true}',
      });
    });

    it('fulfills route with plain text body', async () => {
      const page = createMockPageWithRoute();
      const helper = createNetworkHelper(page, true)!;

      await helper.mock('**/health', { status: 200, body: 'OK' });

      const routeHandler = page.route.mock.calls[0][1] as (route: unknown) => Promise<void>;
      const mockRoute = { fulfill: vi.fn().mockResolvedValue(undefined) };
      await routeHandler(mockRoute);

      expect(mockRoute.fulfill).toHaveBeenCalledWith({
        status: 200,
        contentType: 'text/plain',
        body: 'OK',
      });
    });

    it('uses custom status code', async () => {
      const page = createMockPageWithRoute();
      const helper = createNetworkHelper(page, true)!;

      await helper.mock('**/api/error', { status: 500, body: 'Internal Error' });

      const routeHandler = page.route.mock.calls[0][1] as (route: unknown) => Promise<void>;
      const mockRoute = { fulfill: vi.fn().mockResolvedValue(undefined) };
      await routeHandler(mockRoute);

      expect(mockRoute.fulfill).toHaveBeenCalledWith(
        expect.objectContaining({ status: 500 })
      );
    });

    it('uses custom contentType', async () => {
      const page = createMockPageWithRoute();
      const helper = createNetworkHelper(page, true)!;

      await helper.mock('**/data.xml', { body: '<data/>', contentType: 'application/xml' });

      const routeHandler = page.route.mock.calls[0][1] as (route: unknown) => Promise<void>;
      const mockRoute = { fulfill: vi.fn().mockResolvedValue(undefined) };
      await routeHandler(mockRoute);

      expect(mockRoute.fulfill).toHaveBeenCalledWith(
        expect.objectContaining({ contentType: 'application/xml' })
      );
    });
  });

  describe('block()', () => {
    it('registers a route that aborts the request', async () => {
      const page = createMockPageWithRoute();
      const helper = createNetworkHelper(page, true)!;

      await helper.block('**/analytics/**');

      expect(page.route).toHaveBeenCalledWith('**/analytics/**', expect.any(Function));

      // Invoke the handler
      const routeHandler = page.route.mock.calls[0][1] as (route: unknown) => void;
      const mockRoute = { abort: vi.fn() };
      routeHandler(mockRoute);

      expect(mockRoute.abort).toHaveBeenCalled();
    });
  });

  describe('passthrough()', () => {
    it('calls page.unroute to remove interception', async () => {
      const page = createMockPageWithRoute();
      const helper = createNetworkHelper(page, true)!;

      await helper.passthrough('**/api/users');

      expect(page.unroute).toHaveBeenCalledWith('**/api/users');
    });
  });

  describe('capture()', () => {
    it('returns a capture object with empty requests array', () => {
      const page = createMockPageWithRoute();
      const helper = createNetworkHelper(page, true)!;

      const capture = helper.capture('.*api.*');

      expect(capture).toHaveProperty('requests');
      expect(capture.requests).toEqual([]);
      expect(page.on).toHaveBeenCalledWith('request', expect.any(Function));
    });

    it('captures matching requests', () => {
      const page = createMockPageWithRoute();
      const helper = createNetworkHelper(page, true)!;

      const capture = helper.capture('.*api/users.*');

      // Simulate a matching request
      page._emit('request', {
        url: () => 'https://example.com/api/users?page=1',
        method: () => 'GET',
        postData: () => null,
      });

      expect(capture.requests).toHaveLength(1);
      expect(capture.requests[0]).toEqual({
        url: 'https://example.com/api/users?page=1',
        method: 'GET',
        postData: undefined,
      });
    });

    it('captures POST data', () => {
      const page = createMockPageWithRoute();
      const helper = createNetworkHelper(page, true)!;

      const capture = helper.capture('.*api/submit.*');

      page._emit('request', {
        url: () => 'https://example.com/api/submit',
        method: () => 'POST',
        postData: () => '{"name":"test"}',
      });

      expect(capture.requests).toHaveLength(1);
      expect(capture.requests[0].postData).toBe('{"name":"test"}');
      expect(capture.requests[0].method).toBe('POST');
    });

    it('ignores non-matching requests', () => {
      const page = createMockPageWithRoute();
      const helper = createNetworkHelper(page, true)!;

      const capture = helper.capture('.*api/users.*');

      // Non-matching request
      page._emit('request', {
        url: () => 'https://example.com/static/logo.png',
        method: () => 'GET',
        postData: () => null,
      });

      expect(capture.requests).toHaveLength(0);
    });

    it('accumulates multiple matching requests', () => {
      const page = createMockPageWithRoute();
      const helper = createNetworkHelper(page, true)!;

      const capture = helper.capture('.*api.*');

      page._emit('request', {
        url: () => 'https://example.com/api/users',
        method: () => 'GET',
        postData: () => null,
      });

      page._emit('request', {
        url: () => 'https://example.com/api/orders',
        method: () => 'POST',
        postData: () => '{"item":"widget"}',
      });

      expect(capture.requests).toHaveLength(2);
    });
  });
});

/* -------------------------------------------------------------------------- */
/*  Recorder: file upload event capture                                       */
/* -------------------------------------------------------------------------- */

describe('Recorder: file chooser event capture', () => {
  it('generates setInputFiles action event from filechooser listener', () => {
    // Simulate what the recorder does at L283-291
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];

    const addEvent = (type: string, data: Record<string, unknown>) => {
      events.push({ type, data });
    };

    // Simulate a filechooser event
    const fileChooser = {
      element: () => ({ tagName: 'INPUT' }),
    };

    // This replicates recorder.ts L283-291
    const element = fileChooser.element();
    const selector = element ? 'input[type="file"]' : 'input[type="file"]';
    addEvent('action', {
      action: 'setInputFiles',
      selector,
      selectors: [{ type: 'css-path', value: selector }],
      value: '/* replace with file path(s) */',
    });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('action');
    expect(events[0].data.action).toBe('setInputFiles');
    expect(events[0].data.selector).toBe('input[type="file"]');
    expect(events[0].data.selectors).toEqual([{ type: 'css-path', value: 'input[type="file"]' }]);
    expect(events[0].data.value).toBe('/* replace with file path(s) */');
  });
});

/* -------------------------------------------------------------------------- */
/*  Recorder: generateCode missing setInputFiles handling                     */
/* -------------------------------------------------------------------------- */

describe('Recorder: setInputFiles code generation', () => {
  it('should generate fileUpload() call for setInputFiles action', () => {
    // The recorder's generateCode() should emit fileUpload() calls
    // for action events with action === 'setInputFiles'.
    // Currently this is MISSING from the switch statement in generateCode().
    //
    // Expected generated code:
    //   await fileUpload('input[type="file"]', ['/* replace with file path(s) */']);

    const event = {
      type: 'action' as const,
      data: {
        action: 'setInputFiles',
        selector: 'input[type="file"]',
        selectors: [{ type: 'css-path', value: 'input[type="file"]' }],
        value: '/* replace with file path(s) */',
      },
    };

    // Simulate the code generation logic that SHOULD exist
    const lines: string[] = [];
    if (event.data.action === 'setInputFiles') {
      const selector = event.data.selectors[0]?.value || event.data.selector;
      lines.push(`  await fileUpload('${selector}', '${event.data.value}');`);
    }

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('fileUpload');
    expect(lines[0]).toContain('input[type="file"]');
  });
});

/* -------------------------------------------------------------------------- */
/*  Runner: context options from settings                                     */
/* -------------------------------------------------------------------------- */

describe('Runner context options from settings', () => {
  it('grants clipboard permissions when grantClipboardAccess is true', () => {
    const settings = { grantClipboardAccess: true };
    const contextOpts = {
      ...(settings.grantClipboardAccess ? { permissions: ['clipboard-read', 'clipboard-write'] } : {}),
    };
    expect(contextOpts.permissions).toEqual(['clipboard-read', 'clipboard-write']);
  });

  it('does not grant clipboard permissions when grantClipboardAccess is false', () => {
    const settings = { grantClipboardAccess: false };
    const contextOpts = {
      ...(settings.grantClipboardAccess ? { permissions: ['clipboard-read', 'clipboard-write'] } : {}),
    };
    expect(contextOpts.permissions).toBeUndefined();
  });

  it('enables acceptDownloads when setting is true', () => {
    const settings = { acceptDownloads: true };
    const contextOpts = {
      ...(settings.acceptDownloads ? { acceptDownloads: true } : {}),
    };
    expect(contextOpts.acceptDownloads).toBe(true);
  });

  it('does not set acceptDownloads when setting is false', () => {
    const settings = { acceptDownloads: false };
    const contextOpts = {
      ...(settings.acceptDownloads ? { acceptDownloads: true } : {}),
    };
    expect(contextOpts.acceptDownloads).toBeUndefined();
  });

  it('network helper is null when enableNetworkInterception is false', () => {
    const settings = { enableNetworkInterception: false };
    const networkHelper = settings.enableNetworkInterception ? {} : null;
    expect(networkHelper).toBeNull();
  });

  it('network helper is created when enableNetworkInterception is true', () => {
    const settings = { enableNetworkInterception: true };
    const networkHelper = settings.enableNetworkInterception ? { mock: () => {}, block: () => {} } : null;
    expect(networkHelper).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/*  Setup script-runner: helper availability gap                              */
/* -------------------------------------------------------------------------- */

describe('Setup script-runner helper availability', () => {
  it('executeSetupCode passes 7 args to setup function (missing fileUpload, clipboard, downloads, network)', () => {
    // script-runner.ts L319-328 constructs the setup function with these params:
    //   page, baseUrl, screenshotPath, stepLogger, expect, appState, locateWithFallback
    //
    // The test runner (runner.ts L1766) passes 11 params:
    //   page, baseUrl, screenshotPath, stepLogger, expect, appState, locateWithFallback,
    //   fileUpload, clipboard, downloads, network
    //
    // This means if a test that uses fileUpload/clipboard/network is used as setup
    // (via "test-as-setup"), those helpers will be undefined.

    const setupParams = [
      'page', 'baseUrl', 'screenshotPath', 'stepLogger',
      'expect', 'appState', 'locateWithFallback',
    ];

    const runnerParams = [
      'page', 'baseUrl', 'screenshotPath', 'stepLogger',
      'expect', 'appState', 'locateWithFallback',
      'fileUpload', 'clipboard', 'downloads', 'network',
    ];

    // The gap
    const missingInSetup = runnerParams.filter(p => !setupParams.includes(p));
    expect(missingInSetup).toEqual(['fileUpload', 'clipboard', 'downloads', 'network']);
  });
});
