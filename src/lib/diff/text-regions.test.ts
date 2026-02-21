import { describe, it, expect } from 'vitest';
import {
  mergeOverlappingRectangles,
  expandRectangle,
  clampRectangle,
  createTextMaskBitmap,
} from './text-regions';
import type { Rectangle } from './generator';

describe('Text Region Operations', () => {
  describe('expandRectangle', () => {
    it('expands rectangle by padding on all sides', () => {
      const rect: Rectangle = { x: 10, y: 20, width: 50, height: 30 };
      const expanded = expandRectangle(rect, 4);
      expect(expanded).toEqual({ x: 6, y: 16, width: 58, height: 38 });
    });

    it('handles zero padding', () => {
      const rect: Rectangle = { x: 10, y: 20, width: 50, height: 30 };
      const expanded = expandRectangle(rect, 0);
      expect(expanded).toEqual(rect);
    });
  });

  describe('clampRectangle', () => {
    it('clamps rectangle to image bounds', () => {
      const rect: Rectangle = { x: -5, y: -3, width: 100, height: 50 };
      const clamped = clampRectangle(rect, 80, 40);
      expect(clamped.x).toBe(0);
      expect(clamped.y).toBe(0);
      expect(clamped.width).toBeLessThanOrEqual(80);
      expect(clamped.height).toBeLessThanOrEqual(40);
    });

    it('leaves in-bounds rectangle unchanged', () => {
      const rect: Rectangle = { x: 10, y: 10, width: 50, height: 30 };
      const clamped = clampRectangle(rect, 100, 100);
      expect(clamped).toEqual(rect);
    });
  });

  describe('mergeOverlappingRectangles', () => {
    it('returns empty array for empty input', () => {
      expect(mergeOverlappingRectangles([])).toEqual([]);
    });

    it('returns single rect unchanged', () => {
      const rects: Rectangle[] = [{ x: 0, y: 0, width: 10, height: 10 }];
      expect(mergeOverlappingRectangles(rects)).toEqual(rects);
    });

    it('merges two overlapping rectangles', () => {
      const rects: Rectangle[] = [
        { x: 0, y: 0, width: 20, height: 20 },
        { x: 10, y: 10, width: 20, height: 20 },
      ];
      const merged = mergeOverlappingRectangles(rects);
      expect(merged.length).toBe(1);
      expect(merged[0]).toEqual({ x: 0, y: 0, width: 30, height: 30 });
    });

    it('keeps non-overlapping rectangles separate', () => {
      const rects: Rectangle[] = [
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 50, y: 50, width: 10, height: 10 },
      ];
      const merged = mergeOverlappingRectangles(rects);
      expect(merged.length).toBe(2);
    });

    it('merges chain of overlapping rectangles', () => {
      const rects: Rectangle[] = [
        { x: 0, y: 0, width: 15, height: 10 },
        { x: 10, y: 0, width: 15, height: 10 },
        { x: 20, y: 0, width: 15, height: 10 },
      ];
      const merged = mergeOverlappingRectangles(rects);
      expect(merged.length).toBe(1);
      expect(merged[0]).toEqual({ x: 0, y: 0, width: 35, height: 10 });
    });
  });

  describe('createTextMaskBitmap', () => {
    it('creates empty mask for no regions', () => {
      const mask = createTextMaskBitmap([], 10, 10);
      expect(mask.length).toBe(100);
      expect(mask.every(v => v === 0)).toBe(true);
    });

    it('marks region pixels as 1', () => {
      const regions: Rectangle[] = [{ x: 2, y: 2, width: 3, height: 3 }];
      const mask = createTextMaskBitmap(regions, 10, 10);

      // Check that pixels inside the region are 1
      expect(mask[2 * 10 + 2]).toBe(1);
      expect(mask[4 * 10 + 4]).toBe(1);

      // Check that pixels outside are 0
      expect(mask[0]).toBe(0);
      expect(mask[9 * 10 + 9]).toBe(0);
    });

    it('handles multiple regions', () => {
      const regions: Rectangle[] = [
        { x: 0, y: 0, width: 3, height: 3 },
        { x: 7, y: 7, width: 3, height: 3 },
      ];
      const mask = createTextMaskBitmap(regions, 10, 10);

      expect(mask[0]).toBe(1);
      expect(mask[7 * 10 + 7]).toBe(1);
      expect(mask[5 * 10 + 5]).toBe(0);
    });

    it('clamps regions to image bounds', () => {
      const regions: Rectangle[] = [{ x: -5, y: -5, width: 10, height: 10 }];
      const mask = createTextMaskBitmap(regions, 10, 10);
      // Should not crash, and mark valid pixels
      expect(mask[0]).toBe(1);
      expect(mask[4 * 10 + 4]).toBe(1);
      expect(mask[5 * 10 + 5]).toBe(0);
    });
  });
});
