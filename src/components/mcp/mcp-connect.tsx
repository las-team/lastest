"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Copy, KeyRound, Loader2, Plug, Terminal } from "lucide-react";
import {
  createApiToken,
  getMcpConnectionStatus,
} from "@/server/actions/api-tokens";
import { cn } from "@/lib/utils";

function Snippet({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);
  return (
    <div className="relative">
      <pre className="bg-muted p-3 rounded-md text-xs font-mono whitespace-pre-wrap break-all pr-10">
        {text}
      </pre>
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-2 right-2"
        onClick={copy}
        type="button"
      >
        {copied ? (
          <Check className="w-4 h-4 text-green-500" />
        ) : (
          <Copy className="w-4 h-4" />
        )}
      </Button>
    </div>
  );
}

/**
 * MCP-first "connect your AI agent" surface, shared by Settings and Onboarding.
 *
 * Generates an API key, shows copy-paste install snippets (stdio + HTTP), and —
 * when `pollForConnection` is set — polls until an MCP client authenticates with
 * a freshly-created key, calling `onConnected` so onboarding can advance.
 */
export function McpConnect({
  serverUrl,
  pollForConnection = false,
  onConnected,
  className,
}: {
  serverUrl: string;
  pollForConnection?: boolean;
  onConnected?: () => void;
  className?: string;
}) {
  const [creating, setCreating] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const onConnectedRef = useRef(onConnected);
  useEffect(() => {
    onConnectedRef.current = onConnected;
  }, [onConnected]);

  const stdioCmd = token
    ? `claude mcp add lastest -- npx -y @lastest/mcp-server@latest --url ${serverUrl} --api-key ${token}`
    : "";
  const httpCmd = token
    ? `claude mcp add --transport http lastest ${serverUrl}/api/mcp --header "Authorization: Bearer ${token}"`
    : "";

  const create = useCallback(async () => {
    setCreating(true);
    setError(null);
    const result = await createApiToken("AI agent (MCP)");
    setCreating(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setToken(result.token);
    setCreatedAt(Date.now());
  }, []);

  // Poll for the first authenticated call from the new key.
  useEffect(() => {
    if (!pollForConnection || !createdAt || connected) return;
    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const status = await getMcpConnectionStatus(createdAt);
        if (!cancelled && status.connected) {
          setConnected(true);
          clearInterval(id);
          onConnectedRef.current?.();
        }
      } catch {
        /* keep polling */
      }
    }, 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pollForConnection, createdAt, connected]);

  return (
    <div className={cn("space-y-4", className)}>
      {!token ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Drive Lastest from your own AI agent — Claude Code, Claude Desktop,
            Cursor, Windsurf, or any MCP client. Generate a key and paste one
            command. Your agent uses your model subscription; no API keys are
            stored here.
          </p>
          <Button onClick={create} disabled={creating} type="button">
            {creating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <KeyRound className="mr-2 h-4 w-4" />
            )}
            Generate connection key
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-md p-3 text-xs">
            <span className="font-medium text-yellow-600 dark:text-yellow-400">
              Copy this now —{" "}
            </span>
            <span className="text-muted-foreground">
              the key is shown once. Manage or revoke it under Team → API Keys.
            </span>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium flex items-center gap-2">
              <Terminal className="w-4 h-4" /> Claude Code (stdio)
            </p>
            <Snippet text={stdioCmd} />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium flex items-center gap-2">
              <Plug className="w-4 h-4" /> Remote / HTTP (no Node.js)
            </p>
            <Snippet text={httpCmd} />
            <p className="text-[11px] text-muted-foreground opacity-75">
              For Claude Desktop, Cursor, Windsurf and other clients, see the{" "}
              <a
                className="underline"
                href="https://github.com/las-team/lastest/wiki/MCP-Server"
                target="_blank"
                rel="noreferrer"
              >
                MCP Server guide
              </a>
              .
            </p>
          </div>

          {pollForConnection && (
            <div
              className={cn(
                "flex items-center gap-2 rounded-md border p-3 text-sm",
                connected
                  ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400"
                  : "text-muted-foreground",
              )}
            >
              {connected ? (
                <>
                  <Check className="h-4 w-4" />
                  Your agent is connected. You&apos;re all set.
                </>
              ) : (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Run the command above, then ask your agent to{" "}
                  <code className="font-mono">list Lastest projects</code> —
                  waiting for it to connect…
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
