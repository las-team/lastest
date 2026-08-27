"use client";

/**
 * Registers Lastest's tools with the browser's AI agent (WebMCP / "site tools"
 * in ChatGPT desktop and Codex) for as long as the app shell is mounted.
 *
 * Route-scoped tools come from `useWebMcpRouteContext()`: a page contributes
 * the ids it knows (repository / build / test) and the provider re-registers
 * the matching tools, prefilling those ids so the agent never has to guess
 * which build "approve the diffs" refers to. Contributions are removed on
 * unmount, which unregisters the tools with them.
 *
 * No-ops entirely when the browser has no `document.modelContext` or when the
 * feature is off, so this is inert in every browser that has not shipped WebMCP.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { registerWebMcpTools } from "@/lib/webmcp/model-context";
import { WEBMCP_TOOLS } from "@/lib/webmcp/registry";
import type { WebMcpContext } from "@/lib/webmcp/types";

interface WebMcpProviderValue {
  enabled: boolean;
  contribute: (id: symbol, context: WebMcpContext) => void;
  withdraw: (id: symbol) => void;
}

const WebMcpReactContext = createContext<WebMcpProviderValue | null>(null);

export function WebMcpProvider({
  enabled,
  repositoryId,
  children,
}: {
  enabled: boolean;
  /**
   * The user's currently-selected project. Contributed app-wide so the
   * repo-scoped tools are available on every screen, not just a repo page —
   * it is what the sidebar's repo selector already scopes the UI to.
   */
  repositoryId?: string;
  children: React.ReactNode;
}) {
  const contributions = useRef(new Map<symbol, WebMcpContext>());
  const [routeContext, setRouteContext] = useState<WebMcpContext>({});

  const recompute = useCallback(() => {
    const merged: WebMcpContext = {};
    for (const partial of contributions.current.values()) {
      for (const [key, value] of Object.entries(partial)) {
        if (value) merged[key as keyof WebMcpContext] = value;
      }
    }
    setRouteContext((prev) =>
      prev.repositoryId === merged.repositoryId &&
      prev.buildId === merged.buildId &&
      prev.testId === merged.testId
        ? prev
        : merged,
    );
  }, []);

  const value = useMemo<WebMcpProviderValue>(
    () => ({
      enabled,
      contribute: (id, partial) => {
        contributions.current.set(id, partial);
        recompute();
      },
      withdraw: (id) => {
        contributions.current.delete(id);
        recompute();
      },
    }),
    [enabled, recompute],
  );

  // The selected project is a prop, not a contribution: it is known at render
  // time, and routing it through an effect would mean a setState cascade.
  const activeRepositoryId = routeContext.repositoryId ?? repositoryId;
  const { buildId, testId } = routeContext;
  useEffect(() => {
    if (!enabled) return;
    return registerWebMcpTools(WEBMCP_TOOLS, {
      repositoryId: activeRepositoryId,
      buildId,
      testId,
    });
  }, [enabled, activeRepositoryId, buildId, testId]);

  return (
    <WebMcpReactContext.Provider value={value}>
      {children}
    </WebMcpReactContext.Provider>
  );
}

/**
 * Contribute the ids this route knows about. Safe to call from any client
 * component under the app shell; a no-op outside the provider (public pages).
 */
export function useWebMcpRouteContext(partial: WebMcpContext): void {
  const provider = useContext(WebMcpReactContext);
  const id = useRef<symbol>(undefined as unknown as symbol);
  if (!id.current) id.current = Symbol("webmcp-route");

  const { repositoryId, buildId, testId } = partial;
  useEffect(() => {
    if (!provider?.enabled) return;
    const key = id.current;
    provider.contribute(key, { repositoryId, buildId, testId });
    return () => provider.withdraw(key);
  }, [provider, repositoryId, buildId, testId]);
}
