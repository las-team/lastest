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
import { AICodePreview } from './ai-code-preview';
import { aiFixTest, updateTestCode } from '@/server/actions/ai';
import { Loader2, Wrench, Save, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface AIFixTestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repositoryId: string;
  testId: string;
  testName: string;
  originalCode: string;
  errorMessage: string;
  onFixed?: () => void;
}

export function AIFixTestDialog({
  open,
  onOpenChange,
  repositoryId,
  testId,
  testName,
  originalCode,
  errorMessage,
  onFixed,
}: AIFixTestDialogProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [fixedCode, setFixedCode] = useState('');
  const [hasGenerated, setHasGenerated] = useState(false);

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const result = await aiFixTest(repositoryId, testId, errorMessage);

      if (result.success && result.code) {
        setFixedCode(result.code);
        setHasGenerated(true);
        toast.success('Fix generated successfully');
      } else {
        toast.error(result.error || 'Failed to generate fix');
      }
    } catch (error) {
      toast.error('Failed to generate fix');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const result = await updateTestCode(testId, fixedCode);

      if (result.success) {
        toast.success('Test code updated');
        onFixed?.();
        handleClose();
      } else {
        toast.error(result.error || 'Failed to save fix');
      }
    } catch (error) {
      toast.error('Failed to save fix');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    setFixedCode('');
    setHasGenerated(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Fix Test with AI
          </DialogTitle>
          <DialogDescription>
            AI will analyze the error and generate a fixed version of "{testName}"
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Error Message */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Error Message</label>
            <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg">
              <pre className="text-sm text-red-700 dark:text-red-300 whitespace-pre-wrap font-mono">
                {errorMessage}
              </pre>
            </div>
          </div>

          {/* Original Code (collapsed by default once fixed) */}
          {!hasGenerated && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Original Code</label>
              <AICodePreview code={originalCode} readOnly maxHeight="200px" />
            </div>
          )}

          {/* Fixed Code */}
          {hasGenerated && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Fixed Code</label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleGenerate}
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
                code={fixedCode}
                onChange={setFixedCode}
                readOnly={false}
                maxHeight="350px"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          {!hasGenerated ? (
            <Button onClick={handleGenerate} disabled={isGenerating}>
              {isGenerating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Wrench className="h-4 w-4 mr-2" />
              )}
              Generate Fix
            </Button>
          ) : (
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Fixed Code
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
