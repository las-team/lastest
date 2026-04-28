'use client';

import { useState } from 'react';
import { Plus, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { GitlabPipelineConfig, Runner, Repository } from '@/lib/db/schema';
import { ConfigList } from '@/components/settings/gitlab-pipelines/config-list-client';
import { AddConfigDialog } from '@/components/settings/gitlab-pipelines/add-config-dialog-client';
import { ConnectGitlabButton } from '@/components/settings/connect-gitlab-button';

function GitLabIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M22.749 9.769L21.756 6.71l-1.97-6.063a.339.339 0 00-.642 0L17.176 6.71H6.825L4.857.647a.339.339 0 00-.642 0L2.245 6.71l-.992 3.059a.68.68 0 00.247.762L12 19.292l10.5-8.761a.68.68 0 00.247-.762z" />
    </svg>
  );
}

interface GitlabPipelinesCardProps {
  configs: GitlabPipelineConfig[];
  runners: Runner[];
  repos: Repository[];
  hasGitlabAccount: boolean;
}

export function GitlabPipelinesCard({ configs, runners, repos, hasGitlabAccount }: GitlabPipelinesCardProps) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <Card id="gitlab-pipelines">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <GitLabIcon className="w-5 h-5" />
            GitLab Pipelines
          </CardTitle>
          <CardDescription>
            Auto-run visual tests on branches and merge requests — including self-hosted instances.
          </CardDescription>
        </div>
        {hasGitlabAccount && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add Project
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasGitlabAccount && (
          <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium">GitLab account not connected</p>
              <p className="text-xs text-muted-foreground">
                Connect a GitLab account (gitlab.com or self-hosted) to add pipeline configs.
              </p>
            </div>
            <ConnectGitlabButton />
          </div>
        )}

        {hasGitlabAccount && configs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <GitLabIcon className="h-10 w-10 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground mb-3">No projects configured yet.</p>
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add Project
            </Button>
          </div>
        )}

        {configs.length > 0 && (
          <ConfigList configs={configs} runners={runners} hasGitlabAccount={hasGitlabAccount} />
        )}

        {hasGitlabAccount && (
          <AddConfigDialog open={addOpen} onOpenChange={setAddOpen} runners={runners} repos={repos} />
        )}
      </CardContent>
    </Card>
  );
}
