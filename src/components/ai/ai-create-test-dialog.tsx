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
import { AICodePreview } from './ai-code-preview';
import { aiCreateTest, saveGeneratedTest } from '@/server/actions/ai';
import { Loader2, Sparkles, Save, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { FunctionalArea } from '@/lib/db/schema';

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
  const [step, setStep] = useState<'prompt' | 'preview'>('prompt');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Prompt step state
  const [prompt, setPrompt] = useState('');
  const [targetUrl, setTargetUrl] = useState('');

  // Preview step state
  const [generatedCode, setGeneratedCode] = useState('');
  const [testName, setTestName] = useState('');
  const [functionalAreaId, setFunctionalAreaId] = useState<string>('');
  const [pathType, setPathType] = useState<'happy' | 'unhappy'>('happy');

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.error('Please enter a prompt');
      return;
    }

    setIsGenerating(true);
    try {
      const result = await aiCreateTest(repositoryId, {
        userPrompt: prompt,
        targetUrl: targetUrl || undefined,
      });

      if (result.success && result.code) {
        setGeneratedCode(result.code);
        // Generate a default test name from the prompt
        const defaultName = prompt.slice(0, 50).replace(/[^a-zA-Z0-9\s]/g, '').trim() || 'AI Generated Test';
        setTestName(defaultName);
        setStep('preview');
        toast.success('Test generated successfully');
      } else {
        toast.error(result.error || 'Failed to generate test');
      }
    } catch (error) {
      toast.error('Failed to generate test');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerate = async () => {
    setIsGenerating(true);
    try {
      const result = await aiCreateTest(repositoryId, {
        userPrompt: prompt,
        targetUrl: targetUrl || undefined,
      });

      if (result.success && result.code) {
        setGeneratedCode(result.code);
        toast.success('Test regenerated');
      } else {
        toast.error(result.error || 'Failed to regenerate test');
      }
    } catch (error) {
      toast.error('Failed to regenerate test');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!testName.trim()) {
      toast.error('Please enter a test name');
      return;
    }

    setIsSaving(true);
    try {
      const result = await saveGeneratedTest({
        repositoryId,
        functionalAreaId: functionalAreaId || undefined,
        name: testName.trim(),
        code: generatedCode,
        targetUrl: targetUrl || undefined,
        pathType,
      });

      if (result.success) {
        toast.success('Test saved successfully');
        handleClose();
      } else {
        toast.error(result.error || 'Failed to save test');
      }
    } catch (error) {
      toast.error('Failed to save test');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    setStep('prompt');
    setPrompt('');
    setTargetUrl('');
    setGeneratedCode('');
    setTestName('');
    setFunctionalAreaId('');
    setPathType('happy');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Create Test with AI
          </DialogTitle>
          <DialogDescription>
            {step === 'prompt'
              ? 'Describe what you want to test and AI will generate the code'
              : 'Review and edit the generated test code'}
          </DialogDescription>
        </DialogHeader>

        {step === 'prompt' ? (
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

            <div className="space-y-2">
              <Label htmlFor="targetUrl">Target URL (optional)</Label>
              <Input
                id="targetUrl"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="e.g., /login or http://localhost:3000/login"
              />
              <p className="text-xs text-muted-foreground">
                The page URL to test. Can be relative (starts with /) or absolute.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="testName">Test Name</Label>
                <Input
                  id="testName"
                  value={testName}
                  onChange={(e) => setTestName(e.target.value)}
                  placeholder="My Test"
                />
              </div>

              <div className="space-y-2">
                <Label>Functional Area</Label>
                <Select value={functionalAreaId} onValueChange={setFunctionalAreaId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select area (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {areas.map((area) => (
                      <SelectItem key={area.id} value={area.id}>
                        {area.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Path Type</Label>
              <Select value={pathType} onValueChange={(v) => setPathType(v as 'happy' | 'unhappy')}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="happy">Happy Path</SelectItem>
                  <SelectItem value="unhappy">Unhappy Path</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Generated Code</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRegenerate}
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Regenerate
                </Button>
              </div>
              <AICodePreview
                code={generatedCode}
                onChange={setGeneratedCode}
                readOnly={false}
                maxHeight="300px"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {step === 'prompt' ? (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleGenerate} disabled={isGenerating || !prompt.trim()}>
                {isGenerating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                Generate Test
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep('prompt')}>
                Back
              </Button>
              <Button onClick={handleSave} disabled={isSaving || !testName.trim()}>
                {isSaving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save Test
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
