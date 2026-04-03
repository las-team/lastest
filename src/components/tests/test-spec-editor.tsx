'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CheckCircle, AlertTriangle, Wand2, Loader2, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { saveTestSpec, regenerateTestFromSpec, detectSpecDrift } from '@/server/actions/specs';
import type { TestSpec } from '@/lib/db/schema';

interface TestSpecEditorProps {
  testId: string;
  testName: string;
  repositoryId: string;
  initialSpec: TestSpec | null;
  functionalAreaId?: string | null;
}

export function TestSpecEditor({ testId, testName, repositoryId, initialSpec, functionalAreaId }: TestSpecEditorProps) {
  const [title, setTitle] = useState(initialSpec?.title || testName);
  const [spec, setSpec] = useState(initialSpec?.spec || '');
  const [status, setStatus] = useState<string>(initialSpec?.status || 'draft');
  const [specId, setSpecId] = useState<string | null>(initialSpec?.id || null);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [showRegenDialog, setShowRegenDialog] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef({ title: initialSpec?.title || testName, spec: initialSpec?.spec || '' });

  const doSave = useCallback(async (newTitle: string, newSpec: string) => {
    if (!newSpec.trim()) return;
    if (newTitle === lastSavedRef.current.title && newSpec === lastSavedRef.current.spec) return;

    setSaving(true);
    try {
      const id = await saveTestSpec(testId, newTitle, newSpec, repositoryId, functionalAreaId);
      setSpecId(id);
      lastSavedRef.current = { title: newTitle, spec: newSpec };

      // Check drift
      const drift = await detectSpecDrift(testId);
      setStatus(drift.isDrifted ? 'outdated' : 'has_test');

      toast.success('Spec saved');
    } catch {
      toast.error('Failed to save spec');
    } finally {
      setSaving(false);
    }
  }, [testId, repositoryId, functionalAreaId]);

  const scheduleAutoSave = useCallback((newTitle: string, newSpec: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSave(newTitle, newSpec), 1500);
  }, [doSave]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleTitleChange = (val: string) => {
    setTitle(val);
    scheduleAutoSave(val, spec);
  };

  const handleSpecChange = (val: string) => {
    setSpec(val);
    scheduleAutoSave(title, val);
  };

  const handleRegenerate = async () => {
    if (!specId) return;
    setShowRegenDialog(false);
    setRegenerating(true);
    try {
      const result = await regenerateTestFromSpec(specId, repositoryId);
      if (result.success) {
        setStatus('has_test');
        toast.success('Test code regenerated');
      } else {
        toast.error(result.error || 'Regeneration failed');
      }
    } catch {
      toast.error('Failed to regenerate test');
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Test Specification
            </CardTitle>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Title</label>
            <Input
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Spec title"
              className="text-sm"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Specification</label>
            <Textarea
              value={spec}
              onChange={(e) => handleSpecChange(e.target.value)}
              placeholder="Describe what this test should verify in natural language..."
              className="min-h-[120px] text-sm font-mono"
              rows={6}
            />
          </div>

          {/* Status line */}
          {spec.trim() && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs">
                {status === 'has_test' && (
                  <>
                    <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                    <span className="text-muted-foreground">Spec saved — code matches</span>
                  </>
                )}
                {status === 'outdated' && (
                  <>
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    <span className="text-amber-600 dark:text-amber-400">Spec updated — test code may be outdated</span>
                  </>
                )}
                {(status === 'draft' || status === 'approved') && (
                  <>
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">Draft spec</span>
                  </>
                )}
              </div>

              {status === 'outdated' && specId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowRegenDialog(true)}
                  disabled={regenerating}
                  className="gap-1.5"
                >
                  {regenerating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Wand2 className="h-3.5 w-3.5" />
                  )}
                  Regenerate Test
                </Button>
              )}
            </div>
          )}

          {initialSpec?.source && initialSpec.source !== 'manual' && (
            <p className="text-xs text-muted-foreground">
              Source: {initialSpec.source === 'planner' ? 'AI Planner' : initialSpec.source === 'agent_prompt' ? 'Agent Prompt' : initialSpec.source === 'route_suggestion' ? 'Route Suggestion' : initialSpec.source}
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={showRegenDialog} onOpenChange={setShowRegenDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate Test Code</DialogTitle>
            <DialogDescription>
              This will use AI to regenerate the test code based on the updated spec. The current code will be saved as a new version.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRegenDialog(false)}>Cancel</Button>
            <Button onClick={handleRegenerate} disabled={regenerating}>
              {regenerating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />}
              Regenerate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
