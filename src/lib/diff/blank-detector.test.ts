import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { PNG } from 'pngjs';
import { isScreenshotBlankWhite } from './blank-detector';

function makePNG(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      png.data[idx] = rgba[0];
      png.data[idx + 1] = rgba[1];
      png.data[idx + 2] = rgba[2];
      png.data[idx + 3] = rgba[3];
    }
  }
  return PNG.sync.write(png);
}

describe('isScreenshotBlankWhite', () => {
  let tmpDir: string;
  let whitePath: string;
  let blackPath: string;
  let corruptPath: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'blank-detector-'));
    whitePath = path.join(tmpDir, 'white.png');
    blackPath = path.join(tmpDir, 'black.png');
    corruptPath = path.join(tmpDir, 'corrupt.png');
    await fs.writeFile(whitePath, makePNG(64, 64, [255, 255, 255, 255]));
    await fs.writeFile(blackPath, makePNG(64, 64, [0, 0, 0, 255]));
    await fs.writeFile(corruptPath, Buffer.from('not a real png'));
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns true for a file that does not exist', async () => {
    expect(await isScreenshotBlankWhite(path.join(tmpDir, 'does-not-exist.png'))).toBe(true);
  });

  it('returns true for a corrupt/unreadable PNG', async () => {
    expect(await isScreenshotBlankWhite(corruptPath)).toBe(true);
  });

  it('returns true for an all-white PNG', async () => {
    expect(await isScreenshotBlankWhite(whitePath)).toBe(true);
  });

  it('returns false for a fully black PNG', async () => {
    expect(await isScreenshotBlankWhite(blackPath)).toBe(false);
  });
});
