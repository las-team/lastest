'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle, Circle, Plus, Loader2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { convertPlanToPlaceholders } from '@/server/actions/specs';
import { createTest } from '@/server/actions/tests';
import { PLACEHOLDER_CODE } from '@/lib/constants/placeholder';
import { useRouter } from 'next/navigation';
import { Wand2 } from 'lucide-react';

interface AreaTestCase {
  id: string;
  name: string;
  description: string | null;
  isPlaceholder: boolean;
}

interface AreaTestCasesPanelProps {
  areaId: string;
  repositoryId: string;
  tests: AreaTestCase[];
  hasAgentPlan: boolean;
  onOpenTest?: (testId: string) => void;
}

export function AreaTestCasesPanel({ areaId, repositoryId, tests, hasAgentPlan, onOpenTest }: AreaTestCasesPanelProps) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [convertingPlan, setConvertingPlan] = useState(false);

  const handleAddTestCase = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await createTest({
        name: newName.trim(),
        code: PLACEHOLDER_CODE,
        isPlaceholder: true,
        repositoryId,
        functionalAreaId: areaId,
        description: newDescription.trim() || null,
      });
      setNewName('');
      setNewDescription('');
      setShowAdd(false);
      toast.success('Test case created');
      router.refresh();
    } catch {
      toast.error('Failed to create test case');
    } finally {
      setSaving(false);
    }
  };

  const handleConvertPlan = async () => {
    setConvertingPlan(true);
    try {
      const result = await convertPlanToPlaceholders(areaId, repositoryId);
      if (result.created > 0) {
        toast.success(`Created ${result.created} test case${result.created !== 1 ? 's' : ''} from plan`);
        router.refresh();
      } else {
        toast.info('No new test cases to create from plan');
      }
    } catch {
      toast.error('Failed to convert plan');
    } finally {
      setConvertingPlan(false);
    }
  };

  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Test Cases ({tests.length})</h4>
        <div className="flex items-center gap-1.5">
          {hasAgentPlan && (
            <Button variant="ghost" size="sm" onClick={handleConvertPlan} disabled={convertingPlan} className="h-7 text-xs">
              {convertingPlan ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Wand2 className="h-3 w-3 mr-1" />}
              From Plan
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setShowAdd(true)} className="h-7 text-xs">
            <Plus className="h-3 w-3 mr-1" />
            Add Test Case
          </Button>
        </div>
      </div>

      {tests.length === 0 && !showAdd && (
        <p className="text-xs text-muted-foreground py-2">No test cases yet. Add one or generate from the plan above.</p>
      )}

      {tests.map((test) => (
        <div key={test.id} className="flex items-start gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 group">
          {test.isPlaceholder
            ? <Circle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            : <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          }
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium truncate block">{test.name}</span>
            {test.description && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">{test.description.split('\n')[0]}</p>
            )}
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenTest ? onOpenTest(test.id) : router.push(`/tests/${test.id}`)}
              className="h-6 text-xs px-2"
            >
              <ExternalLink className="h-3 w-3" />
            </Button>
          </div>
        </div>
      ))}

      {showAdd && (
        <div className="border rounded-md p-3 space-y-2 bg-muted/30">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Test case name"
            className="text-sm h-8"
            autoFocus
          />
          <Textarea
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Describe what this test should verify..."
            className="text-sm min-h-[60px]"
            rows={3}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleAddTestCase} disabled={saving || !newName.trim()} className="h-7 text-xs">
              {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setShowAdd(false); setNewName(''); setNewDescription(''); }} className="h-7 text-xs">
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Keep old export name for backwards compatibility during transition
export { AreaTestCasesPanel as AreaSpecsPanel };
