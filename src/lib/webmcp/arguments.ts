/**
 * Turning a registered WebMCP tool call into `tools/call` arguments.
 *
 * Pure and separately testable: the agent's input is merged over the route
 * context (repo/build/test ids the page already knows) and under the pinned
 * `source.bind` action, so the agent can never re-target a tool at another
 * team's build by passing an id, and can never pick the action.
 */
import type { WebMcpContext, WebMcpToolDef } from "@/lib/webmcp/types";

export class WebMcpContextError extends Error {}

/** True when every id the tool needs is present on this route. */
export function isToolAvailable(
  tool: WebMcpToolDef,
  context: WebMcpContext,
): boolean {
  return (tool.needs ?? []).every((key) => Boolean(context[key]));
}

export function buildToolArguments(
  tool: WebMcpToolDef,
  input: Record<string, unknown> | undefined,
  context: WebMcpContext,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};

  // Agent-supplied input first — everything below overwrites it.
  for (const [key, value] of Object.entries(input ?? {})) {
    if (value === undefined) continue;
    if (!(key in tool.inputSchema.properties)) {
      throw new WebMcpContextError(
        `Unknown argument '${key}' for tool '${tool.name}'.`,
      );
    }
    args[key] = value;
  }

  for (const key of tool.needs ?? []) {
    const value = context[key];
    if (!value) {
      throw new WebMcpContextError(
        `'${tool.name}' needs ${key}, which this page does not provide.`,
      );
    }
    args[key] = value;
  }

  // `lastest_decide_diff` takes diffIds OR buildId and rejects both. The page's
  // buildId is the "approve everything pending here" fallback, so it is only
  // added when the agent named no diffs.
  if (
    tool.source.tool === "lastest_decide_diff" &&
    tool.source.bind?.action === "approve" &&
    !(Array.isArray(args.diffIds) && args.diffIds.length > 0)
  ) {
    if (!context.buildId) {
      throw new WebMcpContextError(
        `'${tool.name}' needs either diffIds or an open build.`,
      );
    }
    args.buildId = context.buildId;
    delete args.diffIds;
  }

  return { ...args, ...(tool.source.bind ?? {}) };
}
