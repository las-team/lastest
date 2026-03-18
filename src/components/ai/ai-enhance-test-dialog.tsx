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
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { AICodePreview } from './ai-code-preview';
import { aiEnhanceTest, updateTestCode } from '@/server/actions/ai';
import { Loader2, Wand2, Save, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface AIEnhanceTestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repositoryId: string;
  testId: string;
  testName: string;
  originalCode: string;
  onEnhanced?: () => void;
}

export function AIEnhanceTestDialog({
  open,
  onOpenChange,
  repositoryId,
  testId,
  testName,
  originalCode,
  onEnhanced,
}: AIEnhanceTestDialogProps) {
  const [step, setStep] = useState<'prompt' | 'preview'>('prompt');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [userPrompt, setUserPrompt] = useState('');
  const [enhancedCode, setEnhancedCode] = useState('');

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const result = await aiEnhanceTest(repositoryId, testId, userPrompt || undefined);

      if (result.success && result.code) {
        setEnhancedCode(result.code);
        setStep('preview');
        toast.success('Enhanced code generated');
      } else {
        toast.error(result.error || 'Failed to enhance test');
      }
    } catch (_error) {
      toast.error('Failed to enhance test');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerate = async () => {
    setIsGenerating(true);
    try {
      const result = await aiEnhanceTest(repositoryId, testId, userPrompt || undefined);

      if (result.success && result.code) {
        setEnhancedCode(result.code);
        toast.success('Code regenerated');
      } else {
        toast.error(result.error || 'Failed to regenerate');
      }
    } catch (_error) {
      toast.error('Failed to regenerate');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const result = await updateTestCode(testId, enhancedCode);

      if (result.success) {
        toast.success('Test code updated');
        onEnhanced?.();
        handleClose();
      } else {
        toast.error(result.error || 'Failed to save');
      }
    } catch (_error) {
      toast.error('Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    setStep('prompt');
    setUserPrompt('');
    setEnhancedCode('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5" />
            Enhance Test with AI
          </DialogTitle>
          <DialogDescription>
            {step === 'prompt'
              ? `Improve "${testName}" with additional assertions, better selectors, and edge case handling`
              : 'Review and edit the enhanced code'}
          </DialogDescription>
        </DialogHeader>

        {step === 'prompt' ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Current Code</Label>
              <AICodePreview code={originalCode} readOnly maxHeight="200px" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prompt">Enhancement Instructions (Optional)</Label>
              <Textarea
                id="prompt"
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                placeholder="e.g., Add more assertions for form validation, test error states, improve wait conditions..."
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                Leave empty for general improvements (more assertions, better waits, edge cases)
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Enhanced Code</Label>
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
                code={enhancedCode}
                onChange={setEnhancedCode}
                readOnly={false}
                maxHeight="400px"
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
              <Button onClick={handleGenerate} disabled={isGenerating}>
                {isGenerating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4 mr-2" />
                )}
                Enhance Test
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep('prompt')}>
                Back
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save Enhanced Code
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
