/**
 * Video watermarking — overlays the Lastest logo + "lastest.cloud" text in
 * the bottom-right corner of recorded videos using ffmpeg.
 *
 * Best-effort: if ffmpeg isn't available or the command fails, the original
 * video is returned untouched so recording never breaks.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Inlined logo so the helper stays asset-free after tsup bundling.
// Source: public/icon.png (256x256, 2191 bytes, RGBA).
// Regenerate with: python3 -c "import base64; print(base64.b64encode(open('public/icon.png','rb').read()).decode())"
const LOGO_PNG_BASE64 = [
  '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',
].join('');

let cachedLogoPath: string | null = null;
function getLogoPath(): string {
  if (cachedLogoPath && fs.existsSync(cachedLogoPath)) return cachedLogoPath;
  const logoPath = path.join(os.tmpdir(), 'lastest-watermark-logo.png');
  fs.writeFileSync(logoPath, Buffer.from(LOGO_PNG_BASE64, 'base64'));
  cachedLogoPath = logoPath;
  return logoPath;
}

let cachedFfmpegPath: string | null | undefined;
function resolveFfmpegPath(): string {
  if (cachedFfmpegPath !== undefined) return cachedFfmpegPath ?? 'ffmpeg';

  // Always prefer a full ffmpeg from PATH. The Playwright-bundled binary
  // under /ms-playwright is a stripped build (no drawtext, no overlay, no
  // VP9 encoder) and cannot render our watermark.
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const name of ['ffmpeg', 'ffmpeg.exe']) {
      const candidate = path.join(dir, name);
      try {
        if (fs.existsSync(candidate)) {
          cachedFfmpegPath = candidate;
          return candidate;
        }
      } catch { /* ignore */ }
    }
  }
  // Last resort — let the OS resolve it and surface any ENOENT to the caller.
  cachedFfmpegPath = 'ffmpeg';
  return cachedFfmpegPath;
}

function pickFontFile(): string | null {
  const candidates = [
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    'C:\\Windows\\Fonts\\arialbd.ttf',
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch { /* ignore */ }
  }
  return null;
}

export interface WatermarkOptions {
  /** Text to burn into the video. Defaults to "lastest.cloud". */
  text?: string;
  /** Overall ffmpeg timeout (ms). Default 60_000. */
  timeoutMs?: number;
}

/**
 * Overlay the Lastest logo and a text message onto a recorded video in-place.
 * Returns the path of the watermarked file (same as `inputPath` on success).
 * If ffmpeg is missing or fails, returns the original `inputPath` unchanged.
 */
export async function watermarkVideo(
  inputPath: string,
  options: WatermarkOptions = {}
): Promise<string> {
  if (!fs.existsSync(inputPath)) return inputPath;

  const text = options.text ?? 'lastest.cloud';
  const timeoutMs = options.timeoutMs ?? 60_000;
  const tmpOut = path.join(
    path.dirname(inputPath),
    `${path.basename(inputPath, path.extname(inputPath))}.wm${path.extname(inputPath) || '.webm'}`
  );

  const ffmpeg = resolveFfmpegPath();
  const logoPath = getLogoPath();
  const fontFile = pickFontFile();

  // Logo: 40px tall, 85% opacity, bottom-right with 16px padding.
  // Text: drawn to the left of the logo with a dark outline for readability.
  const scaledLogo = '[1:v]scale=-1:40,format=rgba,colorchannelmixer=aa=0.85[logo]';
  const overlayLogo = `${scaledLogo};[0:v][logo]overlay=W-w-16:H-h-16[bg]`;

  let filter: string;
  if (fontFile) {
    const escapedText = text
      .replace(/\\/g, '\\\\')
      .replace(/:/g, '\\:')
      .replace(/'/g, "\\'");
    const escapedFont = fontFile.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
    const drawtext = [
      `drawtext=fontfile='${escapedFont}'`,
      `text='${escapedText}'`,
      'fontcolor=white',
      'fontsize=20',
      'borderw=2',
      'bordercolor=black@0.7',
      // Anchor to the right of frame, shifted left past the 40px logo +
      // 16px logo-padding + 8px gap.
      'x=w-tw-40-16-8-16',
      'y=h-th-16-10',
    ].join(':');
    filter = `${overlayLogo};[bg]${drawtext}[out]`;
  } else {
    filter = scaledLogo + ';[0:v][logo]overlay=W-w-16:H-h-16[out]';
  }

  const args = [
    '-y',
    '-nostdin',
    '-loglevel', 'error',
    '-i', inputPath,
    '-i', logoPath,
    '-filter_complex', filter,
    '-map', '[out]',
    '-c:v', 'libvpx-vp9',
    '-b:v', '0',
    '-crf', '34',
    '-deadline', 'realtime',
    '-cpu-used', '8',
    '-an',
    tmpOut,
  ];

  const ok = await new Promise<boolean>((resolve) => {
    let settled = false;
    let child: ReturnType<typeof spawn>;
    let stderr = '';
    try {
      child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err) {
      console.warn('[watermark] spawn failed:', err instanceof Error ? err.message : err);
      resolve(false);
      return;
    }
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 8192) stderr = stderr.slice(-8192);
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      console.warn(`[watermark] ffmpeg timed out after ${timeoutMs}ms; stderr: ${stderr.trim()}`);
      resolve(false);
    }, timeoutMs);
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      console.warn(`[watermark] ffmpeg error (${ffmpeg}):`, err.message);
      resolve(false);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        console.warn(`[watermark] ffmpeg exit=${code}; stderr: ${stderr.trim()}`);
      }
      resolve(code === 0);
    });
  });

  if (!ok || !fs.existsSync(tmpOut)) {
    try { fs.unlinkSync(tmpOut); } catch { /* best-effort */ }
    return inputPath;
  }

  try {
    fs.renameSync(tmpOut, inputPath);
    return inputPath;
  } catch {
    return tmpOut;
  }
}
