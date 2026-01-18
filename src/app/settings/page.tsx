import { Header } from '@/components/layout/header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getGitInfo } from '@/lib/git/utils';

export default async function SettingsPage() {
  const gitInfo = await getGitInfo();

  return (
    <div className="flex flex-col h-full">
      <Header title="Settings" />

      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-2xl mx-auto space-y-6">
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
              <CardTitle>Database</CardTitle>
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
            </CardContent>
          </Card>

          {/* Playwright Config */}
          <Card>
            <CardHeader>
              <CardTitle>Playwright</CardTitle>
              <CardDescription>
                Browser automation settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Browser</span>
                <span>Chromium</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Viewport</span>
                <span>1280 x 720</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Screenshots</span>
                <code className="text-sm">./public/screenshots</code>
              </div>
            </CardContent>
          </Card>

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
