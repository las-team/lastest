import { describe, it, expect } from 'vitest';
import { computePixelmatch, computeSSIM, computeButteraugli, runDiffEngine } from './engines';

function makeImage(width: number, height: number, color: [number, number, number, number]): Buffer {
  const buf = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    buf[i * 4] = color[0];
    buf[i * 4 + 1] = color[1];
    buf[i * 4 + 2] = color[2];
    buf[i * 4 + 3] = color[3];
  }
  return buf;
}

function makeImageWithRect(
  width: number,
  height: number,
  bg: [number, number, number, number],
  rect: { x: number; y: number; w: number; h: number },
  color: [number, number, number, number]
): Buffer {
  const buf = makeImage(width, height, bg);
  for (let y = rect.y; y < rect.y + rect.h && y < height; y++) {
    for (let x = rect.x; x < rect.x + rect.w && x < width; x++) {
      const idx = (y * width + x) * 4;
      buf[idx] = color[0];
      buf[idx + 1] = color[1];
      buf[idx + 2] = color[2];
      buf[idx + 3] = color[3];
    }
  }
  return buf;
}

describe('Diff Engines', () => {
  const W = 100;
  const H = 100;

  describe('pixelmatch', () => {
    it('returns 0 diff for identical images', () => {
      const img = makeImage(W, H, [255, 255, 255, 255]);
      const result = computePixelmatch(img, img, W, H, 0.1, false);
      expect(result.diffPixelCount).toBe(0);
      expect(result.diffData.length).toBe(W * H * 4);
    });

    it('detects differences between different images', () => {
      const imgA = makeImage(W, H, [255, 255, 255, 255]);
      const imgB = makeImage(W, H, [0, 0, 0, 255]);
      const result = computePixelmatch(imgA, imgB, W, H, 0.1, false);
      expect(result.diffPixelCount).toBe(W * H);
    });

    it('threshold sensitivity — strict detects more', () => {
      const imgA = makeImage(W, H, [200, 200, 200, 255]);
      const imgB = makeImage(W, H, [210, 210, 210, 255]);
      const strict = computePixelmatch(imgA, imgB, W, H, 0.01, false);
      const lenient = computePixelmatch(imgA, imgB, W, H, 0.3, false);
      expect(strict.diffPixelCount).toBeGreaterThanOrEqual(lenient.diffPixelCount);
    });
  });

  describe('ssim', () => {
    it('returns 0 diff for identical images', () => {
      const img = makeImage(W, H, [128, 128, 128, 255]);
      const result = computeSSIM(img, img, W, H);
      expect(result.diffPixelCount).toBe(0);
      expect(result.diffData.length).toBe(W * H * 4);
    });

    it('detects large color changes', () => {
      const imgA = makeImage(W, H, [255, 255, 255, 255]);
      const imgB = makeImage(W, H, [0, 0, 0, 255]);
      const result = computeSSIM(imgA, imgB, W, H);
      expect(result.diffPixelCount).toBeGreaterThan(0);
    });

    it('is more tolerant of subtle changes than pixelmatch', () => {
      const imgA = makeImageWithRect(W, H, [255, 255, 255, 255], { x: 10, y: 10, w: 80, h: 80 }, [200, 200, 200, 255]);
      const imgB = makeImageWithRect(W, H, [255, 255, 255, 255], { x: 10, y: 10, w: 80, h: 80 }, [205, 205, 205, 255]);
      const pmResult = computePixelmatch(imgA, imgB, W, H, 0.1, false);
      const ssimResult = computeSSIM(imgA, imgB, W, H);
      // SSIM should detect fewer or equal diff pixels for subtle changes
      expect(ssimResult.diffPixelCount).toBeLessThanOrEqual(pmResult.diffPixelCount);
    });
  });

  describe('butteraugli', () => {
    it('returns 0 diff for identical images', () => {
      const img = makeImage(W, H, [128, 128, 128, 255]);
      const result = computeButteraugli(img, img, W, H);
      expect(result.diffPixelCount).toBe(0);
      expect(result.diffData.length).toBe(W * H * 4);
    });

    it('detects large color changes', () => {
      const imgA = makeImage(W, H, [255, 0, 0, 255]);
      const imgB = makeImage(W, H, [0, 255, 0, 255]);
      const result = computeButteraugli(imgA, imgB, W, H);
      expect(result.diffPixelCount).toBeGreaterThan(0);
    });

    it('produces color-mapped diff output (non-zero RGB on diff pixels)', () => {
      const imgA = makeImage(W, H, [255, 255, 255, 255]);
      const imgB = makeImage(W, H, [0, 0, 0, 255]);
      const result = computeButteraugli(imgA, imgB, W, H);
      // Check first diff pixel has colored output
      let foundColor = false;
      for (let i = 0; i < W * H; i++) {
        const idx = i * 4;
        if (result.diffData[idx + 3] > 0 && result.diffData[idx] > 0) {
          foundColor = true;
          break;
        }
      }
      expect(foundColor).toBe(true);
    });
  });

  describe('runDiffEngine dispatch', () => {
    it('dispatches to pixelmatch', () => {
      const img = makeImage(W, H, [255, 255, 255, 255]);
      const result = runDiffEngine('pixelmatch', img, img, W, H, 0.1, false);
      expect(result.diffPixelCount).toBe(0);
    });

    it('dispatches to ssim', () => {
      const img = makeImage(W, H, [255, 255, 255, 255]);
      const result = runDiffEngine('ssim', img, img, W, H, 0.1, false);
      expect(result.diffPixelCount).toBe(0);
    });

    it('dispatches to butteraugli', () => {
      const img = makeImage(W, H, [255, 255, 255, 255]);
      const result = runDiffEngine('butteraugli', img, img, W, H, 0.1, false);
      expect(result.diffPixelCount).toBe(0);
    });
  });
});
