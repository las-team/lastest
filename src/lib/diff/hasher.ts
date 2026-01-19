import fs from 'fs';
import crypto from 'crypto';
import { PNG } from 'pngjs';

/**
 * Generate SHA256 hash of image pixel data (ignoring metadata)
 * This allows carry-forward matching of visually identical images
 */
export function hashImage(imagePath: string): string {
  const imageBuffer = fs.readFileSync(imagePath);
  const png = PNG.sync.read(imageBuffer);

  // Hash the raw pixel data, not the file
  const hash = crypto.createHash('sha256');
  hash.update(png.data);

  return hash.digest('hex');
}

/**
 * Generate hash from raw pixel buffer (for in-memory images)
 */
export function hashPixelData(data: Buffer): string {
  const hash = crypto.createHash('sha256');
  hash.update(data);
  return hash.digest('hex');
}

/**
 * Compare two image hashes
 */
export function hashesMatch(hash1: string, hash2: string): boolean {
  return hash1 === hash2;
}

/**
 * Generate hash with dimensions included (stricter matching)
 */
export function hashImageWithDimensions(imagePath: string): string {
  const imageBuffer = fs.readFileSync(imagePath);
  const png = PNG.sync.read(imageBuffer);

  const hash = crypto.createHash('sha256');
  hash.update(`${png.width}x${png.height}:`);
  hash.update(png.data);

  return hash.digest('hex');
}
