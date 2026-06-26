"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Check, Copy, Plug } from "lucide-react";

/**
 * Live page context interpolated into the copied prompt so the user's agent can
 * act on the exact entity (the specific test to heal, the repo to scope to, the
 * build to review) without a discovery round-trip.
 */
export type McpPromptContext = {
  testId?: string | null;
  testName?: string | null;
  targetUrl?: string | null;
  repositoryId?: string | null;
  buildId?: string | null;
};

const url = (c: McpPromptContext) => c.targetUrl || "<URL>";
const at = (c: McpPromptContext) => (c.targetUrl ? ` at ${c.targetUrl}` : "");
const inRepo = (c: McpPromptContext) =>
  c.repositoryId ? ` in repo ${c.repositoryId}` : "";
const named = (c: McpPromptContext) => {
  if (c.testName && c.testId) return `"${c.testName}" (id ${c.testId})`;
  if (c.testId) return `id ${c.testId}`;
  if (c.testName) return `"${c.testName}"`;
  return "<NAME>";
};

/**
 * Drop-in replacement for an in-product AI button when in-product AI (BYOK) is
 * not configured. Shows a small "Use your agent" affordance; the popover gives a
 * copy-paste MCP prompt that reproduces the action in the user's own AI client,
 * plus a link to connect an agent. Each prompt embeds the live context it was
 * given, so the copied text names the exact test/build/repo/URL instead of a
 * placeholder. Prompts stay tool-name-agnostic ("Using the Lastest MCP
 * server, …") so they survive MCP tool consolidation.
 */
const PROMPTS: Record<string, (c: McpPromptContext) => string> = {
  generate: (c) =>
    `Using the Lastest MCP server, create a Playwright test${inRepo(c)} for ${url(c)} that covers the main flow, then run it and show me the result.`,
  heal: (c) =>
    c.testId
      ? `Using the Lastest MCP server, heal test ${named(c)}${at(c)}, re-run it, and summarize what changed.`
      : `Using the Lastest MCP server, list my failing tests${inRepo(c)}, heal each against the live page, re-run them, and summarize what changed.`,
  enhance: (c) =>
    `Using the Lastest MCP server, open test ${named(c)}, add meaningful assertions and edge cases against the live page${at(c)}, and save it.`,
  discover: (c) =>
    `Using the Lastest MCP server, explore ${url(c)}, propose functional areas to cover${inRepo(c)}, create them, and scaffold a starter test per area.`,
  routes: (c) =>
    `Using the Lastest MCP server, discover the testable routes of ${url(c)} and create functional areas for them${inRepo(c)}.`,
  spec: (c) =>
    `Using the Lastest MCP server, turn this spec into Playwright tests and add them to the right functional areas${inRepo(c)}.`,
  diff: (c) =>
    c.buildId
      ? `Using the Lastest MCP server, review build ${c.buildId}'s visual diffs, tell me which are real regressions vs. noise, and approve the safe ones.`
      : `Using the Lastest MCP server, review the latest build's visual diffs${inRepo(c)}, tell me which are real regressions vs. noise, and approve the safe ones.`,
};

export function McpCtaHint({
  promptKey,
  label = "Use your agent",
  size = "sm",
  variant = "outline",
  className,
  testId,
  testName,
  targetUrl,
  repositoryId,
  buildId,
}: {
  promptKey: keyof typeof PROMPTS | string;
  label?: string;
  size?: "sm" | "default" | "lg" | "icon";
  variant?: "outline" | "ghost" | "secondary" | "default";
  className?: string;
} & McpPromptContext) {
  const [copied, setCopied] = useState(false);
  const prompt = useMemo(() => {
    const build = PROMPTS[promptKey] ?? PROMPTS.generate;
    return build({ testId, testName, targetUrl, repositoryId, buildId });
  }, [promptKey, testId, testName, targetUrl, repositoryId, buildId]);
  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [prompt]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={variant}
          size={size}
          className={className}
          type="button"
        >
          <Plug className={label ? "mr-2 h-4 w-4" : "h-4 w-4"} />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">Run this from your AI agent</p>
          <p className="text-xs text-muted-foreground">
            In-product AI is off. Paste this into your connected MCP client
            (Claude Code, Cursor, …).
          </p>
        </div>
        <div className="rounded-md border bg-muted p-2">
          <p className="font-mono text-xs leading-relaxed">{prompt}</p>
        </div>
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={copy}
            type="button"
          >
            {copied ? (
              <Check className="mr-1 h-3.5 w-3.5 text-green-500" />
            ) : (
              <Copy className="mr-1 h-3.5 w-3.5" />
            )}
            Copy
          </Button>
          <Link
            href="/settings#mcp-connect"
            className="text-xs underline underline-offset-4 text-muted-foreground hover:text-foreground"
          >
            Connect an agent →
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
