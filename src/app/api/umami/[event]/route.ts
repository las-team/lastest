import { after, type NextRequest } from "next/server";

// Resilient umami ingest proxy.
//
// The umami session-replay recorder (recorder.js) and tracker (script.js) POST
// batches to /_umami/api/record and /_umami/api/send. next.config rewrites those
// public paths to this handler. Rather than reverse-proxying straight through to
// the internal umami server (which made the browser wait for umami's response —
// a slow/unreachable umami would stall the very navigation that triggered the
// flush, e.g. submitting the login form), we ACK the beacon immediately and
// forward to umami in the background.
//
// Priority: never block the user on analytics. A dropped recording is fine; a
// stuck login is not. So the forward is best-effort with a hard timeout and the
// 204 goes back to the browser before umami is ever contacted.

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

  // Read the body now — the request stream is gone by the time after() runs.
  const body = await request.text();

  // Forward only the headers umami uses to attribute the hit (device/browser
  // via UA, geo + cookieless visitor hash via client IP, locale).
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

  // after() runs the forward once the response has been sent; the standalone
  // Node server keeps the process alive for it. A slow umami can no longer
  // affect the browser.
  after(async () => {
    try {
      await fetch(`${UMAMI_URL}/api/${event}`, {
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
