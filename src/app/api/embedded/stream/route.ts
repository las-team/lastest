import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { requireAuth } from "@/lib/auth";
import {
  listEmbeddedSessions,
  listSystemEmbeddedSessions,
} from "@/server/actions/embedded-sessions";
import { toProxyStreamUrl, probeStreamUrlAlive } from "@/lib/eb/stream-url";

/**
 * GET /api/embedded/stream
 *
 * Returns all embedded sessions for the authenticated team plus system sessions.
 * Each session includes the streamUrl routed through the WS proxy.
 */
export async function GET() {
  try {
    await requireAuth();
  } catch {
    // B4 diagnostics: log which path failed (cookie absent vs token absent vs
    // both) so 403/401 incidents on /record can be triaged from a build's
    // consoleErrors instead of needing a server log dive.
    const h = await headers();
    const hasCookie = Boolean(h.get("cookie"));
    const hasBearer = h.get("authorization")?.startsWith("Bearer ");
    console.warn(
      `[stream] 401 Unauthorized — cookie=${hasCookie ? "present" : "missing"} bearer=${hasBearer ? "present" : "missing"} ua=${h.get("user-agent")?.slice(0, 80) || "unknown"}`,
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [teamSessions, systemSessions] = await Promise.all([
      listEmbeddedSessions(),
      listSystemEmbeddedSessions(),
    ]);

    // Merge, deduplicating by id (in case system runners are in the user's team)
    const seen = new Set<string>();
    const allSessions = [...teamSessions, ...systemSessions].filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });

    const streamAuthToken = process.env.STREAM_AUTH_TOKEN || null;

    // TCP-probe every live streamUrl in parallel. Catches the race where the
    // DB still shows a session as ready/busy but the backing pod was reaped
    // (1-job-1-EB) or crashed before status was flipped to stopping — handing
    // that URL back leads the BrowserViewer through 5 reconnect attempts and a
    // silent flip to Disconnected.
    const aliveByIndex = await Promise.all(
      allSessions.map((s) => {
        const isLive = s.status !== "stopped" && s.status !== "stopping";
        if (!isLive || !s.streamUrl) return Promise.resolve(false);
        return probeStreamUrlAlive(s.streamUrl);
      }),
    );

    return NextResponse.json({
      sessions: allSessions.map((s, i) => {
        const isLive = s.status !== "stopped" && s.status !== "stopping";
        const probedAlive = aliveByIndex[i];
        if (isLive && !probedAlive && s.streamUrl) {
          console.warn(
            `[stream] EB unreachable, hiding streamUrl runner=${s.runnerId?.slice(0, 8) ?? "none"} session=${s.id.slice(0, 8)} status=${s.status} url=${s.streamUrl}`,
          );
        }
        return {
          id: s.id,
          runnerId: s.runnerId,
          status: s.status,
          streamUrl:
            isLive && probedAlive ? toProxyStreamUrl(s.streamUrl, s.id) : null,
          viewport: s.viewport,
          currentUrl: s.currentUrl,
          userId: s.userId,
          createdAt: s.createdAt,
          lastActivityAt: s.lastActivityAt,
        };
      }),
      streamAuthToken,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to list sessions" },
      { status: 500 },
    );
  }
}
