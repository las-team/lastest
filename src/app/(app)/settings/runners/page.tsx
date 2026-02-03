import { redirect } from 'next/navigation';
import { requireTeamAdmin } from '@/lib/auth';
import { getRunners } from '@/server/actions/runners';
import { RunnerList } from '@/components/runners/runner-list';
import { CreateRunnerDialog } from '@/components/runners/create-runner-dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Bot, Terminal } from 'lucide-react';

export default async function RunnersPage() {
  let session;
  try {
    session = await requireTeamAdmin();
  } catch {
    redirect('/');
  }

  const runners = await getRunners();

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Remote Runners</h1>
              <p className="text-muted-foreground text-sm">
                Manage test execution runners for cloud deployment
              </p>
            </div>
            <CreateRunnerDialog />
          </div>

          {/* Runners List */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="w-5 h-5" />
                Runners ({runners.length})
              </CardTitle>
              <CardDescription>
                Runners run tests on your local machine and report results to the cloud
              </CardDescription>
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

          {/* Installation Instructions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Terminal className="w-5 h-5" />
                Installation
              </CardTitle>
              <CardDescription>
                How to set up a runner on your machine
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-medium mb-2">1. Install the runner package</h4>
                <pre className="bg-muted p-3 rounded-md text-sm overflow-x-auto">
                  <code>npm install -g @lastest2/runner</code>
                </pre>
              </div>

              <div>
                <h4 className="font-medium mb-2">2. Create a runner above and copy the token</h4>
                <p className="text-sm text-muted-foreground">
                  The token is only shown once when you create the runner. Keep it secure.
                </p>
              </div>

              <div>
                <h4 className="font-medium mb-2">3. Run the runner</h4>
                <pre className="bg-muted p-3 rounded-md text-sm overflow-x-auto">
                  <code>lastest2-runner --token YOUR_TOKEN --server {typeof window !== 'undefined' ? window.location.origin : 'https://your-app.vercel.app'}</code>
                </pre>
              </div>

              <div>
                <h4 className="font-medium mb-2">4. (Optional) Run as a background service</h4>
                <pre className="bg-muted p-3 rounded-md text-sm overflow-x-auto">
                  <code>{`# Using PM2
pm2 start lastest2-runner -- --token YOUR_TOKEN --server YOUR_SERVER

# Or using systemd (Linux)
# See documentation for systemd service file example`}</code>
                </pre>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
