import { after, type NextRequest } from "next/server";

// Resilient umami ingest proxy.
//
// script.js POSTs to /_umami/api/send and reads the JSON response to get a
// `cache` session token. recorder.js polls window.umami.getSession() for that
// token before it starts capturing — so /api/send MUST proxy the Umami response
// back to the browser for session recording to work.
//
// /api/record beacons (replay data) are large and non-critical: ACK immediately
// and forward in the background so a slow Umami never stalls the user.
//
// Priority: /send blocks on Umami (small, fast — {"beep":"boop"}) but with a
// hard timeout so a dead server degrades to no-recording, not a stuck page.
// /record is always fire-and-forget.

const UMAMI_URL = process.env.UMAMI_INTERNAL_URL?.replace(/\/$/, "");
const ALLOWED_EVENTS = new Set(["record", "send"]);
const FORWARD_TIMEOUT_MS = 3000;

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ event: string }> },
) {
  const { event } = await params;

  // Unknown event, or no umami configured (self-hosted/local dev): swallow the
  // beacon so the client still gets a fast, successful response.
  if (!UMAMI_URL || !ALLOWED_EVENTS.has(event)) {
    return new Response(null, { status: 204 });
  }

  // Forward only the headers umami uses to attribute the hit.
  const body = await request.text();
  const headers: Record<string, string> = {
    "content-type": request.headers.get("content-type") ?? "application/json",
  };
  const userAgent = request.headers.get("user-agent");
  if (userAgent) headers["user-agent"] = userAgent;
  const acceptLanguage = request.headers.get("accept-language");
  if (acceptLanguage) headers["accept-language"] = acceptLanguage;
  const forwardedFor =
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip") ??
    undefined;
  if (forwardedFor) headers["x-forwarded-for"] = forwardedFor;
  const umamiCache = request.headers.get("x-umami-cache");
  if (umamiCache) headers["x-umami-cache"] = umamiCache;

  // /send: proxy response back so script.js gets the session cache token that
  // recorder.js needs. Falls back to 204 on timeout/error.
  if (event === "send") {
    try {
      const res = await fetch(`${UMAMI_URL}/api/send`, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
      });
      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: { "content-type": "application/json" },
      });
    } catch {
      return new Response(null, { status: 204 });
    }
  }

  // /record: large replay beacons — ACK immediately and forward in the background.
  after(async () => {
    try {
      await fetch(`${UMAMI_URL}/api/record`, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
      });
    } catch {
      // Best-effort: a dropped recording beats a blocked user.
    }
  });

  return new Response(null, { status: 204 });
}
