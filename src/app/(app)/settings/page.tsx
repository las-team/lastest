import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import * as queries from "@/lib/db/queries";
import { getCurrentSession } from "@/lib/auth";
import { Github, Check, X, Users, Bot, Mail, Terminal } from "lucide-react";

// GitLab icon SVG component
function GitLabIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M4.845.904c-.435 0-.82.28-.955.692C2.639 5.449 1.246 9.728.07 13.335a1.437 1.437 0 00.522 1.607l11.071 8.045c.2.145.472.144.67-.004l11.073-8.04a1.436 1.436 0 00.522-1.61c-1.285-3.942-2.683-8.256-3.817-11.746a1.004 1.004 0 00-.957-.684.987.987 0 00-.949.69l-2.405 7.408H8.203l-2.41-7.408a.987.987 0 00-.942-.69h-.006z" />
    </svg>
  );
}
import { PlaywrightSettingsCard } from "@/components/settings/playwright-settings-card";
import { DiffSensitivityCard } from "@/components/settings/diff-sensitivity-card";
import { AISettingsCard } from "@/components/settings/ai-settings-card";
import { AiAdvancedSettings } from "@/components/settings/ai-advanced-settings";
import { McpConnect } from "@/components/mcp/mcp-connect";
import { McpPromptHints } from "@/components/mcp/mcp-prompt-hints";
import { McpStatusBadge } from "@/components/mcp/mcp-status-badge";
import { isByokConfigured } from "@/lib/ai/availability";
import { getAISettings as getMaskedAISettings } from "@/server/actions/ai-settings";
import { AILogsCard } from "@/components/settings/ai-logs-card";
import { NotificationSettingsCard } from "@/components/settings/notification-settings-card";
import { ResetSetupGuide } from "@/components/setup-guide/reset-setup-guide";
import { SettingsHighlighter } from "@/components/settings/settings-highlighter";
import { BranchSelector } from "@/components/settings/branch-selector";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { UserList } from "@/components/users/user-list";
import { PendingInvitations } from "@/components/users/pending-invitations";
import { InviteUserDialog } from "@/components/users/invite-user-dialog";
import { RunnerList } from "@/components/runners/runner-list";
import { CreateRunnerDialog } from "@/components/runners/create-runner-dialog";
import { getRunners, getSystemRunners } from "@/server/actions/runners";
import { listSystemEmbeddedSessions } from "@/server/actions/embedded-sessions";
import { listApiTokens } from "@/server/actions/api-tokens";
import { ApiTokensSection } from "@/components/api-tokens/api-tokens-section";
import { GoogleSheetsSettingsCard } from "@/components/settings/google-sheets-settings-card";
import { TestingTemplateSelector } from "@/components/settings/testing-template-selector";
import { AutoApproveToggle } from "@/components/settings/auto-approve-toggle";
import { EarlyAdopterToggle } from "@/components/settings/early-adopter-toggle";
import { QuickstartEmailTemplateInput } from "@/components/settings/quickstart-email-template-input";
import { BanAiModeToggle } from "@/components/settings/ban-ai-mode-toggle";
import { AiModeToggle } from "@/components/settings/ai-mode-toggle";
import { GamificationToggle } from "@/components/settings/gamification-toggle";
import { VerifyPhaseToggle } from "@/components/settings/verify-phase-toggle";
import { GamificationAdminCard } from "@/components/settings/gamification-admin-card";
import {
  ConnectGithubButton,
  ReconnectGithubLink,
} from "@/components/settings/connect-github-button";
import { GithubActionsCard } from "@/components/settings/github-actions-card-client";
import { VercelCard } from "@/components/settings/vercel/vercel-card-client";
import { ConnectGitlabButton } from "@/components/settings/connect-gitlab-button";
import { GitlabPipelinesCard } from "@/components/settings/gitlab-pipelines-card-client";
import { ScheduleManagerCard } from "@/components/settings/schedule-manager-client";
import { DiagramThumbnail } from "@/components/ui/diagram-thumbnail";
import { TestMigrationCard } from "@/components/settings/test-migration-card";
import { EmailPreferencesCard } from "@/components/settings/email-preferences-client";
import { StorageUsageCard } from "@/components/settings/storage-usage-card-client";
import { RunUsageCard } from "@/components/settings/run-usage-card-client";
import { RunUsageAnalyticsCard } from "@/components/settings/run-usage-analytics-card-client";
import { computeRunUsageProjection } from "@/lib/billing/run-usage";
import { BillingCard } from "@/components/settings/billing-card-client";
import { isStripeConfigured, getStripeClient } from "@/lib/billing/stripe";
import { getCatalog, toUiCatalog } from "@/lib/billing/catalog";
import { DeleteAccountDialog } from "@/components/settings/delete-account-dialog";
import { DeleteRepoDialog } from "@/components/settings/delete-repo-dialog";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    success?: string;
    error?: string;
    checkout?: string;
    billing?: string;
  }>;
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
  const [
    githubActionConfigs,
    gitlabPipelineConfigs,
    teamRepos,
    runners,
    sysRunners,
  ] = await Promise.all([
    teamId ? queries.getGithubActionConfigs(teamId) : [],
    teamId ? queries.getGitlabPipelineConfigs(teamId) : [],
    teamId ? queries.getRepositoriesByTeam(teamId) : [],
    getRunners(),
    getSystemRunners(),
  ]);
  const [vercelAccount, vercelConfigs] = await Promise.all([
    teamId ? queries.getVercelAccountByTeam(teamId) : null,
    teamId ? queries.getVercelProjectConfigs(teamId) : [],
  ]);
  const [apiTokens, systemEBSessions] = await Promise.all([
    listApiTokens(),
    listSystemEmbeddedSessions(),
  ]);
  const playwrightSettings = await queries.getPlaywrightSettings(
    selectedRepo?.id,
  );
  const diffSensitivitySettings = await queries.getDiffSensitivitySettings(
    selectedRepo?.id,
  );
  // Masked: API-key columns are redacted before reaching the client component
  // (raw keys must never be serialized into the page payload).
  const aiSettings = await getMaskedAISettings(selectedRepo?.id);
  // In-product AI ("agent functions") is only surfaced when BYOK is configured;
  // otherwise the panel steers users to drive Lastest from their own MCP agent.
  // `aiSettings` is masked, but masked-empty keys are null, so this check holds.
  const byokConfigured = isByokConfigured(aiSettings);
  const aiLogs = await queries.getAIPromptLogs(selectedRepo?.id, 50);
  const notificationSettings = await queries.getNotificationSettings(
    selectedRepo?.id,
  );
  const googleSheetsAccount = currentUser?.teamId
    ? await queries.getGoogleSheetsAccount(currentUser.teamId)
    : null;
  const googleSheetsDataSources = await queries.getGoogleSheetsDataSources(
    selectedRepo?.id,
  );

  // Fetch admin-only data
  const isAdmin =
    currentUser?.role === "admin" || currentUser?.role === "owner";
  const [teamMembers, pendingInvitations] =
    isAdmin && currentUser?.teamId
      ? await Promise.all([
          queries.getTeamMembers(currentUser.teamId),
          queries.getPendingInvitationsByTeam(currentUser.teamId),
        ])
      : [[], []];

  // Gamification admin data
  const [activeGamificationSeason, activeBugBlitz] =
    session?.team?.gamificationEnabled && teamId
      ? await Promise.all([
          queries.getActiveSeason(teamId),
          queries.getActiveBugBlitz(teamId),
        ])
      : [null, null];

  const storageUsage = teamId
    ? await queries.getTeamStorageUsage(teamId)
    : null;
  const runUsage = teamId ? await queries.getTeamRunUsage(teamId) : null;
  const runAnalytics = teamId
    ? await queries.getTeamRunUsageAnalytics(teamId)
    : null;
  const teamBilling = teamId ? await queries.getTeamBilling(teamId) : null;
  const stripeConfigured = isStripeConfigured();
  const billingCatalog = teamBilling ? toUiCatalog(await getCatalog()) : [];

  // Returning from the Stripe portal cancel flow: the return URL carries
  // billing=cancel_pending whether or not the user confirmed inside the
  // portal, and the webhook that mirrors the result may not have landed
  // yet. Read the subscription live so the banner + card never lie in
  // either direction (false "cancellation scheduled" / false "no changes").
  let cancelAtPeriodEnd = Boolean(teamBilling?.subscriptionCancelAtPeriodEnd);
  let billingPeriodEnd = teamBilling?.subscriptionCurrentPeriodEnd ?? null;
  if (
    params.billing === "cancel_pending" &&
    teamBilling?.stripeSubscriptionId
  ) {
    const stripe = getStripeClient();
    if (stripe) {
      try {
        const sub = await stripe.subscriptions.retrieve(
          teamBilling.stripeSubscriptionId,
        );
        // Portal cancels schedule via `cancel_at` (timestamp); API/flag
        // cancels via `cancel_at_period_end` — either means cancelled.
        cancelAtPeriodEnd = sub.cancel_at_period_end || sub.cancel_at != null;
        const periodEnd =
          sub.cancel_at ?? sub.items?.data?.[0]?.current_period_end;
        if (periodEnd) billingPeriodEnd = new Date(periodEnd * 1000);
      } catch {
        // Keep the DB mirror on transient Stripe errors.
      }
    }
  }
  const enforcementEnabled = process.env.ENFORCE_STORAGE_LIMITS === "true";
  const runEnforcementEnabled = process.env.ENFORCE_RUN_LIMITS === "true";

  const serverUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const earlyAdopterMode = session?.team?.earlyAdopterMode ?? false;
  const banAiMode = session?.team?.banAiMode ?? false;
  const builtInAiEnabled = session?.team?.builtInAiEnabled ?? false;

  const generalTab = (
    <>
      {/* Repository Info */}
      <Card id="repository">
        <CardHeader>
          <CardTitle>Repository</CardTitle>
          <CardDescription>Selected repository information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Repository</span>
            <span className="font-medium">
              {selectedRepo?.fullName || "None selected"}
            </span>
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
            <code className="text-sm">
              {selectedRepo?.defaultBranch || "-"}
            </code>
          </div>
          {selectedRepo && (
            <AutoApproveToggle
              repositoryId={selectedRepo.id}
              enabled={selectedRepo.autoApproveDefaultBranch ?? false}
              defaultBranch={selectedRepo.defaultBranch || "main"}
            />
          )}
        </CardContent>
      </Card>

      {/* Features */}
      <Card id="features">
        <CardHeader>
          <CardTitle>Features</CardTitle>
          <CardDescription>Toggle experimental features</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <EarlyAdopterToggle
            enabled={session?.team?.earlyAdopterMode ?? false}
          />
          {earlyAdopterMode && (
            <QuickstartEmailTemplateInput
              initial={
                session?.team?.quickstartEmailTemplate ??
                "viktor+{slug}{stamp}@lastest.cloud"
              }
            />
          )}
          <GamificationToggle
            enabled={session?.team?.gamificationEnabled ?? false}
          />
          <VerifyPhaseToggle
            enabled={session?.team?.verifyPhaseEnabled ?? false}
          />
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

      {/* Version */}
      <Card id="about">
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Version</span>
            <span className="font-mono">
              0.1.{process.env.NEXT_PUBLIC_GIT_COMMIT_COUNT ?? "0"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Commit</span>
            <span className="font-mono text-xs">
              {process.env.NEXT_PUBLIC_GIT_HASH ?? "dev"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Built</span>
            <span>{process.env.NEXT_PUBLIC_BUILD_DATE ?? "unknown"}</span>
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

      {/* Danger Zone — delete the selected repository and all its Lastest data */}
      {selectedRepo && (
        <Card id="repo-danger-zone" className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">Danger Zone</CardTitle>
            <CardDescription>
              {selectedRepo.provider === "local"
                ? "Permanently delete this repository and everything attached to it."
                : `Remove Lastest's data for this repository. Your ${
                    selectedRepo.provider === "gitlab" ? "GitLab" : "GitHub"
                  } repository will not be affected.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">Delete repository</p>
              <p className="text-xs text-muted-foreground">
                You will need to type{" "}
                <span className="font-mono">{selectedRepo.fullName}</span> to
                confirm.
              </p>
            </div>
            <DeleteRepoDialog
              repoId={selectedRepo.id}
              fullName={selectedRepo.fullName}
              provider={selectedRepo.provider ?? "github"}
            />
          </CardContent>
        </Card>
      )}
    </>
  );

  const integrationsTab = (
    <>
      {/* Scheduled Runs */}
      {selectedRepo && (
        <div id="schedules">
          <ScheduleManagerCard repositoryId={selectedRepo.id} />
        </div>
      )}

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
                    <div className="font-medium">
                      @{githubAccount.githubUsername}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Connected
                    </div>
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
                    <div className="font-medium">
                      @{gitlabAccount.gitlabUsername}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {gitlabAccount.instanceUrl === "https://gitlab.com"
                        ? "Connected"
                        : gitlabAccount.instanceUrl}
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
                Connect your GitLab account to link builds with merge requests.
                Self-hosted instances supported via PAT or per-account OAuth.
              </p>
              <ConnectGitlabButton />
            </>
          )}
        </CardContent>
      </Card>

      {/* Google Sheets Test Data */}
      <div id="google-sheets">
        <GoogleSheetsSettingsCard
          account={
            googleSheetsAccount
              ? {
                  id: googleSheetsAccount.id,
                  googleEmail: googleSheetsAccount.googleEmail,
                  googleName: googleSheetsAccount.googleName,
                }
              : null
          }
          dataSources={googleSheetsDataSources}
          repositoryId={selectedRepo?.id}
        />
      </div>

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

      {/* Vercel Marketplace (native Checks) */}
      <div id="vercel">
        <VercelCard
          account={
            vercelAccount
              ? {
                  vercelTeamId: vercelAccount.vercelTeamId,
                  vercelUserId: vercelAccount.vercelUserId,
                }
              : null
          }
          configs={vercelConfigs}
          repos={teamRepos}
        />
      </div>
    </>
  );

  const testingTab = (
    <>
      <div id="diff-sensitivity">
        <DiffSensitivityCard
          settings={diffSensitivitySettings}
          repositoryId={selectedRepo?.id}
        />
      </div>
      {selectedRepo && (
        <Card id="testing-template">
          <CardHeader>
            <CardTitle>Testing Template</CardTitle>
            <CardDescription>
              Apply a preset that configures Playwright and diff sensitivity for
              a common app style.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">
              Active template
            </span>
            <TestingTemplateSelector
              repositoryId={selectedRepo.id}
              currentTemplate={selectedRepo.testingTemplate}
            />
          </CardContent>
        </Card>
      )}
      <div id="playwright">
        <PlaywrightSettingsCard
          settings={playwrightSettings}
          repositoryId={selectedRepo?.id}
          hideSelectorPriority
        />
      </div>
    </>
  );

  const aiTab = (
    <>
      <Card id="ban-ai">
        <CardHeader>
          <CardTitle>AI access</CardTitle>
          <CardDescription>
            Disable to hide all AI and GenAI features from this team.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BanAiModeToggle enabled={banAiMode} />
        </CardContent>
      </Card>

      {banAiMode ? (
        <Card>
          <CardHeader>
            <CardTitle>AI disabled</CardTitle>
            <CardDescription>
              AI features are turned off for this team. Toggle Ban AI Mode above
              to re-enable AI settings and logs.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          {/* Dedicated AI-mode switch — the single gate for in-product +
           *  background AI. Default MCP; flip to built-in AI to run server-side. */}
          <Card id="ai-mode">
            <CardHeader>
              <CardTitle>AI mode</CardTitle>
              <CardDescription>
                MCP mode (default) keeps AI out of the product so you drive it
                from your own agent. Built-in AI runs AI server-side using the
                provider configured under Advanced.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <AiModeToggle enabled={builtInAiEnabled} />
              {builtInAiEnabled && !byokConfigured && (
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  Built-in AI is on, but no AI provider is configured. Set one
                  up under Advanced below or AI features will not run.
                </p>
              )}
            </CardContent>
          </Card>

          {/* MCP-first: the promoted way to get AI in Lastest. */}
          <Card id="mcp-connect">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Connect your AI agent
                <Badge variant="default">Recommended</Badge>
                <McpStatusBadge className="ml-auto" />
              </CardTitle>
              <CardDescription>
                Drive Lastest from Claude Code, Cursor, or any MCP client using
                your own model — no API keys stored here.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <McpConnect serverUrl={serverUrl} />
            </CardContent>
          </Card>

          {builtInAiEnabled ? (
            // Built-in AI is on → in-product agent functions are live; show logs.
            <div id="ai-logs">
              <AILogsCard logs={aiLogs} repositoryId={selectedRepo?.id} />
            </div>
          ) : (
            // No BYOK → no in-product agent functions; offer MCP prompts instead.
            <Card id="mcp-prompts">
              <CardHeader>
                <CardTitle>Run agent functions from your client</CardTitle>
                <CardDescription>
                  In-product AI is off. Paste any of these into your connected
                  agent to generate, heal, review, or triage.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <McpPromptHints repositoryId={selectedRepo?.id} />
              </CardContent>
            </Card>
          )}

          {/* BYOK provider config, demoted under an Advanced disclosure. */}
          <AiAdvancedSettings defaultOpen={builtInAiEnabled}>
            <div id="ai-settings">
              <AISettingsCard
                settings={aiSettings}
                repositoryId={selectedRepo?.id}
              />
            </div>
          </AiAdvancedSettings>
        </>
      )}
    </>
  );

  const teamSection = currentUser?.teamId ? (
    <div id="team" className="space-y-6">
      {/* Storage Usage — visible to all team members */}
      {storageUsage && (
        <div id="storage">
          <StorageUsageCard
            usedBytes={storageUsage.storageUsedBytes}
            quotaBytes={storageUsage.storageQuotaBytes}
            lastCalculatedAt={
              storageUsage.storageLastCalculatedAt?.toISOString() ?? null
            }
            isAdmin={isAdmin}
            enforcementEnabled={enforcementEnabled}
          />
        </div>
      )}

      {/* Monthly Run Usage — visible to all team members */}
      {runUsage && (
        <div id="run-usage">
          <RunUsageCard
            runsThisMonth={runUsage.runsThisMonth}
            monthlyRunQuota={runUsage.monthlyRunQuota}
            runMinutesThisMonth={runUsage.runMinutesThisMonth}
            usageMonth={runUsage.usageMonth ?? ""}
            lastCalculatedAt={
              runUsage.runUsageLastCalculatedAt?.toISOString() ?? null
            }
            enforcementEnabled={runEnforcementEnabled}
          />
        </div>
      )}

      {/* Run usage analytics — per-project / per-test run-minute breakdown */}
      {runUsage && runAnalytics && (
        <div id="run-usage-analytics">
          <RunUsageAnalyticsCard
            analytics={runAnalytics}
            projection={computeRunUsageProjection(
              runUsage.runMinutesThisMonth,
              runUsage.monthlyRunQuota,
            )}
          />
        </div>
      )}

      {/* Pending Invitations */}
      {isAdmin && pendingInvitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5" />
              Pending Invitations
            </CardTitle>
            <CardDescription>Invitations awaiting acceptance</CardDescription>
          </CardHeader>
          <CardContent>
            <PendingInvitations invitations={pendingInvitations} />
          </CardContent>
        </Card>
      )}

      {/* Billing — plan + checkout + cancel (admin-only) */}
      {isAdmin && teamBilling && (
        <div id="billing" className="space-y-2">
          {params.checkout === "success" && (
            <div className="rounded-md border border-green-500/40 bg-green-500/5 p-4 text-sm">
              Subscription updated. It may take a moment for the new plan to
              appear here while Stripe sends the webhook.
            </div>
          )}
          {params.billing === "plan_changed" && (
            <div className="rounded-md border border-green-500/40 bg-green-500/5 p-4 text-sm">
              Plan changed. Stripe will prorate the difference on your next
              invoice.
            </div>
          )}
          {params.billing === "downgrade_scheduled" && (
            <div className="rounded-md border border-green-500/40 bg-green-500/5 p-4 text-sm">
              Downgrade scheduled — your current plan stays active until the end
              of the billing period, then the new plan takes over. Nothing is
              charged today.
            </div>
          )}
          {/* State-aware: cancelAtPeriodEnd/billingPeriodEnd are read live
              from Stripe on this param (see above), so this never claims a
              cancellation that didn't happen — or misses one that did. */}
          {params.billing === "cancel_pending" &&
            (cancelAtPeriodEnd ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
                Cancellation scheduled — your plan stays active until{" "}
                {billingPeriodEnd
                  ? billingPeriodEnd.toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })
                  : "the end of the billing period"}
                .
              </div>
            ) : (
              <div className="rounded-md border bg-muted/50 p-4 text-sm">
                No changes made — your subscription is still active.
              </div>
            ))}
          {(params.billing === "error" || params.checkout === "cancelled") && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
              {params.checkout === "cancelled"
                ? "Checkout cancelled."
                : "Something went wrong with the billing change. Please try again or contact support."}
            </div>
          )}
          <BillingCard
            plan={teamBilling.plan}
            catalog={billingCatalog}
            subscriptionStatus={teamBilling.subscriptionStatus}
            currentPeriodEnd={billingPeriodEnd?.toISOString() ?? null}
            cancelAtPeriodEnd={cancelAtPeriodEnd}
            pendingPlanChange={Boolean(teamBilling.subscriptionScheduleId)}
            currentBillingInterval={teamBilling.billingInterval}
            isAdmin={isAdmin}
            stripeConfigured={stripeConfigured}
          />
        </div>
      )}

      {/* Team Members (admin-only) */}
      {isAdmin && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                Team Members ({teamMembers.length})
              </CardTitle>
              <CardDescription>Manage members of your team</CardDescription>
            </div>
            <InviteUserDialog />
          </CardHeader>
          <CardContent>
            <UserList users={teamMembers} currentUserId={currentUser.id} />
          </CardContent>
        </Card>
      )}

      {/* Runners & API Access (admin-only) */}
      {isAdmin && (
        <Card id="runners">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Bot className="w-5 h-5" />
                Runners & API Access
              </CardTitle>
              <CardDescription>
                Local/remote runners that execute tests, plus API keys for the
                MCP server, VS Code extension, and scripts.
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
                <p className="text-xs text-muted-foreground">
                  CLI agents and embedded browsers that run tests on your
                  machines.
                </p>
              </div>
              {runners.length === 0 && sysRunners.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground">
                  <Bot className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p className="mb-1">No runners configured</p>
                  <p className="text-sm">
                    Create a runner above to get a token, then start it with the
                    CLI.
                  </p>
                </div>
              ) : (
                <RunnerList
                  runners={runners}
                  systemRunners={sysRunners}
                  systemSessions={systemEBSessions}
                />
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
                    <p className="font-medium mb-1">
                      1. Create an embedded browser above to get a token, then
                      start the container:
                    </p>
                    <pre className="bg-muted p-2 rounded text-xs font-mono whitespace-pre-wrap break-all">{`docker run -d --name lastest-eb \\
  -e LASTEST_TOKEN=YOUR_TOKEN \\
  -e LASTEST_URL=${serverUrl} \\
  -p 9223:9223 -p 9224:9224 \\
  ewyc/lastest-eb:latest`}</pre>
                    <p className="text-[11px] mt-1 opacity-75">
                      It registers over WebSocket and executes tests for your
                      team — no local Playwright install needed.
                    </p>
                  </div>
                  <div>
                    <p className="font-medium mb-1">Trigger builds from CI:</p>
                    <pre className="bg-muted p-2 rounded text-xs font-mono">{`npx @lastest/runner trigger -r owner/repo -t YOUR_TOKEN -s ${serverUrl} --branch main`}</pre>
                    <p className="text-[11px] mt-1 opacity-75">
                      Creates a build on the server (executed by your registered
                      embedded browsers) and waits for results. Options:{" "}
                      <code className="bg-muted px-1 py-0.5 rounded">
                        --timeout
                      </code>{" "}
                      ms,{" "}
                      <code className="bg-muted px-1 py-0.5 rounded">
                        --commit
                      </code>{" "}
                      SHA,{" "}
                      <code className="bg-muted px-1 py-0.5 rounded">
                        --target-url
                      </code>{" "}
                      override,{" "}
                      <code className="bg-muted px-1 py-0.5 rounded">
                        --fail-on-changes
                      </code>
                    </p>
                  </div>
                  <div>
                    <p className="font-medium mb-1">
                      List available repositories:
                    </p>
                    <pre className="bg-muted p-2 rounded text-xs font-mono">
                      npx @lastest/runner repos -t YOUR_TOKEN -s {serverUrl}
                    </pre>
                  </div>
                </div>
              </details>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Test Migration (Early Adopter, admin-only) */}
      {isAdmin && earlyAdopterMode && teamRepos.length > 0 && (
        <div id="test-migration">
          <TestMigrationCard
            repositories={teamRepos.map((r) => ({
              id: r.id,
              fullName: r.fullName ?? `${r.owner}/${r.name}`,
            }))}
            defaultRepositoryId={selectedRepo?.id}
          />
        </div>
      )}
    </div>
  ) : null;

  const dangerZoneSection = currentUser ? (
    <Card id="danger-zone" className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">Danger Zone</CardTitle>
        <CardDescription>
          Permanently delete your account and associated data. This cannot be
          undone.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-medium">Delete account</p>
          <p className="text-xs text-muted-foreground">
            You will need to type your {currentUser.name ? "name" : "email"} to
            confirm.
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
          {params.success === "github_connected" && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700 dark:bg-green-950/30 dark:border-green-800 dark:text-green-400">
              <Check className="w-5 h-5" />
              GitHub account connected successfully!
            </div>
          )}
          {params.success === "gitlab_connected" && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700 dark:bg-green-950/30 dark:border-green-800 dark:text-green-400">
              <Check className="w-5 h-5" />
              GitLab account connected successfully!
            </div>
          )}
          {params.success === "google_sheets_connected" && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700">
              <Check className="w-5 h-5" />
              Google Sheets connected successfully!
            </div>
          )}
          {params.success === "vercel_connected" && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700 dark:bg-green-950/30 dark:border-green-800 dark:text-green-400">
              <Check className="w-5 h-5" />
              Vercel connected successfully! Map a project below.
            </div>
          )}
          {params.error && (
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-destructive">
              <X className="w-5 h-5" />
              Connection failed: {params.error.replace(/_/g, " ")}
            </div>
          )}

          {/* Highlight settings cards when navigated from onboarding */}
          <SettingsHighlighter />

          <SettingsTabs
            tabs={[
              { value: "general", label: "General", content: generalTab },
              {
                value: "integrations",
                label: "Integrations",
                content: integrationsTab,
              },
              { value: "testing", label: "Testing", content: testingTab },
              { value: "ai", label: "AI", content: aiTab },
              {
                value: "account",
                label: "Account",
                hidden: !currentUser,
                content: (
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
                    {teamSection}
                    {dangerZoneSection}
                  </>
                ),
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
