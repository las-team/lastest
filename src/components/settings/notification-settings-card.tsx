'use client';

import { useState, useTransition } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { saveNotificationSettings } from '@/server/actions/settings';
import type { NotificationSettings } from '@/lib/db/schema';
import { Loader2, Save, Bell, MessageSquare } from 'lucide-react';

interface NotificationSettingsCardProps {
  settings: NotificationSettings;
  repositoryId?: string | null;
  hasGithubAccount: boolean;
}

export function NotificationSettingsCard({
  settings,
  repositoryId,
  hasGithubAccount,
}: NotificationSettingsCardProps) {
  const [isPending, startTransition] = useTransition();
  const [slackWebhookUrl, setSlackWebhookUrl] = useState(settings.slackWebhookUrl || '');
  const [slackEnabled, setSlackEnabled] = useState(settings.slackEnabled || false);
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState(settings.discordWebhookUrl || '');
  const [discordEnabled, setDiscordEnabled] = useState(settings.discordEnabled || false);
  const [githubPrCommentsEnabled, setGithubPrCommentsEnabled] = useState(
    settings.githubPrCommentsEnabled || false
  );

  const handleSave = () => {
    startTransition(async () => {
      await saveNotificationSettings({
        repositoryId,
        slackWebhookUrl: slackWebhookUrl || null,
        slackEnabled,
        discordWebhookUrl: discordWebhookUrl || null,
        discordEnabled,
        githubPrCommentsEnabled,
      });
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="w-5 h-5" />
          Notifications
        </CardTitle>
        <CardDescription>
          Configure build completion notifications
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Slack Notifications */}
        <div className="space-y-4 p-4 border rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              <Label className="font-medium">Slack Notifications</Label>
            </div>
            <Switch
              checked={slackEnabled}
              onCheckedChange={setSlackEnabled}
            />
          </div>

          {slackEnabled && (
            <div className="space-y-2">
              <Label htmlFor="slackWebhookUrl">Webhook URL</Label>
              <Input
                id="slackWebhookUrl"
                type="url"
                placeholder="https://hooks.slack.com/services/..."
                value={slackWebhookUrl}
                onChange={(e) => setSlackWebhookUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Create an incoming webhook in your Slack workspace settings
              </p>
            </div>
          )}
        </div>

        {/* Discord Notifications */}
        <div className="space-y-4 p-4 border rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
              </svg>
              <Label className="font-medium">Discord Notifications</Label>
            </div>
            <Switch
              checked={discordEnabled}
              onCheckedChange={setDiscordEnabled}
            />
          </div>

          {discordEnabled && (
            <div className="space-y-2">
              <Label htmlFor="discordWebhookUrl">Webhook URL</Label>
              <Input
                id="discordWebhookUrl"
                type="url"
                placeholder="https://discord.com/api/webhooks/..."
                value={discordWebhookUrl}
                onChange={(e) => setDiscordWebhookUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Create a webhook in your Discord server settings: Server Settings → Integrations → Webhooks
              </p>
            </div>
          )}
        </div>

        {/* GitHub PR Comments */}
        <div className="space-y-4 p-4 border rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
              </svg>
              <Label className="font-medium">GitHub PR Comments</Label>
            </div>
            <Switch
              checked={githubPrCommentsEnabled}
              onCheckedChange={setGithubPrCommentsEnabled}
              disabled={!hasGithubAccount}
            />
          </div>

          {!hasGithubAccount && (
            <p className="text-xs text-amber-600">
              Connect your GitHub account in settings to enable PR comments
            </p>
          )}

          {hasGithubAccount && githubPrCommentsEnabled && (
            <p className="text-xs text-muted-foreground">
              Build results will be posted as comments on open PRs matching the build branch
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
