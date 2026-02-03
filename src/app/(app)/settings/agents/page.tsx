import { redirect } from 'next/navigation';
import { requireTeamAdmin } from '@/lib/auth';
import { getAgents } from '@/server/actions/agents';
import { AgentList } from '@/components/agents/agent-list';
import { CreateAgentDialog } from '@/components/agents/create-agent-dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Bot, Terminal } from 'lucide-react';

export default async function AgentsPage() {
  let session;
  try {
    session = await requireTeamAdmin();
  } catch {
    redirect('/');
  }

  const agents = await getAgents();

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Remote Agents</h1>
              <p className="text-muted-foreground text-sm">
                Manage test execution agents for cloud deployment
              </p>
            </div>
            <CreateAgentDialog />
          </div>

          {/* Agents List */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="w-5 h-5" />
                Agents ({agents.length})
              </CardTitle>
              <CardDescription>
                Agents run tests on your local machine and report results to the cloud
              </CardDescription>
            </CardHeader>
            <CardContent>
              {agents.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Bot className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p className="mb-2">No agents configured</p>
                  <p className="text-sm">Create an agent to enable remote test execution</p>
                </div>
              ) : (
                <AgentList agents={agents} />
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
                How to set up an agent on your machine
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-medium mb-2">1. Install the agent package</h4>
                <pre className="bg-muted p-3 rounded-md text-sm overflow-x-auto">
                  <code>npm install -g @lastest2/agent</code>
                </pre>
              </div>

              <div>
                <h4 className="font-medium mb-2">2. Create an agent above and copy the token</h4>
                <p className="text-sm text-muted-foreground">
                  The token is only shown once when you create the agent. Keep it secure.
                </p>
              </div>

              <div>
                <h4 className="font-medium mb-2">3. Run the agent</h4>
                <pre className="bg-muted p-3 rounded-md text-sm overflow-x-auto">
                  <code>lastest2-agent --token YOUR_TOKEN --server {typeof window !== 'undefined' ? window.location.origin : 'https://your-app.vercel.app'}</code>
                </pre>
              </div>

              <div>
                <h4 className="font-medium mb-2">4. (Optional) Run as a background service</h4>
                <pre className="bg-muted p-3 rounded-md text-sm overflow-x-auto">
                  <code>{`# Using PM2
pm2 start lastest2-agent -- --token YOUR_TOKEN --server YOUR_SERVER

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
