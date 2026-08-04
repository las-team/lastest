/**
 * Live iOS-simulator streaming for the maestro-app-runner PoC.
 *
 * Proves the streaming half of issue #197: pump the simulator's screen into
 * Lastest's EXISTING viewer, reusing its `stream:frame` / `stream:input` wire
 * protocol — no new UI, no containers, local only.
 *
 * Pipeline (mirrors the browser EB, only the source box changes):
 *
 *   iOS sim ──`idb video-stream --format h264`──▶ ffmpeg (h264→mjpeg) ──▶
 *     split JPEG frames ──▶ WS `stream:frame` (base64 JPEG) ──▶ Lastest <canvas>
 *
 *   Lastest <canvas> ──`stream:input` (mouse x/y, device px)──▶ this server ──▶
 *     `idb ui tap <x/scale> <y/scale>` (logical points) ──▶ iOS sim
 *
 * idb's `mjpeg` format is broken on this companion build (0 bytes), so we take
 * the `h264` path + ffmpeg, which is exactly ios-bridge's primary recipe.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { WebSocketServer, type WebSocket } from "ws";
import { randomUUID } from "node:crypto";

export interface StreamOptions {
  udid: string;
  port: number;
  /** device pixel width/height of the sim (frame size idb emits) */
  deviceWidth: number;
  deviceHeight: number;
  /** logical point width/height (what `idb ui tap` expects) */
  pointWidth: number;
  pointHeight: number;
  fps: number;
  idbBin: string;
  ffmpegBin: string;
}

export class SimStreamServer {
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private idbVideo: ChildProcess | null = null;
  private ffmpeg: ChildProcess | null = null;
  private jpegBuf: Buffer = Buffer.alloc(0);
  private lastFrame: string | null = null;
  private frameW = 0;
  private frameH = 0;
  private h264Bytes = 0;
  private frameCount = 0;
  private opts: StreamOptions;

  constructor(opts: StreamOptions) {
    this.opts = opts;
  }

  start(): void {
    this.wss = new WebSocketServer({ port: this.opts.port });
    this.wss.on("connection", (ws) => {
      this.clients.add(ws);
      console.log(`[stream] client connected (${this.clients.size})`);
      // Send the most recent frame immediately so a fresh viewer isn't blank.
      if (this.lastFrame) this.sendFrame(ws, this.lastFrame);
      ws.on("message", (data) => this.onClientMessage(data.toString()));
      ws.on("close", () => {
        this.clients.delete(ws);
        console.log(`[stream] client disconnected (${this.clients.size})`);
      });
      ws.on("error", () => this.clients.delete(ws));
    });
    console.log(`[stream] WS listening on ${this.opts.port}`);
    this.startCapture();
  }

  /** idb video-stream (h264) → ffmpeg (mjpeg) → JPEG frame splitter. */
  private startCapture(): void {
    this.idbVideo = spawn(
      this.opts.idbBin,
      [
        "video-stream",
        "--format",
        "h264",
        "--fps",
        String(this.opts.fps),
        "--udid",
        this.opts.udid,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    // ffmpeg reads the raw h264 from stdin, emits a concatenated MJPEG stream on
    // stdout; we split it into individual JPEGs by SOI/EOI markers below.
    this.ffmpeg = spawn(
      this.opts.ffmpegBin,
      [
        // Explicit input format: idb emits a raw H.264 elementary stream on a
        // pipe, which ffmpeg can't probe/auto-detect (yields 0 frames without
        // this). With -f h264 it decodes fine.
        "-f",
        "h264",
        "-i",
        "pipe:0",
        "-an",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "-q:v",
        "5",
        // Flush each encoded frame to the pipe immediately, don't buffer.
        "-flush_packets",
        "1",
        "pipe:1",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    // Log a bounded amount of each child's stderr for diagnosis.
    this.idbVideo.stderr?.on("data", (d: Buffer) => {
      const s = d.toString().trim();
      if (s) console.error("[stream][idb]", s.slice(0, 200));
    });
    this.ffmpeg.stderr?.on("data", (d: Buffer) => {
      const s = d.toString().trim();
      if (s) console.error("[stream][ffmpeg]", s.slice(0, 200));
    });

    // NOTE: do not attach a `data` listener on idb.stdout here — that switches
    // the stream to flowing mode and races/steals bytes from the .pipe() below,
    // which silently starved ffmpeg (h264 in > 0 but frames out = 0). Count
    // throughput via the ffmpeg.stdin write side instead if needed.
    this.idbVideo.stdout?.pipe(this.ffmpeg.stdin!);
    this.idbVideo.on("error", (e) =>
      console.error("[stream] idb video-stream error:", e.message),
    );
    this.ffmpeg.on("error", (e) =>
      console.error("[stream] ffmpeg error:", e.message),
    );
    this.ffmpeg.stdout?.on("data", (chunk: Buffer) => this.onMjpeg(chunk));
    console.log("[stream] capture pipeline started (idb h264 → ffmpeg mjpeg)");
    // Heartbeat: report throughput so a silent stall is visible.
    setInterval(() => {
      console.log(
        `[stream] mjpeg=${this.h264Bytes}B  frames=${this.frameCount}  clients=${this.clients.size}`,
      );
    }, 3000).unref?.();
  }

  /** Accumulate MJPEG bytes; emit each complete JPEG (FFD8…FFD9) as a frame. */
  private onMjpeg(chunk: Buffer): void {
    this.h264Bytes += chunk.length;
    this.jpegBuf = Buffer.concat([this.jpegBuf, chunk]);
    // A robust-enough splitter for the PoC: find EOI markers and cut there.
    let eoi: number;
    while ((eoi = this.jpegBuf.indexOf(Buffer.from([0xff, 0xd9]))) !== -1) {
      const frame = this.jpegBuf.subarray(0, eoi + 2);
      this.jpegBuf = this.jpegBuf.subarray(eoi + 2);
      // Only forward buffers that actually start with a JPEG SOI marker.
      if (frame.length > 4 && frame[0] === 0xff && frame[1] === 0xd8) {
        this.broadcast(frame.toString("base64"));
      }
    }
  }

  private broadcast(base64: string): void {
    this.lastFrame = base64;
    this.frameCount++;
    // Frame dimensions are the device pixel size (idb captures at native res).
    this.frameW = this.opts.deviceWidth;
    this.frameH = this.opts.deviceHeight;
    for (const ws of this.clients) {
      if (ws.readyState === 1) this.sendFrame(ws, base64);
    }
  }

  private sendFrame(ws: WebSocket, base64: string): void {
    ws.send(
      JSON.stringify({
        type: "stream:frame",
        id: randomUUID(),
        timestamp: Date.now(),
        payload: {
          data: base64,
          width: this.frameW || this.opts.deviceWidth,
          height: this.frameH || this.opts.deviceHeight,
          timestamp: Date.now(),
        },
      }),
    );
  }

  /** Lastest viewer → input. Map device-px mouse coords to idb ui tap points. */
  private onClientMessage(raw: string): void {
    let msg: { type: string; payload?: Record<string, unknown> };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type !== "stream:input" || !msg.payload) return;
    const p = msg.payload;

    // Scale device px (frame space the viewer measured against) → logical
    // points that `idb ui` expects.
    const sx = this.opts.pointWidth / this.opts.deviceWidth;
    const sy = this.opts.pointHeight / this.opts.deviceHeight;

    if (p.type === "mouse" && p.action === "down") {
      const x = Math.round(Number(p.x) * sx);
      const y = Math.round(Number(p.y) * sy);
      this.tap(x, y);
    } else if (p.type === "keyboard" && p.action === "type" && p.text) {
      this.typeText(String(p.text));
    }
    // (swipe/drag would map mouse down→move→up into `idb ui swipe`; omitted for
    // the PoC — tap + type is enough to prove the input round-trip.)
  }

  private tap(x: number, y: number): void {
    const proc = spawn(this.opts.idbBin, [
      "ui",
      "tap",
      String(x),
      String(y),
      "--udid",
      this.opts.udid,
    ]);
    proc.on("error", (e) => console.error("[stream] tap error:", e.message));
    console.log(`[stream] tap → ${x},${y} (points)`);
  }

  private typeText(text: string): void {
    const proc = spawn(this.opts.idbBin, [
      "ui",
      "text",
      text,
      "--udid",
      this.opts.udid,
    ]);
    proc.on("error", (e) => console.error("[stream] text error:", e.message));
    console.log(`[stream] type → ${JSON.stringify(text)}`);
  }

  stop(): void {
    try {
      this.idbVideo?.kill("SIGINT");
    } catch {}
    try {
      this.ffmpeg?.kill("SIGINT");
    } catch {}
    this.wss?.close();
    for (const ws of this.clients) {
      try {
        ws.close();
      } catch {}
    }
    this.clients.clear();
  }
}
