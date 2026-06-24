"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createApiToken } from "@/server/actions/api-tokens";
import { Check, Copy, KeyRound, Loader2, Plug, Plus } from "lucide-react";
import { toast } from "sonner";

interface McpPanelProps {
  serverUrl: string;
  repositoryId?: string;
  repoName?: string;
}

function CopyButton({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className={className}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? (
        <Check className="h-4 w-4 text-green-500" />
      ) : (
        <Copy className="h-4 w-4" />
      )}
    </Button>
  );
}

function CodeBlock({ value }: { value: string }) {
  return (
    <div className="relative">
      <pre className="bg-muted p-3 rounded-md text-xs font-mono whitespace-pre-wrap break-all pr-10">
        {value}
      </pre>
      <CopyButton value={value} className="absolute top-2 right-2" />
    </div>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
          {n}
        </span>
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <div className="pl-8 space-y-3">{children}</div>
    </div>
  );
}

export function McpPanel({ serverUrl, repositoryId, repoName }: McpPanelProps) {
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const result = await createApiToken("MCP client");
      if ("error" in result) {
        toast.error(result.error);
      } else {
        setCreatedToken(result.token);
      }
    } catch {
      toast.error("Failed to create API key");
    } finally {
      setCreating(false);
    }
  };

  const apiKey = createdToken ?? "YOUR_API_KEY";

  const claudeCmd = `claude mcp add lastest -- npx -y @lastest/mcp-server@latest --url ${serverUrl} --api-key ${apiKey}`;

  const jsonConfig = `{
  "mcpServers": {
    "lastest": {
      "command": "npx",
      "args": ["-y", "@lastest/mcp-server@latest", "--url", "${serverUrl}", "--api-key", "${apiKey}"]
    }
  }
}`;

  const repoClause = repoName
    ? ` for the repository "${repoName}"${repositoryId ? ` (id: ${repositoryId})` : ""}`
    : "";

  const promptText = repoName
    ? `Use the Lastest MCP server (visual regression testing)${repoClause}.
1. List its functional areas and existing tests.
2. Create a new visual test that <describe the user flow to cover, e.g. "logs in and opens the dashboard">. Ask me for the base URL and any credentials you need.
3. Run it, then summarize the build status and show me any visual diffs to review.`
    : `Use the Lastest MCP server (visual regression testing).
1. List my repositories, then pick the one I name.
2. Create a new visual test that <describe the user flow to cover, e.g. "logs in and opens the dashboard">. Ask me for the base URL and any credentials you need.
3. Run it, then summarize the build status and show me any visual diffs to review.`;

  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plug className="h-5 w-5" />
              Build tests with MCP
            </CardTitle>
            <CardDescription>
              Drive Lastest from your AI coding agent (Claude Code, Claude
              Desktop, Cursor, Windsurf). Create, run, and review visual tests
              in natural language.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Step n={1} title="Create an API key">
              {createdToken ? (
                <>
                  <CodeBlock value={createdToken} />
                  <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-md p-3 text-sm">
                    <p className="font-medium text-yellow-600 dark:text-yellow-400 mb-1">
                      Save it now
                    </p>
                    <p className="text-muted-foreground">
                      This key authenticates as your user against the Lastest
                      API and won&apos;t be shown again. It&apos;s already
                      filled into the commands below.
                    </p>
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={handleCreate} disabled={creating}>
                    {creating ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4 mr-2" />
                    )}
                    Create API Key
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    Authenticates the MCP server as you. Shown once.
                  </p>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground opacity-75 flex items-center gap-1">
                <KeyRound className="h-3 w-3" />
                <a className="underline" href="/settings#api-tokens">
                  Manage keys in Settings → API Keys
                </a>
              </p>
            </Step>

            <Step n={2} title="Connect your client">
              <div className="space-y-2">
                <p className="text-sm font-medium">Claude Code</p>
                <CodeBlock value={claudeCmd} />
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  Claude Desktop, Cursor, Windsurf, Cline
                </p>
                <p className="text-xs text-muted-foreground">
                  Add to your MCP config (e.g.{" "}
                  <code className="font-mono">claude_desktop_config.json</code>
                  ).
                </p>
                <CodeBlock value={jsonConfig} />
              </div>
              <p className="text-[11px] text-muted-foreground opacity-75">
                Setup per client in the{" "}
                <a
                  className="underline"
                  href="https://github.com/las-team/lastest/wiki/MCP-Server"
                  target="_blank"
                  rel="noreferrer"
                >
                  MCP Server wiki
                </a>
                .
              </p>
            </Step>

            <Step n={3} title="Build a test">
              <p className="text-sm text-muted-foreground">
                Paste this into your agent, then fill in the flow you want to
                cover:
              </p>
              <CodeBlock value={promptText} />
            </Step>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
