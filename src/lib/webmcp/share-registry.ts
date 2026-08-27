/**
 * The public tool surface on a `/r/<slug>` share page.
 *
 * A share page is already an unauthenticated view of one build's evidence, so
 * these tools add no new access — they let an agent read what the page shows
 * without scraping it, which is the whole WebMCP pitch applied to our most
 * public artefact. Everything here is read-only and slug-scoped: there is no
 * session, no team context, and no way to reach another share.
 *
 * Separate from `registry.ts` because these do not narrow MCP tools (the MCP
 * surface is authenticated); `source.tool` names an op on
 * `/api/webmcp/share/[slug]` instead.
 */
import type { WebMcpToolDef } from "@/lib/webmcp/types";

const NO_INPUT = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

export const WEBMCP_SHARE_OPS = [
  "report_summary",
  "visual_changes",
  "failing_steps",
] as const;

export type WebMcpShareOp = (typeof WEBMCP_SHARE_OPS)[number];

export const WEBMCP_SHARE_TOOLS: readonly WebMcpToolDef[] = [
  {
    name: "lastest_report_summary",
    title: "Summarize this Lastest report",
    description:
      "Summarize the visual-regression report on this page: which site was tested, when, how many tests ran and passed, how many visual changes were detected, the accessibility score, and how long the run took.",
    inputSchema: NO_INPUT,
    scope: "global",
    readOnly: true,
    source: { tool: "report_summary" },
  },
  {
    name: "lastest_list_visual_changes",
    title: "List the visual changes in this report",
    description:
      "List the visual changes this report captured — the test and step each belongs to, how much of the screen changed, and the before/after screenshot URLs. Use this to describe what changed on the site.",
    inputSchema: NO_INPUT,
    scope: "global",
    readOnly: true,
    source: { tool: "visual_changes" },
  },
  {
    name: "lastest_list_failing_steps",
    title: "List what failed in this report",
    description:
      "List the tests and steps that failed in this report, with their error messages. Returns an empty list when everything passed.",
    inputSchema: NO_INPUT,
    scope: "global",
    readOnly: true,
    source: { tool: "failing_steps" },
  },
];
