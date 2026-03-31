import { describe, it, expect, afterAll } from 'vitest';
import { extractText, terminateWorker } from './ocr';
import { PNG } from 'pngjs';

/**
 * Creates a simple PNG buffer with black text-like pixels on white background.
 * Not real text, but enough to verify Tesseract initializes and processes without crashing.
 */
function createTestPng(width = 200, height = 50): Buffer {
  const png = new PNG({ width, height });
  // Fill white background
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      png.data[idx] = 255;     // R
      png.data[idx + 1] = 255; // G
      png.data[idx + 2] = 255; // B
      png.data[idx + 3] = 255; // A
    }
  }
  // Draw a crude "T" shape in black pixels
  for (let x = 60; x < 140; x++) {
    for (let y = 10; y < 15; y++) {
      const idx = (y * width + x) * 4;
      png.data[idx] = 0;
      png.data[idx + 1] = 0;
      png.data[idx + 2] = 0;
    }
  }
  for (let y = 15; y < 40; y++) {
    for (let x = 95; x < 105; x++) {
      const idx = (y * width + x) * 4;
      png.data[idx] = 0;
      png.data[idx + 1] = 0;
      png.data[idx + 2] = 0;
    }
  }
  return PNG.sync.write(png);
}

describe('Tesseract OCR', () => {
  afterAll(async () => {
    await terminateWorker();
  });

  it('initializes worker and processes an image without error', async () => {
    const png = createTestPng();
    // extractText returns string | null — we just need it to not throw
    const result = await extractText(png);
    expect(result === null || typeof result === 'string').toBe(true);
  }, 15_000);

  it('returns null for a blank white image', async () => {
    const png = new PNG({ width: 100, height: 100 });
    for (let i = 0; i < png.data.length; i += 4) {
      png.data[i] = 255;
      png.data[i + 1] = 255;
      png.data[i + 2] = 255;
      png.data[i + 3] = 255;
    }
    const result = await extractText(PNG.sync.write(png));
    // Blank image should return null (no text or low confidence)
    expect(result).toBeNull();
  }, 15_000);
});
