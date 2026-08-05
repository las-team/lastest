"use client";

import { useCallback, useEffect, useState } from "react";
import { BrowserViewer } from "@/components/embedded-browser/browser-viewer-client";
import { appendStreamToken } from "@/lib/eb/stream-token";
import { Button } from "@/components/ui/button";
import { RefreshCw, Smartphone } from "lucide-react";

/**
 * Mobile PoC live view (issue #197).
 *
 * Lists the live embedded-browser sessions the host knows about and renders the
 * selected one in the SAME `BrowserViewer` the browser EB uses. The mobile
 * runner (packages/maestro-app-runner) registers as a normal EB session and
 * streams the iOS simulator over the existing `stream:frame` protocol, so no
 * mobile-specific viewer is needed — this page just surfaces the session.
 */

interface EbSession {
  id: string;
  runnerId: string | null;
  status: string;
  streamUrl: string | null;
  viewport?: { width: number; height: number } | null;
}

export function MobileClient() {
  const [sessions, setSessions] = useState<EbSession[]>([]);
  const [streamToken, setStreamToken] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/embedded/stream");
      if (!res.ok) throw new Error(`stream list failed: ${res.status}`);
      const data = (await res.json()) as {
        sessions: EbSession[];
        streamAuthToken: string | null;
      };
      // Only sessions the host probed as reachable expose a streamUrl.
      const live = (data.sessions ?? []).filter((s) => s.streamUrl);
      setSessions(live);
      setStreamToken(data.streamAuthToken ?? null);
      setSelectedId((prev) =>
        prev && live.some((s) => s.id === prev) ? prev : (live[0]?.id ?? null),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = sessions.find((s) => s.id === selectedId) ?? null;
  // Bezel aspect ratio. The registered viewport is in logical points, which has
  // the same ratio as the streamed device pixels; fall back to a modern iPhone.
  const frameAspect = {
    w: selected?.viewport?.width ?? 393,
    h: selected?.viewport?.height ?? 852,
  };
  // The list endpoint already returns a host-proxied path
  // (/api/embedded/stream/ws?target=...); the token authorises the WS upgrade.
  const streamUrl = selected?.streamUrl
    ? appendStreamToken(selected.streamUrl, streamToken)
    : null;

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Smartphone className="h-5 w-5" />
          <h1 className="text-xl font-semibold">Mobile live view</h1>
          <span className="text-muted-foreground text-sm">
            (PoC #197 — iOS simulator over the EB protocol)
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {sessions.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {sessions.map((s) => (
            <Button
              key={s.id}
              variant={s.id === selectedId ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedId(s.id)}
            >
              {s.id.slice(0, 8)} · {s.status}
            </Button>
          ))}
        </div>
      )}

      {loading && (
        <p className="text-muted-foreground text-sm">Loading sessions…</p>
      )}

      {error && <p className="text-destructive text-sm">{error}</p>}

      {!loading && !error && !streamUrl && (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="font-medium">No live stream available</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Start the mobile runner with <code>MAESTRO_STREAM=1</code> against a
            booted simulator, then hit Refresh. See{" "}
            <code>packages/maestro-app-runner/SETUP.md</code>.
          </p>
        </div>
      )}

      {streamUrl && (
        // `fit` scales the canvas to the container instead of rendering the
        // simulator's native frame 1:1 (an iPhone streams 1179x2556 device px,
        // which would otherwise overflow and show only its top-left corner).
        // It requires the parent to constrain the height — hence the fixed h-.
        <div className="flex justify-center">
          {/* Size the bezel to the device's own aspect ratio so it hugs the
              screen instead of leaving gaps beside a portrait phone. */}
          <div
            className="rounded-[2.5rem] border-8 border-neutral-800 bg-neutral-800 shadow-2xl dark:border-neutral-700 dark:bg-neutral-700"
            style={{
              height: "68vh",
              aspectRatio: `${frameAspect.w} / ${frameAspect.h}`,
            }}
          >
            <div className="h-full w-full overflow-hidden rounded-[2rem]">
              <BrowserViewer
                key={streamUrl}
                streamUrl={streamUrl}
                interactive
                fit
                hideToolbar
                hideViewportSelector
                hideStatusBar
                className="h-full w-full"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
