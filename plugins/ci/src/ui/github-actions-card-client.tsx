"use client";

import { useState, type ReactNode } from "react";
import { Github, Plus, AlertTriangle, Info } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@lastest/ui";
import type { GithubActionConfig } from "../schema";
import type {
  CiRepoOption as Repository,
  CiRunnerOption as Runner,
} from "../types";
import { ConfigList } from "./github/config-list-client";
import { AddConfigDialog } from "./github/add-config-dialog-client";

/**
 * Two things this card renders that it may not import.
 *
 * `connectAccountButton` was `<ConnectGithubButton />` — an app component that
 * starts the OAuth flow, i.e. the credential half of the old `scm`
 * pseudo-plugin that stayed in core. `flowDiagram` was `<DiagramThumbnail />`,
 * which is built on `next/image` and is app furniture rather than a design-
 * system primitive, so it did not follow the other three into `libs/ui`.
 *
 * Both go down as props, per recipe §6: **the plugin owns the placement, the
 * app owns the thing placed.** Nothing here learns what it mounted.
 */
interface GithubActionsCardProps {
  configs: GithubActionConfig[];
  runners: Runner[];
  repos: Repository[];
  hasGithubAccount: boolean;
  githubUsername: string | null;
  connectAccountButton: ReactNode;
  flowDiagram?: ReactNode;
}

export function GithubActionsCard({
  configs,
  runners,
  repos,
  hasGithubAccount,
  githubUsername,
  connectAccountButton,
  flowDiagram,
}: GithubActionsCardProps) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <Card id="github-actions">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Github className="w-5 h-5" />
            GitHub Actions
            {flowDiagram && (
              <Popover>
                <PopoverTrigger asChild>
                  <button className="text-muted-foreground hover:text-foreground transition-colors">
                    <Info className="w-4 h-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  side="bottom"
                  align="start"
                  className="w-auto p-3"
                >
                  <p className="text-xs text-muted-foreground mb-2">
                    Development & Review Flow
                  </p>
                  {flowDiagram}
                </PopoverContent>
              </Popover>
            )}
          </CardTitle>
          <CardDescription>
            Automate visual testing in your CI/CD pipeline
          </CardDescription>
        </div>
        {hasGithubAccount && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add Repository
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasGithubAccount && (
          <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium">
                GitHub account not connected
              </p>
              <p className="text-xs text-muted-foreground">
                Connect your GitHub account above to enable workflow deployment.
              </p>
            </div>
            {connectAccountButton}
          </div>
        )}

        {hasGithubAccount && configs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Github className="h-10 w-10 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground mb-3">
              No repositories configured yet.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Repository
            </Button>
          </div>
        )}

        {configs.length > 0 && (
          <ConfigList
            configs={configs}
            hasGithubAccount={hasGithubAccount}
            runners={runners}
          />
        )}

        {hasGithubAccount && (
          <AddConfigDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            runners={runners}
            repos={repos}
            githubUsername={githubUsername}
          />
        )}
      </CardContent>
    </Card>
  );
}
