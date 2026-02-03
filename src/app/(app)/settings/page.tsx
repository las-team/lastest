import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import * as queries from '@/lib/db/queries';
import { getCurrentUser } from '@/lib/auth';
import { Github, Check, X, Database, ExternalLink, Users, Bot, Mail } from 'lucide-react';
import { PlaywrightSettingsCard } from '@/components/settings/playwright-settings-card';
import { EnvironmentConfigCard } from '@/components/settings/environment-config-card';
import { DiffSensitivityCard } from '@/components/settings/diff-sensitivity-card';
import { AISettingsCard } from '@/components/settings/ai-settings-card';
import { AILogsCard } from '@/components/settings/ai-logs-card';
import { NotificationSettingsCard } from '@/components/settings/notification-settings-card';
import { ResetSetupGuide } from '@/components/setup-guide/reset-setup-guide';
import { BranchSelector } from '@/components/settings/branch-selector';
import { UserList } from '@/components/users/user-list';
import { PendingInvitations } from '@/components/users/pending-invitations';
import { InviteUserDialog } from '@/components/users/invite-user-dialog';
import { RunnerList } from '@/components/runners/runner-list';
import { CreateRunnerDialog } from '@/components/runners/create-runner-dialog';
import { getRunners } from '@/server/actions/runners';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const [currentUser, githubAccount, selectedRepo] = await Promise.all([
    getCurrentUser(),
    queries.getGithubAccount(),
    queries.getSelectedRepository(),
  ]);
  const playwrightSettings = await queries.getPlaywrightSettings(selectedRepo?.id);
  const environmentConfig = await queries.getEnvironmentConfig(selectedRepo?.id);
  const diffSensitivitySettings = await queries.getDiffSensitivitySettings(selectedRepo?.id);
  const aiSettings = await queries.getAISettings(selectedRepo?.id);
  const aiLogs = await queries.getAIPromptLogs(selectedRepo?.id, 50);
  const notificationSettings = await queries.getNotificationSettings(selectedRepo?.id);

  // Fetch admin-only data
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'owner';
  const [teamMembers, pendingInvitations, runners] = isAdmin && currentUser?.teamId
    ? await Promise.all([
        queries.getTeamMembers(currentUser.teamId),
        queries.getPendingInvitationsByTeam(currentUser.teamId),
        getRunners(),
      ])
    : [[], [], []];

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Status Messages */}
          {params.success === 'github_connected' && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700">
              <Check className="w-5 h-5" />
              GitHub account connected successfully!
            </div>
          )}
          {params.error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
              <X className="w-5 h-5" />
              Failed to connect GitHub: {params.error.replace(/_/g, ' ')}
            </div>
          )}

          {/* GitHub Integration */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Github className="w-5 h-5" />
                GitHub Integration
              </CardTitle>
              <CardDescription>
                Connect GitHub for PR linking and automatic triggers
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {githubAccount ? (
                <>
                  <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
                        <Github className="w-6 h-6" />
                      </div>
                      <div>
                        <div className="font-medium">@{githubAccount.githubUsername}</div>
                        <div className="text-sm text-muted-foreground">Connected</div>
                      </div>
                    </div>
                    <a
                      href="/api/auth/github"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:underline"
                    >
                      Reconnect
                    </a>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Builds will automatically link to open PRs by branch name.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-muted-foreground">
                    Connect your GitHub account to link builds with pull requests.
                  </p>
                  <a
                    href="/api/auth/github"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800"
                  >
                    <Github className="w-5 h-5" />
                    Connect GitHub
                  </a>
                </>
              )}
            </CardContent>
          </Card>

          {/* Repository Info */}
          <Card>
            <CardHeader>
              <CardTitle>Repository</CardTitle>
              <CardDescription>
                Selected repository information
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Repository</span>
                <span className="font-medium">{selectedRepo?.fullName || 'None selected'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Selected Branch</span>
                {selectedRepo ? (
                  <BranchSelector
                    repositoryId={selectedRepo.id}
                    currentBranch={selectedRepo.selectedBranch}
                    defaultBranch={selectedRepo.defaultBranch}
                  />
                ) : (
                  <Badge variant="outline">-</Badge>
                )}
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Default Branch</span>
                <code className="text-sm">{selectedRepo?.defaultBranch || '-'}</code>
              </div>
            </CardContent>
          </Card>

          {/* Database Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="w-5 h-5" />
                Database
              </CardTitle>
              <CardDescription>
                SQLite database configuration
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Location</span>
                <code className="text-sm">./lastest2.db</code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Type</span>
                <span>SQLite with WAL mode</span>
              </div>
              <div className="pt-2 border-t">
                <a
                  href="https://local.drizzle.studio"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 text-sm"
                >
                  <ExternalLink className="w-4 h-4" />
                  Open Drizzle Studio
                </a>
                <p className="text-xs text-muted-foreground mt-2">
                  Run <code className="bg-muted px-1 rounded">pnpm db:studio</code> first
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Environment Config */}
          <EnvironmentConfigCard
            config={environmentConfig}
            repositoryId={selectedRepo?.id}
          />

          {/* AI Settings */}
          <AISettingsCard
            settings={aiSettings}
            repositoryId={selectedRepo?.id}
          />

          {/* AI Prompt Logs */}
          <AILogsCard
            logs={aiLogs}
            repositoryId={selectedRepo?.id}
          />

          {/* Notifications */}
          <NotificationSettingsCard
            settings={notificationSettings}
            repositoryId={selectedRepo?.id}
            hasGithubAccount={!!githubAccount}
          />

          {/* Diff Sensitivity */}
          <DiffSensitivityCard
            settings={diffSensitivitySettings}
            repositoryId={selectedRepo?.id}
          />

          {/* Playwright Config */}
          <PlaywrightSettingsCard
            settings={playwrightSettings}
            repositoryId={selectedRepo?.id}
          />

          {/* User Management (Admin only) */}
          {isAdmin && currentUser?.teamId && (
            <>
              {/* Pending Invitations */}
              {pendingInvitations.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Mail className="w-5 h-5" />
                      Pending Invitations
                    </CardTitle>
                    <CardDescription>
                      Invitations awaiting acceptance
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <PendingInvitations invitations={pendingInvitations} />
                  </CardContent>
                </Card>
              )}

              {/* Team Members */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2">
                      <Users className="w-5 h-5" />
                      Team Members ({teamMembers.length})
                    </CardTitle>
                    <CardDescription>
                      Manage members of your team
                    </CardDescription>
                  </div>
                  <InviteUserDialog />
                </CardHeader>
                <CardContent>
                  <UserList users={teamMembers} currentUserId={currentUser.id} />
                </CardContent>
              </Card>

              {/* Remote Runners */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2">
                      <Bot className="w-5 h-5" />
                      Remote Runners ({runners.length})
                    </CardTitle>
                    <CardDescription>
                      Runners run tests on your local machine and report results to the cloud
                    </CardDescription>
                  </div>
                  <CreateRunnerDialog />
                </CardHeader>
                <CardContent>
                  {runners.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Bot className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p className="mb-2">No runners configured</p>
                      <p className="text-sm">Create a runner to enable remote test execution</p>
                    </div>
                  ) : (
                    <RunnerList runners={runners} />
                  )}
                </CardContent>
              </Card>

            </>
          )}

          {/* Version */}
          <Card>
            <CardHeader>
              <CardTitle>About</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Version</span>
                <span>0.1.0</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Framework</span>
                <span>Next.js 16</span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t">
                <span className="text-muted-foreground">Setup Guide</span>
                <ResetSetupGuide />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
