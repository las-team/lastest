import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashPixelData, hashesMatch, hashImage, hashImageWithDimensions } from './hasher';
import { PNG } from 'pngjs';

// Mock fs for file-based tests
vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn(),
  },
}));

import fs from 'fs';

function createTestPNG(width: number, height: number, fillColor: [number, number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      png.data[idx] = fillColor[0];
      png.data[idx + 1] = fillColor[1];
      png.data[idx + 2] = fillColor[2];
      png.data[idx + 3] = fillColor[3];
    }
  }
  return PNG.sync.write(png);
}

describe('Image Hasher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('hashPixelData', () => {
    it('produces a 64-char hex string (SHA256)', () => {
      const data = Buffer.from([0, 0, 0, 255]);
      const hash = hashPixelData(data);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic (same input → same hash)', () => {
      const data = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]);
      expect(hashPixelData(data)).toBe(hashPixelData(data));
    });

    it('different data → different hash', () => {
      const a = Buffer.from([255, 0, 0, 255]);
      const b = Buffer.from([0, 255, 0, 255]);
      expect(hashPixelData(a)).not.toBe(hashPixelData(b));
    });

    it('handles empty buffer', () => {
      const hash = hashPixelData(Buffer.alloc(0));
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('hashesMatch', () => {
    it('returns true for equal hashes', () => {
      expect(hashesMatch('abc123', 'abc123')).toBe(true);
    });

    it('returns false for different hashes', () => {
      expect(hashesMatch('abc123', 'def456')).toBe(false);
    });

    it('returns false for empty vs non-empty', () => {
      expect(hashesMatch('', 'abc')).toBe(false);
    });
  });

  describe('hashImage', () => {
    it('hashes pixel data from a PNG file (ignoring metadata)', () => {
      const pngBuffer = createTestPNG(2, 2, [255, 0, 0, 255]);
      vi.mocked(fs.readFileSync).mockReturnValue(pngBuffer);

      const hash = hashImage('/fake/path.png');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(fs.readFileSync).toHaveBeenCalledWith('/fake/path.png');
    });

    it('produces same hash for same pixel data', () => {
      const pngBuffer = createTestPNG(4, 4, [0, 0, 0, 255]);
      vi.mocked(fs.readFileSync).mockReturnValue(pngBuffer);

      const hash1 = hashImage('/a.png');
      const hash2 = hashImage('/b.png');
      expect(hash1).toBe(hash2);
    });

    it('produces different hash for different pixel data', () => {
      const red = createTestPNG(2, 2, [255, 0, 0, 255]);
      const blue = createTestPNG(2, 2, [0, 0, 255, 255]);

      vi.mocked(fs.readFileSync).mockReturnValueOnce(red).mockReturnValueOnce(blue);

      const hash1 = hashImage('/red.png');
      const hash2 = hashImage('/blue.png');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('hashImageWithDimensions', () => {
    it('includes dimensions in hash', () => {
      // Same pixel data but different dimensions should produce different hashes
      const small = createTestPNG(2, 2, [255, 0, 0, 255]);
      const large = createTestPNG(4, 1, [255, 0, 0, 255]);

      vi.mocked(fs.readFileSync).mockReturnValueOnce(small).mockReturnValueOnce(large);

      const hash1 = hashImageWithDimensions('/small.png');
      const hash2 = hashImageWithDimensions('/large.png');
      expect(hash1).not.toBe(hash2);
    });

    it('produces different hash than hashImage for same file', () => {
      const pngBuffer = createTestPNG(2, 2, [128, 128, 128, 255]);
      vi.mocked(fs.readFileSync).mockReturnValue(pngBuffer);

      const plain = hashImage('/test.png');
      const withDims = hashImageWithDimensions('/test.png');
      expect(plain).not.toBe(withDims);
    });
  });
});
