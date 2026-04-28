'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { startGenerateTestAgent } from '@/server/actions/ai';
import { Compass, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { FunctionalArea } from '@/lib/db/schema';

interface ExploreUrlPanelProps {
  repositoryId: string | undefined;
  areas: FunctionalArea[];
  defaultBaseUrl: string;
}

export function ExploreUrlPanel({ repositoryId, areas, defaultBaseUrl }: ExploreUrlPanelProps) {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [targetUrl, setTargetUrl] = useState(defaultBaseUrl || '');
  const [testName, setTestName] = useState('');
  const [functionalAreaId, setFunctionalAreaId] = useState<string>('');
  const [headless, setHeadless] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!repositoryId) {
      toast.error('Select a repository first');
      return;
    }
    if (!prompt.trim()) {
      toast.error('Describe what you want to test');
      return;
    }

    const name =
      testName.trim() ||
      prompt.slice(0, 50).replace(/[^a-zA-Z0-9\s]/g, '').trim() ||
      'AI Generated Test';

    setIsSubmitting(true);
    try {
      const result = await startGenerateTestAgent({
        repositoryId,
        userPrompt: prompt,
        targetUrl: targetUrl.trim() || undefined,
        testName: name,
        functionalAreaId:
          functionalAreaId && functionalAreaId !== '__none__' ? functionalAreaId : undefined,
        headless,
      });

      if (result.success) {
        toast.success('Test generation started — check the activity feed for progress');
        router.push('/home');
      } else {
        toast.error(result.error || 'Failed to start test generation');
      }
    } catch {
      toast.error('Failed to start test generation');
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
              <Compass className="h-5 w-5" />
              Explore from URL
            </CardTitle>
            <CardDescription>
              Describe the flow and provide a target URL. The Generator agent opens a browser,
              explores the page, and writes test code with real selectors.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="explore-prompt">Describe your test</Label>
              <Textarea
                id="explore-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g., Test the login page — fill in email and password, submit the form, and verify the dashboard loads"
                rows={4}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="explore-name">Test name (optional)</Label>
                <Input
                  id="explore-name"
                  value={testName}
                  onChange={(e) => setTestName(e.target.value)}
                  placeholder="Auto-generated from prompt"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="explore-url">Target URL</Label>
                <Input
                  id="explore-url"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  placeholder="https://app.example.com/login"
                />
              </div>
            </div>

            <div className="flex items-end gap-4">
              {areas.length > 0 && (
                <div className="flex-1 space-y-2">
                  <Label>Functional area</Label>
                  <Select value={functionalAreaId} onValueChange={setFunctionalAreaId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select area (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {areas.map((area) => (
                        <SelectItem key={area.id} value={area.id}>
                          {area.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex items-center gap-2 pb-2">
                <Switch id="explore-headless" checked={headless} onCheckedChange={setHeadless} />
                <Label htmlFor="explore-headless" className="text-sm">
                  Headless
                </Label>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || !prompt.trim() || !repositoryId}
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                Generate test
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
