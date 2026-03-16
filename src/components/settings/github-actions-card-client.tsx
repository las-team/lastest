'use client';

import { useState } from 'react';
import { Github, Plus, AlertTriangle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DiagramThumbnail } from '@/components/ui/diagram-thumbnail';
import type { GithubActionConfig, Runner, Repository } from '@/lib/db/schema';
import { ConfigList } from '@/components/settings/github-actions/config-list-client';
import { AddConfigDialog } from '@/components/settings/github-actions/add-config-dialog-client';
import { ConnectGithubButton } from '@/components/settings/connect-github-button';

interface GithubActionsCardProps {
  configs: GithubActionConfig[];
  runners: Runner[];
  repos: Repository[];
  hasGithubAccount: boolean;
  githubUsername: string | null;
}

export function GithubActionsCard({
  configs,
  runners,
  repos,
  hasGithubAccount,
  githubUsername,
}: GithubActionsCardProps) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <Card id="github-actions">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Github className="w-5 h-5" />
            GitHub Actions
            <Popover>
              <PopoverTrigger asChild>
                <button className="text-muted-foreground hover:text-foreground transition-colors">
                  <Info className="w-4 h-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent side="bottom" align="start" className="w-auto p-3">
                <p className="text-xs text-muted-foreground mb-2">Development & Review Flow</p>
                <DiagramThumbnail
                  src="/docs/development-flow.png"
                  alt="Development & Review Flow — from code push to production with visual validation"
                  width={480}
                  height={120}
                />
              </PopoverContent>
            </Popover>
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
              <p className="text-sm font-medium">GitHub account not connected</p>
              <p className="text-xs text-muted-foreground">
                Connect your GitHub account above to enable workflow deployment.
              </p>
            </div>
            <ConnectGithubButton />
          </div>
        )}

        {hasGithubAccount && configs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Github className="h-10 w-10 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground mb-3">
              No repositories configured yet.
            </p>
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add Repository
            </Button>
          </div>
        )}

        {configs.length > 0 && (
          <ConfigList configs={configs} runners={runners} hasGithubAccount={hasGithubAccount} />
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
