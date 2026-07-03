// Client-side webm → mp4 re-encode for the share page's social flows. X and
// the TikTok mobile app only ingest MP4/MOV, but Playwright records .webm —
// where the browser's MediaRecorder can mux MP4 (Chrome 126+, Safari), we play
// the clip through an offscreen <video> + captureStream and re-record it.
// Real-time (conversion takes the clip's duration) but dependency-free; callers
// fall back to downloading the original .webm when unsupported.

const MP4_MIME_CANDIDATES = [
  'video/mp4;codecs="avc1.42E01E"',
  "video/mp4;codecs=avc1",
  "video/mp4",
];

export function mp4ConversionSupported(): boolean {
  return supportedMp4Mime() !== null;
}

function supportedMp4Mime(): string | null {
  if (
    typeof MediaRecorder === "undefined" ||
    typeof MediaRecorder.isTypeSupported !== "function" ||
    typeof HTMLVideoElement === "undefined" ||
    !("captureStream" in HTMLVideoElement.prototype)
  ) {
    return null;
  }
  for (const mime of MP4_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
}

export interface ConvertOptions {
  /** Authoritative duration — Playwright webms often report Infinity. */
  durationMs?: number | null;
  /** 0..1 progress callback (based on playback position). */
  onProgress?: (fraction: number) => void;
}

export async function convertWebmToMp4(
  srcUrl: string,
  { durationMs, onProgress }: ConvertOptions = {},
): Promise<Blob> {
  const mime = supportedMp4Mime();
  if (!mime) throw new Error("MP4 recording is not supported in this browser");

  const res = await fetch(srcUrl);
  if (!res.ok) throw new Error(`Failed to fetch video (${res.status})`);
  const srcBlob = await res.blob();
  const objectUrl = URL.createObjectURL(srcBlob);

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = objectUrl;

  try {
    await new Promise<void>((resolve, reject) => {
      video.oncanplay = () => resolve();
      video.onerror = () => reject(new Error("Could not decode the recording"));
    });

    const knownDurationSec = Number.isFinite(video.duration)
      ? video.duration
      : durationMs && durationMs > 0
        ? durationMs / 1000
        : null;

    const stream = (
      video as HTMLVideoElement & { captureStream: () => MediaStream }
    ).captureStream();
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const done = new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () =>
        resolve(new Blob(chunks, { type: mime.split(";")[0] }));
      recorder.onerror = () => reject(new Error("MP4 encoding failed"));
    });

    const stop = () => {
      if (recorder.state !== "inactive") recorder.stop();
    };
    video.onended = stop;
    if (onProgress && knownDurationSec) {
      video.ontimeupdate = () =>
        onProgress(Math.min(1, video.currentTime / knownDurationSec));
    }
    // Belt-and-braces: some webms never fire `ended` (broken duration metadata)
    // — stop shortly after the known duration elapses.
    const timeout = knownDurationSec
      ? window.setTimeout(stop, knownDurationSec * 1000 + 4000)
      : null;

    recorder.start(250);
    await video.play();
    const out = await done;
    if (timeout != null) window.clearTimeout(timeout);
    onProgress?.(1);
    if (out.size === 0) throw new Error("MP4 encoding produced no data");
    return out;
  } finally {
    video.src = "";
    URL.revokeObjectURL(objectUrl);
  }
}
