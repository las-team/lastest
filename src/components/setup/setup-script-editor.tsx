'use client';

import { useState, useEffect } from 'react';
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
import { Badge } from '@/components/ui/badge';
import { Play, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { createSetupScript, updateSetupScript, testSetupScript } from '@/server/actions/setup-scripts';
import { toast } from 'sonner';
import type { SetupScript, SetupScriptType } from '@/lib/db/schema';

interface SetupScriptEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClose: () => void;
  repositoryId: string;
  editScript: SetupScript | null;
}

const PLAYWRIGHT_TEMPLATE = `// Playwright setup script
// Available: page, baseUrl, context (SetupContext)
// Return variables to pass to tests

await page.goto(baseUrl);

// Example: Login
// await page.fill('[name="email"]', 'test@example.com');
// await page.fill('[name="password"]', 'password');
// await page.click('button[type="submit"]');

// Return any variables needed by tests
return { loggedIn: true };
`;

const API_TEMPLATE = `{
  "method": "POST",
  "endpoint": "/api/seed",
  "headers": {},
  "body": {
    "action": "reset"
  },
  "extractVariables": {
    "seedResult": "data.id"
  }
}`;

export function SetupScriptEditor({
  open,
  onOpenChange,
  onClose,
  repositoryId,
  editScript,
}: SetupScriptEditorProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<SetupScriptType>('playwright');
  const [code, setCode] = useState(PLAYWRIGHT_TEMPLATE);
  const [description, setDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    duration: number;
    error?: string;
    variables?: Record<string, unknown>;
  } | null>(null);

  // Reset form when dialog opens/closes or edit target changes
  useEffect(() => {
    if (open) {
      if (editScript) {
        setName(editScript.name);
        setType(editScript.type as SetupScriptType);
        setCode(editScript.code);
        setDescription(editScript.description || '');
      } else {
        setName('');
        setType('playwright');
        setCode(PLAYWRIGHT_TEMPLATE);
        setDescription('');
      }
      setTestResult(null);
    }
  }, [open, editScript]);

  // Update template when type changes (only for new scripts)
  useEffect(() => {
    if (!editScript) {
      setCode(type === 'playwright' ? PLAYWRIGHT_TEMPLATE : API_TEMPLATE);
    }
  }, [type, editScript]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (!code.trim()) {
      toast.error('Code is required');
      return;
    }

    setIsSaving(true);
    try {
      if (editScript) {
        await updateSetupScript(editScript.id, {
          name: name.trim(),
          type,
          code,
          description: description.trim() || undefined,
        });
        toast.success('Script updated');
      } else {
        await createSetupScript({
          repositoryId,
          name: name.trim(),
          type,
          code,
          description: description.trim() || undefined,
        });
        toast.success('Script created');
      }
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save script');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    if (!editScript) {
      toast.error('Save the script first to test it');
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testSetupScript(editScript.id, 'http://localhost:3000');
      setTestResult(result);
      if (result.success) {
        toast.success(`Script ran successfully (${result.duration}ms)`);
      } else {
        toast.error(result.error || 'Script failed');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to test script');
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editScript ? 'Edit Setup Script' : 'Create Setup Script'}
          </DialogTitle>
          <DialogDescription>
            Setup scripts run before tests to prepare the environment.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Login Setup"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as SetupScriptType)}>
                <SelectTrigger id="type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="playwright">Playwright</SelectItem>
                  <SelectItem value="api">API</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Logs in as test user"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="code">Code</Label>
              {type === 'playwright' && (
                <Badge variant="secondary" className="text-xs">
                  async (page, baseUrl, context) =&gt; ...
                </Badge>
              )}
              {type === 'api' && (
                <Badge variant="secondary" className="text-xs">
                  JSON schema
                </Badge>
              )}
            </div>
            <Textarea
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="font-mono text-sm min-h-[250px]"
              placeholder={type === 'playwright' ? PLAYWRIGHT_TEMPLATE : API_TEMPLATE}
            />
          </div>

          {/* Test Result */}
          {testResult && (
            <div
              className={`p-3 rounded-lg border ${
                testResult.success
                  ? 'bg-green-50 border-green-200'
                  : 'bg-red-50 border-red-200'
              }`}
            >
              <div className="flex items-center gap-2">
                {testResult.success ? (
                  <CheckCircle className="h-4 w-4 text-green-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-600" />
                )}
                <span
                  className={`font-medium ${
                    testResult.success ? 'text-green-700' : 'text-red-700'
                  }`}
                >
                  {testResult.success ? 'Success' : 'Failed'}
                </span>
                <span className="text-sm text-muted-foreground">
                  ({testResult.duration}ms)
                </span>
              </div>
              {testResult.error && (
                <pre className="mt-2 text-xs text-red-600 whitespace-pre-wrap">
                  {testResult.error}
                </pre>
              )}
              {testResult.variables && Object.keys(testResult.variables).length > 0 && (
                <div className="mt-2">
                  <span className="text-xs font-medium">Variables:</span>
                  <pre className="mt-1 text-xs text-muted-foreground">
                    {JSON.stringify(testResult.variables, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {editScript && type === 'playwright' && (
            <Button variant="outline" onClick={handleTest} disabled={isTesting}>
              {isTesting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Test
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {editScript ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
