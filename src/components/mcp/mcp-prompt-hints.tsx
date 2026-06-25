"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Copy } from "lucide-react";

/**
 * Copy-paste prompts a user pastes into their own AI agent (over MCP) to get
 * the same outcomes the in-product "agent functions" used to provide. Shown on
 * the AI settings panel whenever in-product AI (BYOK) is NOT configured, so the
 * MCP-first path is always actionable without pasting an API key into Lastest.
 *
 * When a `repositoryId` is known (the user's active repo), it is interpolated
 * so the copied prompt scopes the agent to the right project instead of leaving
 * it to guess.
 */
function buildPrompts(repositoryId?: string | null) {
  const inRepo = repositoryId ? ` in repo ${repositoryId}` : "";
  return [
    {
      title: "Generate tests for a page",
      prompt: `Using the Lastest MCP server, create a Playwright test${inRepo} for <URL> that covers the main user flow, then run it and show me the result.`,
    },
    {
      title: "Fix / heal failing tests",
      prompt: `Using the Lastest MCP server, list my failing tests${inRepo}, heal each one against the live page, re-run them, and summarize what changed.`,
    },
    {
      title: "Review a build's visual diffs",
      prompt: `Using the Lastest MCP server, review the latest build's visual diffs${inRepo}: walk the pending diffs, tell me which are real regressions vs. noise, and approve the safe ones.`,
    },
    {
      title: "Triage build failures",
      prompt: `Using the Lastest MCP server, get the latest build's failures${inRepo} with their errors and recent history, and classify each as regression / flaky / environment / test-maintenance.`,
    },
    {
      title: "Discover areas & plan coverage",
      prompt: `Using the Lastest MCP server, explore <URL>, propose functional areas to cover${inRepo}, create them, and scaffold a starter test per area.`,
    },
  ];
}

function CopyRow({ title, prompt }: { title: string; prompt: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [prompt]);
  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{title}</p>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={copy}
          type="button"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-green-500" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground font-mono leading-relaxed">
        {prompt}
      </p>
    </div>
  );
}

export function McpPromptHints({
  repositoryId,
}: {
  repositoryId?: string | null;
}) {
  const prompts = buildPrompts(repositoryId);
  return (
    <div className="space-y-2">
      {prompts.map((p) => (
        <CopyRow key={p.title} title={p.title} prompt={p.prompt} />
      ))}
    </div>
  );
}
