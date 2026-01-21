import { Header } from '@/components/layout/header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getGitInfo } from '@/lib/git/utils';
import * as queries from '@/lib/db/queries';
import { Github, Check, X, Database, ExternalLink } from 'lucide-react';
import { PlaywrightSettingsCard } from '@/components/settings/playwright-settings-card';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const gitInfo = await getGitInfo();
  const githubAccount = await queries.getGithubAccount();
  const selectedRepo = await queries.getSelectedRepository();
  const playwrightSettings = await queries.getPlaywrightSettings(selectedRepo?.id);

  return (
    <div className="flex flex-col h-full">
      <Header title="Settings" />

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

          {/* Git Info */}
          <Card>
            <CardHeader>
              <CardTitle>Repository</CardTitle>
              <CardDescription>
                Git repository information
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Branch</span>
                <Badge variant="outline">{gitInfo.branch}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Commit</span>
                <code className="text-sm">{gitInfo.commit}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <Badge variant={gitInfo.isClean ? 'default' : 'secondary'}>
                  {gitInfo.isClean ? 'Clean' : 'Uncommitted changes'}
                </Badge>
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

          {/* Playwright Config */}
          <PlaywrightSettingsCard
            settings={playwrightSettings}
            repositoryId={selectedRepo?.id}
          />

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
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
