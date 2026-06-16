/**
 * On-demand webm → mp4 transcode for the public share page.
 *
 * Playwright records as VP8/9 .webm with no audio. X (Twitter) and most native
 * tweet-upload pipelines want an H.264 .mp4, so this transcodes a share's
 * recording on demand and caches the result next to the source webm. The mp4
 * is what the "Download video" button on /r/<slug> serves so a founder can grab
 * it and attach it natively to a tweet (where it autoplays inline — see the
 * dev-4 investigation: link-unfurl player cards are allowlist-gated on X).
 */

import { spawn } from "child_process";
import fs from "fs";
import path from "path";

// Round-trip a path through globalThis so the Turbopack analyzer treats it as
// an opaque value — a direct `fs`/`spawn` call on a computed binary path makes
// Turbopack expand a `<dynamic>/ffmpeg` glob and match 34k+ files per build
// pass. Same trick as packages/shared/src/watermark.ts.
function opaquePath(p: string): string {
  const g = globalThis as { __lastestOpaqueMp4Path?: string };
  g.__lastestOpaqueMp4Path = p;
  return g.__lastestOpaqueMp4Path as string;
}

let cachedFfmpegPath: string | null | undefined;
function resolveFfmpegPath(): string {
  if (cachedFfmpegPath !== undefined) return cachedFfmpegPath ?? "ffmpeg";
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const name of ["ffmpeg", "ffmpeg.exe"]) {
      const candidate = opaquePath(
        path.join(opaquePath(dir), opaquePath(name)),
      );
      try {
        if (fs.existsSync(candidate)) {
          cachedFfmpegPath = candidate;
          return candidate;
        }
      } catch {
        /* ignore */
      }
    }
  }
  cachedFfmpegPath = "ffmpeg";
  return cachedFfmpegPath;
}

// Dedupe concurrent transcodes of the same source — a download click plus a
// retry shouldn't spawn two ffmpegs writing the same target file.
const inFlight = new Map<string, Promise<string | null>>();

/**
 * Transcode `webmAbsPath` to an H.264 mp4 cached at `<base>.mp4` beside it.
 * Returns the mp4 absolute path, or null if ffmpeg is missing / fails / times
 * out. Reuses the cached mp4 when it exists and is at least as new as the webm.
 */
export async function transcodeWebmToMp4(
  webmAbsPath: string,
  timeoutMs = 120_000,
): Promise<string | null> {
  if (!fs.existsSync(webmAbsPath)) return null;

  const mp4Path = path.join(
    path.dirname(webmAbsPath),
    `${path.basename(webmAbsPath, path.extname(webmAbsPath))}.mp4`,
  );

  // Cache hit: an mp4 already exists and isn't stale relative to the webm.
  try {
    const [webmStat, mp4Stat] = [
      fs.statSync(webmAbsPath),
      fs.statSync(mp4Path),
    ];
    if (mp4Stat.size > 0 && mp4Stat.mtimeMs >= webmStat.mtimeMs) return mp4Path;
  } catch {
    /* no cached mp4 yet — fall through and transcode */
  }

  const existing = inFlight.get(mp4Path);
  if (existing) return existing;

  const job = runTranscode(webmAbsPath, mp4Path, timeoutMs).finally(() => {
    inFlight.delete(mp4Path);
  });
  inFlight.set(mp4Path, job);
  return job;
}

function runTranscode(
  webmAbsPath: string,
  mp4Path: string,
  timeoutMs: number,
): Promise<string | null> {
  const ffmpeg = resolveFfmpegPath();
  // Transcode to a temp file then rename, so a killed/timed-out ffmpeg never
  // leaves a truncated mp4 that the cache check would later treat as valid.
  const tmpOut = `${mp4Path}.tmp.mp4`;
  const args = [
    "-y",
    "-nostdin",
    "-loglevel",
    "error",
    "-i",
    webmAbsPath,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    // yuv420p + faststart = the broadly-compatible profile QuickTime/X want;
    // even-dimension scale guards against odd-width webms libx264 rejects.
    "-pix_fmt",
    "yuv420p",
    "-vf",
    "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-movflags",
    "+faststart",
    "-an",
    tmpOut,
  ];

  return new Promise<string | null>((resolve) => {
    let settled = false;
    let stderr = "";
    let child: ReturnType<typeof spawn>;
    try {
      const g = globalThis as { __lastestMp4FfmpegCmd?: string };
      g.__lastestMp4FfmpegCmd = ffmpeg;
      child = spawn(g.__lastestMp4FfmpegCmd as string, args, {
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch (err) {
      console.warn(
        "[video-mp4] spawn failed:",
        err instanceof Error ? err.message : err,
      );
      resolve(null);
      return;
    }
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 8192) stderr = stderr.slice(-8192);
    });
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (ok && fs.existsSync(tmpOut)) {
        try {
          fs.renameSync(tmpOut, mp4Path);
          resolve(mp4Path);
          return;
        } catch {
          /* fall through to cleanup */
        }
      }
      try {
        fs.unlinkSync(tmpOut);
      } catch {
        /* best-effort */
      }
      resolve(null);
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      console.warn(
        `[video-mp4] ffmpeg timed out after ${timeoutMs}ms; stderr: ${stderr.trim()}`,
      );
      finish(false);
    }, timeoutMs);
    child.on("error", (err) => {
      console.warn(`[video-mp4] ffmpeg error (${ffmpeg}):`, err.message);
      finish(false);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        console.warn(
          `[video-mp4] ffmpeg exit=${code}; stderr: ${stderr.trim()}`,
        );
      }
      finish(code === 0);
    });
  });
}
