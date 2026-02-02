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
  const [githubPrCommentsEnabled, setGithubPrCommentsEnabled] = useState(
    settings.githubPrCommentsEnabled || false
  );

  const handleSave = () => {
    startTransition(async () => {
      await saveNotificationSettings({
        repositoryId,
        slackWebhookUrl: slackWebhookUrl || null,
        slackEnabled,
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
