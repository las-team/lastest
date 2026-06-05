/**
 * Helper factories used by both runners
 * (`packages/runner/src/runner.ts` and
 * `packages/embedded-browser/src/test-executor.ts`) to construct the
 * `fileUpload`, `clipboard`, `downloads`, `network`, and `fixtures` arguments
 * that get injected into the `new AsyncFunction(...)` test body.
 *
 * The implementations are lifted from the remote runner's inline code; they
 * have not changed. Moving them here lets the EB executor stop passing
 * `null` for `fileUpload / clipboard / network` and `{}` for `fixtures` (it
 * previously did not implement these), making the two runners behave
 * identically against the same user code.
 *
 * Targets are duck-typed (no `Page` import) so this module stays free of a
 * Playwright dep at the package level — the runners both already import
 * `playwright` and can pass their real `Page` instance.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import fs from "fs";
import os from "os";
import path from "path";

export type FileUploadHelper = (
  selector: string,
  filePaths: string | string[],
) => Promise<void>;

export interface ClipboardHelper {
  copy: (text: string) => Promise<void>;
  paste: () => Promise<string>;
  pasteInto: (selector: string) => Promise<void>;
}

export interface DownloadInfo {
  suggestedFilename: string;
  path: string;
}

export interface DownloadsHelper {
  waitForDownload: (
    triggerAction: () => Promise<void>,
  ) => Promise<{ filename: string; path: string }>;
  list: () => DownloadInfo[];
  waitForAny: (timeoutMs?: number) => Promise<void>;
}

export interface NetworkMockResponse {
  status?: number;
  body?: string;
  contentType?: string;
  json?: unknown;
}

export interface NetworkHelper {
  mock: (urlPattern: string, response: NetworkMockResponse) => Promise<void>;
  block: (urlPattern: string) => Promise<void>;
  passthrough: (urlPattern: string) => Promise<void>;
  capture: (urlPattern: string) => {
    requests: Array<{ url: string; method: string; postData?: string }>;
  };
}

export interface FixturePayload {
  filename: string;
  /** Base64-encoded file contents. */
  data: string;
}

// ────────────────────────────────────────────────────────────────────────
// File uploads
// ────────────────────────────────────────────────────────────────────────
export function createFileUploadHelper(page: any): FileUploadHelper {
  return async (selector: string, filePaths: string | string[]) => {
    const locator = page.locator(selector);
    await locator.setInputFiles(
      Array.isArray(filePaths) ? filePaths : [filePaths],
    );
  };
}

// ────────────────────────────────────────────────────────────────────────
// Clipboard (requires permission grant; null when not granted)
// ────────────────────────────────────────────────────────────────────────
export function createClipboardHelper(
  page: any,
  opts: { granted: boolean },
): ClipboardHelper | null {
  if (!opts.granted) return null;
  return {
    copy: async (text: string) => {
      await page.evaluate(
        (t: string) => navigator.clipboard.writeText(t),
        text,
      );
    },
    paste: async () => {
      return await page.evaluate(() => navigator.clipboard.readText());
    },
    pasteInto: async (selector: string) => {
      await page.locator(selector).focus();
      await page.keyboard.press("Control+V");
    },
  };
}

// ────────────────────────────────────────────────────────────────────────
// Downloads
// ────────────────────────────────────────────────────────────────────────
export function createDownloadsHelper(
  page: any,
  opts: { accept: boolean; tmpDir?: string },
): { helper: DownloadsHelper; cleanupDir: string } {
  if (!opts.accept) {
    return {
      helper: {
        waitForDownload: async () => {
          throw new Error(
            'Downloads not enabled — enable "Accept Downloads" in Playwright settings',
          );
        },
        list: () => [],
        waitForAny: async () => {},
      },
      cleanupDir: "",
    };
  }

  const dlDir =
    opts.tmpDir ??
    path.join(
      os.tmpdir(),
      `lastest-dl-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
  fs.mkdirSync(dlDir, { recursive: true });

  const dlList: DownloadInfo[] = [];
  const helper: DownloadsHelper = {
    waitForDownload: async (triggerAction: () => Promise<void>) => {
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        triggerAction(),
      ]);
      const safeName = path
        .basename(download.suggestedFilename())
        .replace(/\.\./g, "_");
      const savePath = path.join(dlDir, safeName);
      await download.saveAs(savePath);
      dlList.push({ suggestedFilename: safeName, path: savePath });
      return { filename: safeName, path: savePath };
    },
    list: () => dlList,
    waitForAny: async (timeoutMs = 5000) => {
      const start = Date.now();
      while (dlList.length === 0 && Date.now() - start < timeoutMs) {
        await page.waitForTimeout(250);
      }
    },
  };
  return { helper, cleanupDir: dlDir };
}

// ────────────────────────────────────────────────────────────────────────
// Network — mock/block/passthrough/capture
// ────────────────────────────────────────────────────────────────────────
export function createNetworkHelper(page: any): NetworkHelper {
  return {
    mock: async (urlPattern: string, response: NetworkMockResponse) => {
      await page.route(urlPattern, async (route: any) => {
        await route.fulfill({
          status: response.status ?? 200,
          contentType:
            response.contentType ??
            (response.json ? "application/json" : "text/plain"),
          body: response.json
            ? JSON.stringify(response.json)
            : (response.body ?? ""),
        });
      });
    },
    block: async (urlPattern: string) => {
      await page.route(urlPattern, (route: any) => route.abort());
    },
    passthrough: async (urlPattern: string) => {
      await page.unroute(urlPattern);
    },
    capture: (urlPattern: string) => {
      const captured: Array<{
        url: string;
        method: string;
        postData?: string;
      }> = [];
      page.on("request", (req: any) => {
        if (new RegExp(urlPattern).test(req.url())) {
          captured.push({
            url: req.url(),
            method: req.method(),
            postData: req.postData() ?? undefined,
          });
        }
      });
      return { requests: captured };
    },
  };
}

// ────────────────────────────────────────────────────────────────────────
// Fixtures — decode base64 payloads to a temp dir; return filename → path map
// ────────────────────────────────────────────────────────────────────────
export function decodeFixturesToTmp(
  fixtures: FixturePayload[] | undefined,
  tmpKey: string,
): { fixturesMap: Record<string, string>; cleanupDir: string } {
  const fixturesMap: Record<string, string> = {};
  if (!fixtures || fixtures.length === 0)
    return { fixturesMap, cleanupDir: "" };

  const fixtureDir = path.join(os.tmpdir(), `lastest-fixtures-${tmpKey}`);
  fs.mkdirSync(fixtureDir, { recursive: true });
  for (const fixture of fixtures) {
    const safeName = path.basename(fixture.filename).replace(/\.\./g, "_");
    const fixturePath = path.join(fixtureDir, safeName);
    fs.writeFileSync(fixturePath, Buffer.from(fixture.data, "base64"));
    fixturesMap[fixture.filename] = fixturePath;
  }
  return { fixturesMap, cleanupDir: fixtureDir };
}
