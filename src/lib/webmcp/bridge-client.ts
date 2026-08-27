/**
 * Browser half of the WebMCP bridge: a thin `fetch` to `/api/mcp/session`.
 *
 * Deliberately not the MCP SDK. The heavy lifting (tool definitions, zod
 * validation, auth, activity reporting) happens server-side in
 * `@lastest/mcp-server`; all the page needs is list/call over JSON.
 *
 * The `x-lastest-webmcp` header is not decoration: it is a non-simple request
 * header, so any cross-origin attempt is preflighted and blocked, which is what
 * makes a cookie-authed endpoint safe from CSRF. The server rejects requests
 * without it.
 */
import type {
  WebMcpBridgeRequest,
  WebMcpBridgeResponse,
} from "@/lib/webmcp/types";

export const WEBMCP_BRIDGE_PATH = "/api/mcp/session";
export const WEBMCP_BRIDGE_HEADER = "x-lastest-webmcp";

export async function callBridge(
  body: WebMcpBridgeRequest,
  signal?: AbortSignal,
): Promise<WebMcpBridgeResponse> {
  const res = await fetch(WEBMCP_BRIDGE_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      [WEBMCP_BRIDGE_HEADER]: "1",
    },
    body: JSON.stringify(body),
    signal,
  });

  const payload = (await res.json().catch(() => null)) as
    | WebMcpBridgeResponse
    | { error?: string }
    | null;

  if (!res.ok) {
    const detail =
      payload && "error" in payload && payload.error
        ? payload.error
        : res.statusText;
    return {
      ok: false,
      error: `Lastest bridge error ${res.status}: ${detail}`,
    };
  }
  if (!payload) return { ok: false, error: "Empty response from Lastest." };
  return payload as WebMcpBridgeResponse;
}
