import type { Page } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import type { StabilityMetadata } from '@/lib/db/schema';

interface BurstCaptureOptions {
  frameCount: number;
  stabilityThreshold: number;
}

interface BurstCaptureResult {
  buffer: Buffer;
  stabilityMetadata: StabilityMetadata;
}

/**
 * Capture N screenshots in rapid succession and compare consecutive frames.
 * Returns the last frame as the canonical screenshot along with stability metadata.
 */
export async function captureWithBurst(
  page: Page,
  screenshotOptions: Parameters<Page['screenshot']>[0],
  options: BurstCaptureOptions
): Promise<BurstCaptureResult> {
  const { frameCount, stabilityThreshold } = options;

  // Capture frames in-memory (no path option)
  const frames: Buffer[] = [];
  for (let i = 0; i < frameCount; i++) {
    const buffer = await page.screenshot({
      ...screenshotOptions,
      path: undefined, // Always capture to buffer
    });
    frames.push(Buffer.from(buffer));
  }

  // Compare consecutive frame pairs
  let stableFrames = 0;
  let maxFrameDiff = 0;

  for (let i = 1; i < frames.length; i++) {
    const prev = PNG.sync.read(frames[i - 1]);
    const curr = PNG.sync.read(frames[i]);

    if (prev.width !== curr.width || prev.height !== curr.height) {
      // Size mismatch between frames - mark as unstable
      maxFrameDiff = 100;
      continue;
    }

    const totalPixels = prev.width * prev.height;
    const output = new Uint8Array(prev.width * prev.height * 4);
    const diffPixels = pixelmatch(
      prev.data,
      curr.data,
      output,
      prev.width,
      prev.height,
      { threshold: 0.1 }
    );

    const diffPercent = (diffPixels / totalPixels) * 100;
    maxFrameDiff = Math.max(maxFrameDiff, diffPercent);

    if (diffPercent <= stabilityThreshold) {
      stableFrames++;
    }
  }

  const isStable = stableFrames === frames.length - 1;

  return {
    buffer: frames[frames.length - 1], // Use last frame as canonical
    stabilityMetadata: {
      frameCount: frames.length,
      stableFrames,
      maxFrameDiff: Math.round(maxFrameDiff * 100) / 100,
      isStable,
    },
  };
}
