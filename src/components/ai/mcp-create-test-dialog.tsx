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
import { ScrollArea } from '@/components/ui/scroll-area';
import { AICodePreview } from './ai-code-preview';
import { aiCreateTest, saveGeneratedTest } from '@/server/actions/ai';
import { mcpValidateTest } from '@/server/actions/ai-mcp';
import { Switch } from '@/components/ui/switch';
import { Loader2, Wand2, Save, RefreshCw, CheckCircle2, XCircle, Zap } from 'lucide-react';
import { toast } from 'sonner';
import type { FunctionalArea } from '@/lib/db/schema';

interface ValidationResult {
  selector: string;
  valid: boolean;
  matchCount?: number;
  error?: string;
}

interface MCPCreateTestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repositoryId: string;
  areas: FunctionalArea[];
  baseUrl: string;
}

export function MCPCreateTestDialog({
  open,
  onOpenChange,
  repositoryId,
  areas,
  baseUrl,
}: MCPCreateTestDialogProps) {
  const [step, setStep] = useState<'prompt' | 'validating' | 'preview'>('prompt');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Prompt step state
  const [prompt, setPrompt] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [useMCP, setUseMCP] = useState(false);

  // Preview step state
  const [generatedCode, setGeneratedCode] = useState('');
  const [testName, setTestName] = useState('');
  const [functionalAreaId, setFunctionalAreaId] = useState<string>('');
  const [validationResults, setValidationResults] = useState<ValidationResult[]>([]);
  const [iterationCount, setIterationCount] = useState(0);
  const [maxIterations, setMaxIterations] = useState(1);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.error('Please enter a prompt');
      return;
    }

    setIsGenerating(true);
    setIterationCount(0);

    try {
      const result = await aiCreateTest(repositoryId, {
        userPrompt: prompt,
        targetUrl: targetUrl || undefined,
        useMCP,
      });

      if (result.success && result.code) {
        setGeneratedCode(result.code);
        const defaultName = prompt.slice(0, 50).replace(/[^a-zA-Z0-9\s]/g, '').trim() || 'AI Generated Test';
        setTestName(defaultName);

        // Validate the generated code
        await validateCode(result.code);
      } else {
        toast.error(result.error || 'Failed to generate test');
        setStep('prompt');
      }
    } catch (_error) {
      toast.error('Failed to generate test');
      setStep('prompt');
    } finally {
      setIsGenerating(false);
    }
  };

  const validateCode = async (code: string, currentIteration = 0) => {
    setIsValidating(true);
    setStep('validating');

    try {
      const fullUrl = targetUrl.startsWith('http')
        ? targetUrl
        : `${baseUrl}${targetUrl.startsWith('/') ? '' : '/'}${targetUrl}`;

      const result = await mcpValidateTest(code, fullUrl);

      if (result.success) {
        setValidationResults(result.results || []);
        setGeneratedCode(code);

        if (result.valid) {
          toast.success('All selectors validated');
          await autoSaveTest(code);
        } else {
          // Check if we can auto-fix
          const hasInvalid = result.results?.some((r) => !r.valid);
          if (hasInvalid && currentIteration < maxIterations) {
            await handleAutoFix(code, result.results || [], currentIteration);
          } else {
            if (currentIteration >= maxIterations) {
              toast.warning('Max iterations reached. Saving with current selectors.');
            }
            await autoSaveTest(code);
          }
        }
      } else {
        toast.error(result.error || 'Validation failed');
        setStep('preview');
      }
    } catch (_error) {
      toast.error('Validation failed');
      setStep('preview');
    } finally {
      setIsValidating(false);
    }
  };

  const handleAutoFix = async (code: string, results: ValidationResult[], currentIteration: number) => {
    const nextIteration = currentIteration + 1;
    setIterationCount(nextIteration);
    setIsGenerating(true);

    const invalidSelectors = results
      .filter((r) => !r.valid)
      .map((r) => `"${r.selector}": ${r.error || 'No matching elements'}`)
      .join('\n');

    try {
      const fixPrompt = `${prompt}\n\nThe following selectors in your previous code are invalid:\n${invalidSelectors}\n\nPlease regenerate the test with valid selectors. Use more robust selectors like data-testid, aria-label, or text content.`;

      const result = await aiCreateTest(repositoryId, {
        userPrompt: fixPrompt,
        targetUrl: targetUrl || undefined,
        useMCP,
      });

      if (result.success && result.code) {
        setGeneratedCode(result.code);
        await validateCode(result.code, nextIteration);
      } else {
        toast.error('Failed to auto-fix test');
        setStep('preview');
      }
    } catch (_error) {
      toast.error('Failed to auto-fix test');
      setStep('preview');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleManualRevalidate = async () => {
    await validateCode(generatedCode);
  };

  const generateTestName = (userPrompt: string): string => {
    return userPrompt.slice(0, 50).replace(/[^a-zA-Z0-9\s]/g, '').trim() || 'AI Generated Test';
  };

  const autoSaveTest = async (code: string) => {
    const name = generateTestName(prompt);
    setTestName(name);
    setIsSaving(true);

    try {
      const result = await saveGeneratedTest({
        repositoryId,
        functionalAreaId: functionalAreaId && functionalAreaId !== '__none__' ? functionalAreaId : undefined,
        name,
        code,
        targetUrl: targetUrl || undefined,
      });

      if (result.success) {
        toast.success('Test created and saved');
        handleClose();
      } else {
        toast.error(result.error || 'Failed to save test');
        setStep('preview');
      }
    } catch (_error) {
      toast.error('Failed to save test');
      setStep('preview');
    } finally {
      setIsSaving(false);
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
        functionalAreaId: functionalAreaId && functionalAreaId !== '__none__' ? functionalAreaId : undefined,
        name: testName.trim(),
        code: generatedCode,
        targetUrl: targetUrl || undefined,
      });

      if (result.success) {
        toast.success('Test saved successfully');
        handleClose();
      } else {
        toast.error(result.error || 'Failed to save test');
      }
    } catch (_error) {
      toast.error('Failed to save test');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    setStep('prompt');
    setPrompt('');
    setTargetUrl('');
    setUseMCP(false);
    setMaxIterations(1);
    setGeneratedCode('');
    setTestName('');
    setFunctionalAreaId('');
    setValidationResults([]);
    setIterationCount(0);
    onOpenChange(false);
  };

  const validCount = validationResults.filter((r) => r.valid).length;
  const invalidCount = validationResults.filter((r) => !r.valid).length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5" />
            Create Test with MCP Validation
          </DialogTitle>
          <DialogDescription>
            {step === 'prompt'
              ? 'AI will generate test code and validate selectors against the live page'
              : step === 'validating'
              ? 'Validating selectors against the live page...'
              : 'Review the validated test code'}
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
              <Label htmlFor="targetUrl">Target URL (required for MCP validation)</Label>
              <Input
                id="targetUrl"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="e.g., /login"
              />
              <p className="text-xs text-muted-foreground">
                Full URL: {baseUrl}{targetUrl.startsWith('/') ? '' : '/'}{targetUrl || '/'}
              </p>
            </div>

            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div className="space-y-0.5">
                <Label htmlFor="useMCP" className="cursor-pointer">MCP Exploration Mode</Label>
                <p className="text-xs text-muted-foreground">
                  AI navigates the live page to discover accurate selectors before generating test code
                </p>
              </div>
              <Switch
                id="useMCP"
                checked={useMCP}
                onCheckedChange={setUseMCP}
              />
            </div>

            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div className="space-y-0.5">
                <Label>Auto-fix Iterations</Label>
                <p className="text-xs text-muted-foreground">
                  Retry count when selectors fail validation
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setMaxIterations(Math.max(0, maxIterations - 1))}
                  disabled={maxIterations <= 0}
                >
                  -
                </Button>
                <span className="w-6 text-center font-medium">{maxIterations}</span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setMaxIterations(Math.min(5, maxIterations + 1))}
                  disabled={maxIterations >= 5}
                >
                  +
                </Button>
              </div>
            </div>
          </div>
        ) : step === 'validating' ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-12 w-12 animate-spin text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              {isGenerating ? 'Generating test code...' : 'Validating selectors against live page...'}
            </p>
            {iterationCount > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                Iteration {iterationCount} of {maxIterations}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Validation Results Summary */}
            {validationResults.length > 0 && (
              <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span className="text-sm">{validCount} valid</span>
                </div>
                {invalidCount > 0 && (
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-red-500" />
                    <span className="text-sm">{invalidCount} invalid</span>
                  </div>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleManualRevalidate}
                  disabled={isValidating}
                  className="ml-auto"
                >
                  {isValidating ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Zap className="h-4 w-4 mr-2" />
                  )}
                  Revalidate
                </Button>
              </div>
            )}

            {/* Invalid Selectors Details */}
            {invalidCount > 0 && (
              <ScrollArea className="max-h-32 border rounded-lg p-2">
                <div className="space-y-1">
                  {validationResults
                    .filter((r) => !r.valid)
                    .map((r, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <XCircle className="h-3 w-3 text-red-500 flex-shrink-0" />
                        <code className="text-xs bg-muted px-1 rounded">{r.selector}</code>
                        <span className="text-xs text-muted-foreground">{r.error || 'Not found'}</span>
                      </div>
                    ))}
                </div>
              </ScrollArea>
            )}

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
                    <SelectItem value="__none__">None</SelectItem>
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
              <div className="flex items-center justify-between">
                <Label>Generated Code</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleGenerate}
                  disabled={isGenerating || isValidating}
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
                maxHeight="250px"
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
              <Button onClick={handleGenerate} disabled={isGenerating || !prompt.trim() || !targetUrl.trim()}>
                {isGenerating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4 mr-2" />
                )}
                Generate & Validate
              </Button>
            </>
          ) : step === 'validating' ? (
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
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
