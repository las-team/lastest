"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BrowserViewer } from "@/components/embedded-browser/browser-viewer-client";
import { ExplorerTimeline } from "./explorer-timeline";
import { ExplorerFindingsPanel } from "./explorer-findings-panel";
import { KnowledgeEditor, type KnowledgeListItem } from "./knowledge-editor";
import { ExperienceViewer } from "./experience-viewer";
import {
  useExplorerAgent,
  type ExplorerSessionWithFindings,
} from "./use-explorer-agent";
import type { AgentExperience } from "@/lib/db/schema";
import {
  Compass,
  Loader2,
  MonitorPlay,
  Pause,
  Play,
  Square,
  TestTubes,
} from "lucide-react";

export function ExplorerClient({
  repositoryId,
  defaultUrl,
  aiConfigured,
  initialSession,
  initialKnowledge,
  initialExperience,
}: {
  repositoryId: string;
  defaultUrl: string;
  aiConfigured: boolean;
  initialSession: ExplorerSessionWithFindings | null;
  initialKnowledge: KnowledgeListItem[];
  initialExperience: AgentExperience[];
}) {
  const {
    session,
    loading,
    error,
    isRunning,
    isPaused,
    isTerminal,
    progress,
    start,
    pause,
    resume,
    cancel,
    dismiss,
  } = useExplorerAgent(repositoryId, initialSession);

  const [targetUrl, setTargetUrl] = useState(defaultUrl);
  const [maxIterations, setMaxIterations] = useState(4);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const meta = session?.metadata;
  const streamUrl = typeof meta?.streamUrl === "string" ? meta.streamUrl : "";
  const queuedForBrowser = Boolean(meta?.queuedForBrowser);
  const findings = session?.findings ?? [];
  const report = meta?.explorerReport;
  const keptCount = meta?.explorerKeptTestIds?.length ?? 0;

  const showSetup = !session;

  return (
    <Tabs defaultValue="run" className="space-y-4">
      <TabsList>
        <TabsTrigger value="run">Explore</TabsTrigger>
        <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
        <TabsTrigger value="experience">Experience</TabsTrigger>
      </TabsList>

      <TabsContent value="run" className="space-y-4">
        {showSetup && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Compass className="h-4 w-4" />
                Start exploring
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!aiConfigured && (
                <p className="text-sm text-amber-600">
                  No AI provider configured — set one under Settings → AI first.
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="x-url">Target URL</Label>
                  <Input
                    id="x-url"
                    value={targetUrl}
                    placeholder="https://staging.your-app.com"
                    onChange={(e) => setTargetUrl(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="x-iterations">Iterations</Label>
                  <Input
                    id="x-iterations"
                    type="number"
                    min={1}
                    max={12}
                    value={maxIterations}
                    onChange={(e) =>
                      setMaxIterations(
                        Math.max(1, Math.min(12, Number(e.target.value) || 1)),
                      )
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="x-email">Login email (optional)</Label>
                  <Input
                    id="x-email"
                    value={email}
                    autoComplete="off"
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="x-password">Password (optional)</Label>
                  <Input
                    id="x-password"
                    type="password"
                    value={password}
                    autoComplete="new-password"
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                The explorer loops research → plan → act → analyze, rotating
                planning styles (normal → curious → psycho), records findings,
                learns from every page, and keeps passing flows as quarantined
                tests.
              </p>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button
                onClick={() =>
                  start({
                    targetUrl,
                    maxIterations,
                    ...(email && password ? { email, password } : {}),
                  })
                }
                disabled={loading || !targetUrl || !aiConfigured}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Start exploration
              </Button>
            </CardContent>
          </Card>
        )}

        {session && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    <Compass className="h-4 w-4" />
                    {meta?.explorerTargetUrl}
                    <Badge
                      variant={
                        session.status === "completed"
                          ? "default"
                          : session.status === "failed"
                            ? "destructive"
                            : "outline"
                      }
                    >
                      {session.status}
                    </Badge>
                    {keptCount > 0 && (
                      <Badge variant="outline" className="gap-1">
                        <TestTubes className="h-3 w-3" />
                        {keptCount} kept
                      </Badge>
                    )}
                  </span>
                  <span className="flex items-center gap-1">
                    {isRunning && (
                      <Button variant="ghost" size="sm" onClick={pause}>
                        <Pause className="h-3.5 w-3.5 mr-1" />
                        Pause
                      </Button>
                    )}
                    {isPaused && (
                      <Button variant="ghost" size="sm" onClick={resume}>
                        <Play className="h-3.5 w-3.5 mr-1" />
                        Resume
                      </Button>
                    )}
                    {(isRunning || isPaused) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600"
                        onClick={cancel}
                      >
                        <Square className="h-3.5 w-3.5 mr-1" />
                        Stop
                      </Button>
                    )}
                    {isTerminal && (
                      <Button variant="outline" size="sm" onClick={dismiss}>
                        New run
                      </Button>
                    )}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Progress value={progress} />
                {error && <p className="text-sm text-red-600">{error}</p>}
                <ExplorerTimeline steps={session.steps} />
              </CardContent>
            </Card>

            {(isRunning || isPaused) && (streamUrl || queuedForBrowser) && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <MonitorPlay className="h-4 w-4" />
                    Live browser
                    <span className="text-xs font-normal text-muted-foreground">
                      {queuedForBrowser
                        ? "waiting for a browser from the pool…"
                        : "watching the explorer work"}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {streamUrl ? (
                    <BrowserViewer
                      streamUrl={streamUrl}
                      interactive={false}
                      hideToolbar
                      className="rounded-md overflow-hidden border"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Waiting for an embedded browser…
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <ExplorerFindingsPanel findings={findings} report={report} />
          </>
        )}
      </TabsContent>

      <TabsContent value="knowledge">
        <KnowledgeEditor
          repositoryId={repositoryId}
          initialNotes={initialKnowledge}
        />
      </TabsContent>

      <TabsContent value="experience">
        <ExperienceViewer rows={initialExperience} />
      </TabsContent>
    </Tabs>
  );
}
