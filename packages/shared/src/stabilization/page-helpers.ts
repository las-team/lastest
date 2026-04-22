import type { StabilizationPage } from './types';

/**
 * Wait for all spinners/loading indicators to disappear.
 */
export async function waitForSpinnersToDisappear(
  page: StabilizationPage,
  customSelectors: string[],
  timeout: number
): Promise<void> {
  const defaultSelectors = [
    '[class~="spinner"]',
    '[class~="loading"]',
    '[class~="loader"]',
    '[class~="skeleton"]',
    '[class~="shimmer"]',
    '[class~="pulse"]',
    '[aria-busy="true"]',
    '[data-loading="true"]',
    '[data-testid*="loading"]',
    '[data-testid*="spinner"]',
    '.MuiCircularProgress-root',
    '.MuiLinearProgress-root',
    '.ant-spin',
    '.ant-skeleton',
    '.chakra-spinner',
    '.chakra-skeleton',
  ];

  const allSelectors = [...defaultSelectors, ...customSelectors];

  await Promise.race([
    Promise.all(
      allSelectors.map((sel) =>
        page.waitForSelector(sel, { state: 'hidden', timeout }).catch(() => {})
      )
    ),
    page.waitForTimeout(timeout),
  ]);
}

/**
 * Wait for stylesheets and fonts to be fully loaded.
 */
export async function waitForStylesLoaded(page: StabilizationPage, timeout: number): Promise<void> {
  await page.evaluate((t) => {
    return Promise.race([
      Promise.all([
        document.fonts.ready,
        Promise.all(
          Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(
            (link) =>
              new Promise<boolean>((resolve) => {
                const linkEl = link as HTMLLinkElement;
                if (linkEl.sheet) {
                  resolve(true);
                } else {
                  linkEl.onload = () => resolve(true);
                  linkEl.onerror = () => resolve(true);
                }
              })
          )
        ),
      ]),
      new Promise((resolve) => setTimeout(resolve, t)),
    ]);
  }, timeout);
}

/**
 * Wait for all visible images to finish loading.
 */
export async function waitForImagesLoaded(page: StabilizationPage, timeout: number): Promise<void> {
  await Promise.race([
    page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      return Promise.all(
        imgs
          .filter((img) => {
            if (!img.src && !img.currentSrc) return false;
            if (img.loading === 'lazy' && !img.complete) return false;
            return true;
          })
          .map(
            (img) =>
              new Promise<void>((resolve) => {
                if (img.complete && img.naturalWidth > 0) {
                  resolve();
                } else {
                  img.addEventListener('load', () => resolve(), { once: true });
                  img.addEventListener('error', () => resolve(), { once: true });
                }
              })
          )
      );
    }),
    page.waitForTimeout(timeout),
  ]);
}

/**
 * Wait for DOM to stabilize (no mutations for a period).
 */
export async function waitForDomStable(page: StabilizationPage, timeout: number, stableMs = 200): Promise<void> {
  await page.evaluate(
    ({ timeout: t, stableMs: s }) => {
      return new Promise<boolean>((resolve) => {
        let timer: ReturnType<typeof setTimeout>;
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            observer.disconnect();
            resolve(true);
          }, s);
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        });

        setTimeout(() => {
          observer.disconnect();
          resolve(true);
        }, t);

        timer = setTimeout(() => {
          observer.disconnect();
          resolve(true);
        }, s);
      });
    },
    { timeout, stableMs }
  );
}

/**
 * Wait for all canvas elements to produce stable output.
 */
export async function waitForCanvasStable(
  page: StabilizationPage,
  _timeout: number,
  threshold: number
): Promise<void> {
  await page.evaluate(({ stableNeeded }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const flush = (window as any).__flushAnimationFrames;
    if (typeof flush !== 'function') return;

    let lastDataUrls = '';
    let stableCount = 0;

    for (let i = 0; i < 30; i++) {
      flush(15);
      const canvases = Array.from(document.querySelectorAll('canvas'));
      const dataUrls = canvases.map((c: HTMLCanvasElement) => {
        try { return c.toDataURL(); } catch { return ''; }
      }).join('|');

      if (dataUrls === lastDataUrls) {
        stableCount++;
        if (stableCount >= stableNeeded) return;
      } else {
        stableCount = 0;
      }
      lastDataUrls = dataUrls;
    }
  }, { stableNeeded: threshold }).catch(() => {});
}

/**
 * Inject CSS via CSSOM to bypass Content Security Policy restrictions.
 * Falls back to addStyleTag if CSSOM injection fails.
 */
export async function injectCSS(page: StabilizationPage, css: string): Promise<void> {
  try {
    await page.evaluate((cssText) => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(cssText);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }, css);
  } catch {
    await page.addStyleTag({ content: css });
  }
}
