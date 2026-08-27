/**
 * Whether this deployment offers Lastest's tools to the browser's AI agent.
 *
 * **On by default, with one env override.** There is deliberately no per-team
 * switch: WebMCP is inert in every browser that has not shipped
 * `document.modelContext`, every mutation goes through Lastest's own consent
 * dialog (`requestWebMcpConsent`), and the tool surface is a hand-picked
 * read-mostly subset (`src/lib/webmcp/registry.ts`) that can only ever act with
 * the signed-in user's own permissions. A tenant-level toggle bought nothing
 * over those three guards and left the feature dark for everyone by default.
 *
 * Operators who still want it off set `WEBMCP_ENABLED=0` (or `false`). Server
 * env, not `NEXT_PUBLIC_*`, so it is resolved where the layout renders and
 * passed down as a prop rather than baked into the client bundle.
 */
export function isWebMcpEnabled(): boolean {
  const raw = process.env.WEBMCP_ENABLED?.trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}
