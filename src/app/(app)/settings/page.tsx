import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import * as queries from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';
import { Github, Check, X, Users, Bot, Mail, Terminal } from 'lucide-react';

// GitLab icon SVG component
function GitLabIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M4.845.904c-.435 0-.82.28-.955.692C2.639 5.449 1.246 9.728.07 13.335a1.437 1.437 0 00.522 1.607l11.071 8.045c.2.145.472.144.67-.004l11.073-8.04a1.436 1.436 0 00.522-1.61c-1.285-3.942-2.683-8.256-3.817-11.746a1.004 1.004 0 00-.957-.684.987.987 0 00-.949.69l-2.405 7.408H8.203l-2.41-7.408a.987.987 0 00-.942-.69h-.006z" />
    </svg>
  );
}
import { PlaywrightSettingsCard } from '@/components/settings/playwright-settings-card';
import { EnvironmentConfigCard } from '@/components/settings/environment-config-card';
import { DiffSensitivityCard } from '@/components/settings/diff-sensitivity-card';
import { AISettingsCard } from '@/components/settings/ai-settings-card';
import { AILogsCard } from '@/components/settings/ai-logs-card';
import { NotificationSettingsCard } from '@/components/settings/notification-settings-card';
import { ResetSetupGuide } from '@/components/setup-guide/reset-setup-guide';
import { SettingsHighlighter } from '@/components/settings/settings-highlighter';
import { BranchSelector } from '@/components/settings/branch-selector';
import { SettingsTabs } from '@/components/settings/settings-tabs';
import { UserList } from '@/components/users/user-list';
import { PendingInvitations } from '@/components/users/pending-invitations';
import { InviteUserDialog } from '@/components/users/invite-user-dialog';
import { RunnerList } from '@/components/runners/runner-list';
import { CreateRunnerDialog } from '@/components/runners/create-runner-dialog';
import { getRunners, getSystemRunners } from '@/server/actions/runners';
import { listSystemEmbeddedSessions } from '@/server/actions/embedded-sessions';
import { listApiTokens } from '@/server/actions/api-tokens';
import { ApiTokensSection } from '@/components/api-tokens/api-tokens-section';
import { GoogleSheetsSettingsCard } from '@/components/settings/google-sheets-settings-card';
import { TestingTemplateSelector } from '@/components/settings/testing-template-selector';
import { AutoApproveToggle } from '@/components/settings/auto-approve-toggle';
import { EarlyAdopterToggle } from '@/components/settings/early-adopter-toggle';
import { BanAiModeToggle } from '@/components/settings/ban-ai-mode-toggle';
import { GamificationToggle } from '@/components/settings/gamification-toggle';
import { GamificationAdminCard } from '@/components/settings/gamification-admin-card';
import { ConnectGithubButton, ReconnectGithubLink } from '@/components/settings/connect-github-button';
import { GithubActionsCard } from '@/components/settings/github-actions-card-client';
import { ConnectGitlabButton } from '@/components/settings/connect-gitlab-button';
import { GitlabPipelinesCard } from '@/components/settings/gitlab-pipelines-card-client';
import { ScheduleManagerCard } from '@/components/settings/schedule-manager-client';
import { DiagramThumbnail } from '@/components/ui/diagram-thumbnail';
import { TestMigrationCard } from '@/components/settings/test-migration-card';
import { EmailPreferencesCard } from '@/components/settings/email-preferences-client';
import { StorageUsageCard } from '@/components/settings/storage-usage-card-client';
import { DeleteAccountDialog } from '@/components/settings/delete-account-dialog';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const session = await getCurrentSession();
  const currentUser = session?.user ?? null;
  const teamId = session?.team?.id;
  const userId = session?.user?.id;
  const [githubAccount, gitlabAccount, selectedRepo] = await Promise.all([
    teamId ? queries.getGithubAccountByTeam(teamId) : null,
    teamId ? queries.getGitlabAccountByTeam(teamId) : null,
    teamId ? queries.getSelectedRepository(userId, teamId) : null,
  ]);
  const [githubActionConfigs, gitlabPipelineConfigs, teamRepos, runners, sysRunners] = await Promise.all([
    teamId ? queries.getGithubActionConfigs(teamId) : [],
    teamId ? queries.getGitlabPipelineConfigs(teamId) : [],
    teamId ? queries.getRepositoriesByTeam(teamId) : [],
    getRunners(),
    getSystemRunners(),
  ]);
  const [apiTokens, systemEBSessions] = await Promise.all([
    listApiTokens(),
    listSystemEmbeddedSessions(),
  ]);
  const playwrightSettings = await queries.getPlaywrightSettings(selectedRepo?.id);
  const environmentConfig = await queries.getEnvironmentConfig(selectedRepo?.id);
  const diffSensitivitySettings = await queries.getDiffSensitivitySettings(selectedRepo?.id);
  const aiSettings = await queries.getAISettings(selectedRepo?.id);
  const aiLogs = await queries.getAIPromptLogs(selectedRepo?.id, 50);
  const notificationSettings = await queries.getNotificationSettings(selectedRepo?.id);
  const googleSheetsAccount = currentUser?.teamId
    ? await queries.getGoogleSheetsAccount(currentUser.teamId)
    : null;
  const googleSheetsDataSources = await queries.getGoogleSheetsDataSources(selectedRepo?.id);

  // Fetch admin-only data
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'owner';
  const [teamMembers, pendingInvitations] = isAdmin && currentUser?.teamId
    ? await Promise.all([
        queries.getTeamMembers(currentUser.teamId),
        queries.getPendingInvitationsByTeam(currentUser.teamId),
      ])
    : [[], []];

  // Gamification admin data
  const [activeGamificationSeason, activeBugBlitz] = session?.team?.gamificationEnabled && teamId
    ? await Promise.all([
        queries.getActiveSeason(teamId),
        queries.getActiveBugBlitz(teamId),
      ])
    : [null, null];

  const storageUsage = teamId ? await queries.getTeamStorageUsage(teamId) : null;
  const enforcementEnabled = process.env.ENFORCE_STORAGE_LIMITS === 'true';

  const serverUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const earlyAdopterMode = session?.team?.earlyAdopterMode ?? false;
  const banAiMode = session?.team?.banAiMode ?? false;

  const generalTab = (
    <>
      {/* Repository Info */}
      <Card id="repository">
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
          {selectedRepo && (
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Testing Template</span>
              <TestingTemplateSelector
                repositoryId={selectedRepo.id}
                currentTemplate={selectedRepo.testingTemplate}
              />
            </div>
          )}
          {selectedRepo && (
            <AutoApproveToggle
              repositoryId={selectedRepo.id}
              enabled={selectedRepo.autoApproveDefaultBranch ?? false}
              defaultBranch={selectedRepo.defaultBranch || 'main'}
            />
          )}
        </CardContent>
      </Card>

      {/* Environment Config */}
      <div id="environment">
        <EnvironmentConfigCard
          config={environmentConfig}
          repositoryId={selectedRepo?.id}
        />
      </div>

      {/* Features */}
      <Card id="features">
        <CardHeader>
          <CardTitle>Features</CardTitle>
          <CardDescription>
            Toggle experimental features
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <EarlyAdopterToggle enabled={session?.team?.earlyAdopterMode ?? false} />
          <BanAiModeToggle enabled={session?.team?.banAiMode ?? false} />
          <GamificationToggle enabled={session?.team?.gamificationEnabled ?? false} />
        </CardContent>
      </Card>

      {/* Gamification admin controls (admin-only) */}
      {isAdmin && (
        <GamificationAdminCard
          enabled={session?.team?.gamificationEnabled ?? false}
          activeSeasonName={activeGamificationSeason?.name ?? null}
          activeBlitz={
            activeBugBlitz
              ? {
                  id: activeBugBlitz.id,
                  name: activeBugBlitz.name,
                  endsAt: activeBugBlitz.endsAt,
                  multiplier: activeBugBlitz.multiplier,
                }
              : null
          }
        />
      )}

      {/* Storage Usage */}
      {storageUsage && (
        <div id="storage">
          <StorageUsageCard
            usedBytes={storageUsage.storageUsedBytes}
            quotaBytes={storageUsage.storageQuotaBytes}
            lastCalculatedAt={storageUsage.storageLastCalculatedAt?.toISOString() ?? null}
            isAdmin={isAdmin}
            enforcementEnabled={enforcementEnabled}
          />
        </div>
      )}

      {/* Version */}
      <Card id="about">
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Version</span>
            <span className="font-mono">0.1.{process.env.NEXT_PUBLIC_GIT_COMMIT_COUNT ?? '0'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Commit</span>
            <span className="font-mono text-xs">{process.env.NEXT_PUBLIC_GIT_HASH ?? 'dev'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Built</span>
            <span>{process.env.NEXT_PUBLIC_BUILD_DATE ?? 'unknown'}</span>
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
    </>
  );

  const integrationsTab = (
    <>
      {/* GitHub Integration */}
      <Card id="github">
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
              <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center">
                    <Github className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="font-medium">@{githubAccount.githubUsername}</div>
                    <div className="text-sm text-muted-foreground">Connected</div>
                  </div>
                </div>
                <ReconnectGithubLink />
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
              <ConnectGithubButton />
            </>
          )}
        </CardContent>
      </Card>

      {/* GitLab Integration */}
      <Card id="gitlab">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitLabIcon className="w-5 h-5" />
            GitLab Integration
          </CardTitle>
          <CardDescription>
            Connect GitLab for MR linking and automatic triggers
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {gitlabAccount ? (
            <>
              <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center">
                    <GitLabIcon className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="font-medium">@{gitlabAccount.gitlabUsername}</div>
                    <div className="text-sm text-muted-foreground">
                      {gitlabAccount.instanceUrl === 'https://gitlab.com' ? 'Connected' : gitlabAccount.instanceUrl}
                    </div>
                  </div>
                </div>
                <a
                  href="/api/connect/gitlab"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline"
                >
                  Reconnect
                </a>
              </div>
              <p className="text-sm text-muted-foreground">
                Builds will automatically link to open MRs by branch name.
              </p>
            </>
          ) : (
            <>
              <p className="text-muted-foreground">
                Connect your GitLab account to link builds with merge requests. Self-hosted instances supported via PAT or per-account OAuth.
              </p>
              <ConnectGitlabButton />
            </>
          )}
        </CardContent>
      </Card>

      {/* Google Sheets Test Data */}
      <div id="google-sheets">
        <GoogleSheetsSettingsCard
          account={googleSheetsAccount ? {
            id: googleSheetsAccount.id,
            googleEmail: googleSheetsAccount.googleEmail,
            googleName: googleSheetsAccount.googleName,
          } : null}
          dataSources={googleSheetsDataSources}
          repositoryId={selectedRepo?.id}
        />
      </div>
    </>
  );

  const cicdTab = (
    <>
      {/* Scheduled Runs */}
      {selectedRepo && (
        <div id="schedules">
          <ScheduleManagerCard repositoryId={selectedRepo.id} />
        </div>
      )}

      {/* GitHub Actions */}
      <div id="github-actions">
        <GithubActionsCard
          configs={githubActionConfigs}
          runners={runners}
          repos={teamRepos}
          hasGithubAccount={!!githubAccount}
          githubUsername={githubAccount?.githubUsername ?? null}
        />
      </div>

      <div id="gitlab-pipelines">
        <GitlabPipelinesCard
          configs={gitlabPipelineConfigs}
          runners={runners}
          repos={teamRepos}
          hasGitlabAccount={!!gitlabAccount}
        />
      </div>
    </>
  );

  const diffTab = (
    <div id="diff-sensitivity">
      <DiffSensitivityCard
        settings={diffSensitivitySettings}
        repositoryId={selectedRepo?.id}
      />
    </div>
  );

  const playwrightTab = (
    <div id="playwright">
      <PlaywrightSettingsCard
        settings={playwrightSettings}
        repositoryId={selectedRepo?.id}
      />
    </div>
  );

  const aiTab = banAiMode ? (
    <Card>
      <CardHeader>
        <CardTitle>AI disabled</CardTitle>
        <CardDescription>
          AI features are turned off for this team. Toggle Ban AI Mode in the
          General tab to re-enable AI settings and logs.
        </CardDescription>
      </CardHeader>
    </Card>
  ) : (
    <>
      <div id="ai-settings">
        <AISettingsCard
          settings={aiSettings}
          repositoryId={selectedRepo?.id}
        />
      </div>

      <div id="ai-logs">
        <AILogsCard
          logs={aiLogs}
          repositoryId={selectedRepo?.id}
        />
      </div>
    </>
  );

  const notificationsTab = (
    <>
      <div id="email-preferences">
        <EmailPreferencesCard />
      </div>

      <div id="notifications">
        <NotificationSettingsCard
          settings={notificationSettings}
          repositoryId={selectedRepo?.id}
          hasGithubAccount={!!githubAccount}
          hasGitlabAccount={!!gitlabAccount}
        />
      </div>
    </>
  );

  const teamTab = isAdmin && currentUser?.teamId ? (
    <div id="team" className="space-y-6">
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

      {/* Runners & API Access */}
      <Card id="runners">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Bot className="w-5 h-5" />
              Runners & API Access
            </CardTitle>
            <CardDescription>
              Local/remote runners that execute tests, plus API keys for the MCP server, VS Code extension, and scripts.
            </CardDescription>
          </div>
          <CreateRunnerDialog />
        </CardHeader>
        <CardContent className="space-y-6">
          <div id="api-tokens">
            <ApiTokensSection tokens={apiTokens} serverUrl={serverUrl} />
          </div>

          <div className="border-t pt-4 space-y-4">
            <div>
              <p className="text-sm font-medium flex items-center gap-2">
                <Bot className="w-4 h-4" /> Runners ({runners.length})
              </p>
              <p className="text-xs text-muted-foreground">CLI agents and embedded browsers that run tests on your machines.</p>
            </div>
          {runners.length === 0 && sysRunners.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground">
              <Bot className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="mb-1">No runners configured</p>
              <p className="text-sm">Create a runner above to get a token, then start it with the CLI.</p>
            </div>
          ) : (
            <RunnerList runners={runners} systemRunners={sysRunners} systemSessions={systemEBSessions} />
          )}

          <details open={runners.length === 0 ? true : undefined}>
            <summary className="text-sm font-medium flex items-center gap-2 cursor-pointer select-none py-1">
              <Terminal className="w-4 h-4" />
              Setup Guide
            </summary>
            <div className="bg-muted/50 border rounded-md p-4 mt-2 space-y-3 text-xs text-muted-foreground">
              <DiagramThumbnail
                src="/docs/runner-logic.png"
                alt="Remote Runners Architecture Diagram"
                width={140}
                height={90}
              />
              <div>
                <p className="font-medium mb-1">1. Install Playwright browser:</p>
                <pre className="bg-muted p-2 rounded text-xs font-mono">npx playwright install chromium</pre>
              </div>
              <div>
                <p className="font-medium mb-1">2. Start as background daemon:</p>
                <pre className="bg-muted p-2 rounded text-xs font-mono">npx @lastest/runner start -t YOUR_TOKEN -s {serverUrl}</pre>
                <p className="text-[11px] mt-1 opacity-75">Logs: ~/.lastest/runner.log · Config saved for subsequent runs</p>
              </div>
              <div>
                <p className="font-medium mb-1">3. Or run in foreground (Docker / CI):</p>
                <pre className="bg-muted p-2 rounded text-xs font-mono">npx @lastest/runner run -t YOUR_TOKEN -s {serverUrl}</pre>
              </div>
              <div>
                <p className="font-medium mb-1">Manage daemon:</p>
                <pre className="bg-muted p-2 rounded text-xs font-mono space-y-0.5">{`npx @lastest/runner stop      # Stop background runner
npx @lastest/runner status    # Check if running
npx @lastest/runner log -f    # Follow logs in real-time`}</pre>
              </div>
              <div>
                <p className="font-medium mb-1">Trigger builds from CI:</p>
                <pre className="bg-muted p-2 rounded text-xs font-mono">{`npx @lastest/runner trigger -t YOUR_TOKEN -s ${serverUrl} --branch main`}</pre>
                <p className="text-[11px] mt-1 opacity-75">Options: <code className="bg-muted px-1 py-0.5 rounded">--timeout</code> ms, <code className="bg-muted px-1 py-0.5 rounded">--commit</code> SHA, <code className="bg-muted px-1 py-0.5 rounded">--target-url</code> override, <code className="bg-muted px-1 py-0.5 rounded">--fail-on-changes</code></p>
              </div>
              <div>
                <p className="font-medium mb-1">List available repositories:</p>
                <pre className="bg-muted p-2 rounded text-xs font-mono">npx @lastest/runner repos</pre>
              </div>
              <p className="pt-1">
                Options: <code className="bg-muted px-1 py-0.5 rounded">-b, --base-url</code> override target URL, <code className="bg-muted px-1 py-0.5 rounded">-i, --interval</code> poll frequency (ms, default 5000)
              </p>
            </div>
          </details>
          </div>
        </CardContent>
      </Card>

      {/* Test Migration (Early Adopter) */}
      {earlyAdopterMode && teamRepos.length > 0 && (
        <div id="test-migration">
          <TestMigrationCard
            repositories={teamRepos.map(r => ({ id: r.id, fullName: r.fullName ?? `${r.owner}/${r.name}` }))}
            defaultRepositoryId={selectedRepo?.id}
          />
        </div>
      )}
    </div>
  ) : null;

  const accountTab = currentUser ? (
    <Card id="danger-zone" className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">Danger Zone</CardTitle>
        <CardDescription>
          Permanently delete your account and associated data. This cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-medium">Delete account</p>
          <p className="text-xs text-muted-foreground">
            You will need to type your{' '}
            {currentUser.name ? 'name' : 'email'} to confirm.
          </p>
        </div>
        <DeleteAccountDialog
          expectedConfirmation={(currentUser.name || currentUser.email).trim()}
        />
      </CardContent>
    </Card>
  ) : null;

  return (
    <div className="flex flex-col h-full">
      <div id="settings-scroll" className="flex-1 p-6 overflow-auto">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Status Messages */}
          {params.success === 'github_connected' && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700 dark:bg-green-950/30 dark:border-green-800 dark:text-green-400">
              <Check className="w-5 h-5" />
              GitHub account connected successfully!
            </div>
          )}
          {params.success === 'gitlab_connected' && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700 dark:bg-green-950/30 dark:border-green-800 dark:text-green-400">
              <Check className="w-5 h-5" />
              GitLab account connected successfully!
            </div>
          )}
          {params.success === 'google_sheets_connected' && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700">
              <Check className="w-5 h-5" />
              Google Sheets connected successfully!
            </div>
          )}
          {params.error && (
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-destructive">
              <X className="w-5 h-5" />
              Failed to connect GitHub: {params.error.replace(/_/g, ' ')}
            </div>
          )}

          {/* Highlight settings cards when navigated from onboarding */}
          <SettingsHighlighter />

          <SettingsTabs
            tabs={[
              { value: 'general', label: 'General', content: generalTab },
              { value: 'integrations', label: 'Integrations', content: integrationsTab },
              { value: 'cicd', label: 'CI/CD', content: cicdTab },
              { value: 'diff', label: 'Diff', content: diffTab },
              { value: 'playwright', label: 'Playwright', content: playwrightTab },
              { value: 'ai', label: 'AI', content: aiTab },
              { value: 'notifications', label: 'Notifications', content: notificationsTab },
              { value: 'team', label: 'Team', hidden: !teamTab, content: teamTab },
              { value: 'account', label: 'Account', hidden: !accountTab, content: accountTab },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
