/**
 * Vitest setup file
 * Runs before all tests to configure mocks and globals
 */
import { vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// Mock fs operations for tests that don't need real file I/O
export const mockFs = () => {
  vi.spyOn(fs, 'existsSync').mockReturnValue(true);
  vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from(''));
  vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
  vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
};

// Mock crypto for deterministic hashing in tests
export const mockCrypto = () => {
  const crypto = require('crypto');
  vi.spyOn(crypto, 'createHash').mockReturnValue({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn().mockReturnValue('mock-hash-123'),
  });
};

// Helper to create mock Playwright page
export const createMockPage = () => {
  const mockLocator = {
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    press: vi.fn().mockResolvedValue(undefined),
    hover: vi.fn().mockResolvedValue(undefined),
    isVisible: vi.fn().mockResolvedValue(true),
    isEnabled: vi.fn().mockResolvedValue(true),
    textContent: vi.fn().mockResolvedValue(''),
    count: vi.fn().mockResolvedValue(1),
    first: vi.fn().mockReturnThis(),
    last: vi.fn().mockReturnThis(),
    nth: vi.fn().mockReturnThis(),
    waitFor: vi.fn().mockResolvedValue(undefined),
  };

  const mockPage = {
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
    context: vi.fn().mockReturnValue({
      browser: vi.fn().mockReturnValue({
        browserType: vi.fn().mockReturnValue({
          name: vi.fn().mockReturnValue('chromium'),
        }),
      }),
    }),
  };

  return mockPage;
};

// Helper to create mock PNG data
export const createMockPNG = (width: number, height: number, color: [number, number, number, number] = [255, 255, 255, 255]) => {
  const PNG = require('pngjs').PNG;
  const png = new PNG({ width, height });

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      png.data[idx] = color[0];
      png.data[idx + 1] = color[1];
      png.data[idx + 2] = color[2];
      png.data[idx + 3] = color[3];
    }
  }

  return png;
};

// Helper to create mock PNG with a rectangle
export const createMockPNGWithRect = (
  width: number,
  height: number,
  rect: { x: number; y: number; w: number; h: number },
  rectColor: [number, number, number, number] = [0, 0, 0, 255],
  bgColor: [number, number, number, number] = [255, 255, 255, 255]
) => {
  const PNG = require('pngjs').PNG;
  const png = new PNG({ width, height });

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      const isInRect = x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
      const color = isInRect ? rectColor : bgColor;

      png.data[idx] = color[0];
      png.data[idx + 1] = color[1];
      png.data[idx + 2] = color[2];
      png.data[idx + 3] = color[3];
    }
  }

  return png;
};

// Reset all mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});
