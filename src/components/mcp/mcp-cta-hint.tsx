"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Check, Copy, Plug } from "lucide-react";

/**
 * Drop-in replacement for an in-product AI button when in-product AI (BYOK) is
 * not configured. Shows a small "Use your agent" affordance; the popover gives a
 * copy-paste MCP prompt that reproduces the action in the user's own AI client,
 * plus a link to connect an agent.
 */
const PROMPTS: Record<string, string> = {
  generate:
    "Using the Lastest MCP server, create a Playwright test for <URL> that covers the main flow, then run it and show me the result.",
  heal: "Using the Lastest MCP server, list my failing tests, heal each against the live page, re-run them, and summarize what changed.",
  enhance:
    "Using the Lastest MCP server, open test <NAME>, add meaningful assertions and edge cases against the live page, and save it.",
  discover:
    "Using the Lastest MCP server, explore <URL>, propose functional areas to cover, create them, and scaffold a starter test per area.",
  routes:
    "Using the Lastest MCP server, discover the testable routes of <URL> and create functional areas for them.",
  spec: "Using the Lastest MCP server, turn this spec into Playwright tests and add them to the right functional areas.",
  diff: "Using the Lastest MCP server, review the latest build's visual diffs, tell me which are real regressions vs. noise, and approve the safe ones.",
};

export function McpCtaHint({
  promptKey,
  label = "Use your agent",
  size = "sm",
  variant = "outline",
  className,
}: {
  promptKey: keyof typeof PROMPTS | string;
  label?: string;
  size?: "sm" | "default" | "lg" | "icon";
  variant?: "outline" | "ghost" | "secondary" | "default";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const prompt = PROMPTS[promptKey] ?? PROMPTS.generate;
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
