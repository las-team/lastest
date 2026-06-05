import { NextRequest } from "next/server";
import { createReadStream, existsSync } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import { getCurrentSession } from "@/lib/auth";
import { verifyBearerToken } from "@/lib/auth/api-key";
import { checkMediaAccess } from "@/lib/auth/media-access";
import { parseByteRange } from "@/lib/http/byte-range";
import { resolveStoragePathStrict } from "@/lib/storage/paths";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".zip": "application/zip",
  ".json": "application/json",
};

function getContentType(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return CONTENT_TYPES[ext] || "application/octet-stream";
}

async function verifyAuth(request: NextRequest) {
  const session = await getCurrentSession();
  if (session) return session;
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return verifyBearerToken(authHeader.slice(7));
  }
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const segments = (await params).path;

  // Skip auth for traces — they're fetched cross-origin by trace.playwright.dev
  // and are auto-cleaned after 1 hour.
  const isTrace = segments[0] === "traces";
  if (!isTrace) {
    const session = await verifyAuth(request);
    if (!session) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Team/repo ownership per subdir — the helper fails closed for any
    // subdir it doesn't recognize, so a new storage location can't slip
    // through unauthorized.
    const decision = await checkMediaAccess(segments, session);
    if (!decision.ok) {
      return new Response(decision.message, { status: decision.status });
    }
  }

  const urlPath = "/" + segments.join("/");
  const filePath = await resolveStoragePathStrict(urlPath);
  if (!filePath) {
    return new Response("Bad Request", { status: 400 });
  }
  if (!existsSync(filePath)) {
    return new Response("Not Found", { status: 404 });
  }

  const fileStat = await stat(filePath);
  const contentType = getContentType(filePath);
  const totalSize = fileStat.size;

  const baseHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=31536000, immutable",
    // Advertise byte-range support so <video>/<audio> can seek to arbitrary
    // timestamps without re-downloading from byte 0. Without this header
    // browsers issue a Range request, get a plain 200 in reply, and reset
    // currentTime to 0 — which surfaces as the scrubber "jumping back to
    // the beginning" on the test detail + share pages.
    "Accept-Ranges": "bytes",
  };
  if (segments[0] === "traces") {
    baseHeaders["Access-Control-Allow-Origin"] = "https://trace.playwright.dev";
    baseHeaders["Access-Control-Allow-Methods"] = "GET";
  }

  const rangeHeader = request.headers.get("range");
  const range = rangeHeader ? parseByteRange(rangeHeader, totalSize) : null;

  if (rangeHeader && !range) {
    // Malformed or unsatisfiable range — per RFC 7233 reply 416 with the
    // total size so the client can recover.
    return new Response("Range Not Satisfiable", {
      status: 416,
      headers: { ...baseHeaders, "Content-Range": `bytes */${totalSize}` },
    });
  }

  if (range) {
    const { start, end } = range;
    const partialStream = createReadStream(filePath, { start, end });
    const partialWebStream = Readable.toWeb(partialStream) as ReadableStream;
    return new Response(partialWebStream, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${totalSize}`,
        "Content-Length": (end - start + 1).toString(),
      },
    });
  }

  const nodeStream = createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;
  return new Response(webStream, {
    status: 200,
    headers: { ...baseHeaders, "Content-Length": totalSize.toString() },
  });
}

export async function OPTIONS(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const segments = (await params).path;
  if (segments[0] !== "traces") {
    return new Response(null, { status: 204 });
  }
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "https://trace.playwright.dev",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
