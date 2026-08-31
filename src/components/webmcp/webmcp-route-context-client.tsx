"use client";

/**
 * Declarative wrapper around `useWebMcpRouteContext()` so a server component
 * page can contribute its ids without becoming a client component itself:
 *
 *   <WebMcpRouteContext repositoryId={repo.id} buildId={build.id} />
 */
import { useWebMcpRouteContext } from "@/components/webmcp/webmcp-provider-client";
import type { WebMcpContext } from "@/lib/webmcp/types";

export function WebMcpRouteContext(props: WebMcpContext) {
  useWebMcpRouteContext(props);
  return null;
}
