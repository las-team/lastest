"use client";

/**
 * Registers the public, read-only tools of a `/r/<slug>` report with the
 * browser's AI agent.
 *
 * Unlike the in-app surface this needs no session and no team flag: the page is
 * already public, and the tools return exactly what it renders. It is also the
 * surface an agent can reach with no login at all, which is what makes a shared
 * Lastest report readable by ChatGPT or Codex the moment someone opens the link.
 */
import { useEffect } from "react";
import { registerWebMcpToolsWithPolyfill } from "@/lib/webmcp/model-context";
import { WEBMCP_SHARE_TOOLS } from "@/lib/webmcp/share-registry";
import type { WebMcpToolDef } from "@/lib/webmcp/types";

async function callShareTool(
  slug: string,
  tool: WebMcpToolDef,
): Promise<unknown> {
  const res = await fetch(`/api/webmcp/share/${encodeURIComponent(slug)}`, {
    method: "POST",
    // No credentials: this surface is public and must never depend on, or
    // expose, whatever session the visitor happens to be carrying.
    credentials: "omit",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ op: "call", name: tool.source.tool }),
  });
  const payload = (await res.json().catch(() => null)) as {
    ok?: boolean;
    result?: unknown;
    error?: string;
  } | null;
  if (!res.ok || !payload?.ok) {
    throw new Error(payload?.error ?? `Lastest report error ${res.status}`);
  }
  return payload.result;
}

export function WebMcpShareTools({
  slug,
  enabled,
}: {
  slug: string;
  enabled: boolean;
}) {
  useEffect(() => {
    if (!enabled) return;
    // See `webmcp-provider-client.tsx` for why cancellation is an AbortSignal
    // handed to the registrar rather than a `cancelled` flag checked after it.
    const controller = new AbortController();
    let dispose: (() => void) | null = null;
    void registerWebMcpToolsWithPolyfill(
      WEBMCP_SHARE_TOOLS,
      {},
      {
        dispatch: (tool) => callShareTool(slug, tool),
        signal: controller.signal,
      },
    ).then((disposer) => {
      if (controller.signal.aborted) disposer();
      else dispose = disposer;
    });
    return () => {
      controller.abort();
      dispose?.();
    };
  }, [slug, enabled]);

  return null;
}
