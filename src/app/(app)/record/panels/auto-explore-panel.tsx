'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Loader2, Telescope } from 'lucide-react';
import { toast } from 'sonner';
import { startAutoExploreFromUrl } from '@/server/actions/test-import';

interface AutoExplorePanelProps {
  repositoryId: string | undefined;
  defaultBaseUrl: string;
}

export function AutoExplorePanel({ repositoryId, defaultBaseUrl }: AutoExplorePanelProps) {
  const router = useRouter();
  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl || '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!repositoryId) {
      toast.error('Select a repository first');
      return;
    }
    if (!baseUrl.trim()) {
      toast.error('Enter a target URL');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await startAutoExploreFromUrl({ repositoryId, baseUrl });
      if (result.success) {
        toast.success('Auto-explore started — Planner is mapping the app');
        router.push('/home');
      } else {
        toast.error(result.error || 'Failed to start auto-explore');
      }
    } catch {
      toast.error('Failed to start auto-explore');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Telescope className="h-5 w-5" />
              Auto-Explore (Planner + Generator)
            </CardTitle>
            <CardDescription>
              Point the full agent pipeline at a URL. The Planner crawls routes and proposes
              functional areas; the Generator writes tests for each scenario; the Healer fixes
              failures. Progress streams to the activity feed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="auto-url">Target URL</Label>
              <Input
                id="auto-url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://app.example.com"
              />
              <p className="text-xs text-muted-foreground">
                Sets the repository&apos;s base URL and starts the Play Agent session.
              </p>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || !baseUrl.trim() || !repositoryId}
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Telescope className="h-4 w-4 mr-2" />
                )}
                Start auto-explore
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
