'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { startGenerateTestAgent } from '@/server/actions/ai';
import { Switch } from '@/components/ui/switch';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { FunctionalArea } from '@/lib/db/schema';
import { track } from '@/lib/analytics/umami';
import { Events } from '@/lib/analytics/events';

interface AICreateTestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repositoryId: string;
  areas: FunctionalArea[];
}

export function AICreateTestDialog({
  open,
  onOpenChange,
  repositoryId,
  areas,
}: AICreateTestDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [testName, setTestName] = useState('');
  const [functionalAreaId, setFunctionalAreaId] = useState<string>('');
  const [headless, setHeadless] = useState(true);

  const handleSubmit = async () => {
    if (!prompt.trim()) {
      toast.error('Please enter a prompt');
      return;
    }

    const name = testName.trim() || prompt.slice(0, 50).replace(/[^a-zA-Z0-9\s]/g, '').trim() || 'AI Generated Test';

    setIsSubmitting(true);
    try {
      const result = await startGenerateTestAgent({
        repositoryId,
        userPrompt: prompt,
        targetUrl: targetUrl || undefined,
        testName: name,
        functionalAreaId: functionalAreaId && functionalAreaId !== '__none__' ? functionalAreaId : undefined,
        headless,
      });

      if (result.success) {
        track(Events.test_created, {
          source: 'ai',
          repoId: repositoryId,
          hasArea: functionalAreaId && functionalAreaId !== '__none__' ? 'true' : 'false',
          hasTargetUrl: targetUrl ? 'true' : 'false',
        });
        toast.success('Test generation started — check the activity feed for progress');
        handleClose();
      } else {
        toast.error(result.error || 'Failed to start test generation');
      }
    } catch (_error) {
      toast.error('Failed to start test generation');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setPrompt('');
    setTargetUrl('');
    setTestName('');
    setFunctionalAreaId('');
    setHeadless(true);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Create Test with AI
          </DialogTitle>
          <DialogDescription>
            Describe what you want to test. AI will explore the page via browser and generate test code with real selectors.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="prompt">Describe your test</Label>
            <Textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g., Test the login page - fill in email and password, submit the form, and verify the dashboard loads"
              rows={4}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="testName">Test Name (optional)</Label>
              <Input
                id="testName"
                value={testName}
                onChange={(e) => setTestName(e.target.value)}
                placeholder="Auto-generated from prompt"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="targetUrl">Target URL (optional)</Label>
              <Input
                id="targetUrl"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="e.g., /login"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            {areas.length > 0 && (
              <div className="flex-1 space-y-2">
                <Label>Functional Area</Label>
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

            <div className="flex items-center gap-2 pt-6">
              <Switch id="headless" checked={headless} onCheckedChange={setHeadless} />
              <Label htmlFor="headless" className="text-sm">Headless</Label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !prompt.trim()}>
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 mr-2" />
            )}
            Generate Test
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
