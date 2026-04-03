'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, Circle, AlertTriangle, Plus, X, Wand2, Loader2, ExternalLink, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { createStandaloneSpec, generateTestFromSpec, convertPlanToSpecs } from '@/server/actions/specs';
import { useRouter } from 'next/navigation';
import type { TestSpec } from '@/lib/db/schema';

interface AreaSpecsPanelProps {
  areaId: string;
  repositoryId: string;
  specs: TestSpec[];
  hasAgentPlan: boolean;
}

export function AreaSpecsPanel({ areaId, repositoryId, specs: initialSpecs, hasAgentPlan }: AreaSpecsPanelProps) {
  const router = useRouter();
  const [specs, setSpecs] = useState(initialSpecs);
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSpec, setNewSpec] = useState('');
  const [saving, setSaving] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [convertingPlan, setConvertingPlan] = useState(false);

  useEffect(() => {
    setSpecs(initialSpecs);
  }, [initialSpecs]);

  const handleAddSpec = async () => {
    if (!newTitle.trim() || !newSpec.trim()) return;
    setSaving(true);
    try {
      await createStandaloneSpec(repositoryId, areaId, newTitle.trim(), newSpec.trim());
      setNewTitle('');
      setNewSpec('');
      setShowAdd(false);
      toast.success('Spec created');
      router.refresh();
    } catch {
      toast.error('Failed to create spec');
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateTest = async (specId: string) => {
    setGeneratingId(specId);
    try {
      const result = await generateTestFromSpec(specId, repositoryId);
      if (result.success) {
        toast.success('Test generated');
        router.refresh();
      } else {
        toast.error(result.error || 'Generation failed');
      }
    } catch {
      toast.error('Failed to generate test');
    } finally {
      setGeneratingId(null);
    }
  };

  const handleConvertPlan = async () => {
    setConvertingPlan(true);
    try {
      const result = await convertPlanToSpecs(areaId, repositoryId);
      if (result.created > 0) {
        toast.success(`Created ${result.created} spec${result.created !== 1 ? 's' : ''} from plan`);
        router.refresh();
      } else {
        toast.info('No new specs to create from plan');
      }
    } catch {
      toast.error('Failed to convert plan');
    } finally {
      setConvertingPlan(false);
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'has_test': return <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
      case 'outdated': return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
      default: return <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case 'has_test': return 'Has Test';
      case 'outdated': return 'Outdated';
      case 'approved': return 'Approved';
      default: return 'No Test';
    }
  };

  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Specs ({specs.length})</h4>
        <div className="flex items-center gap-1.5">
          {hasAgentPlan && (
            <Button variant="ghost" size="sm" onClick={handleConvertPlan} disabled={convertingPlan} className="h-7 text-xs">
              {convertingPlan ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Wand2 className="h-3 w-3 mr-1" />}
              From Plan
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setShowAdd(true)} className="h-7 text-xs">
            <Plus className="h-3 w-3 mr-1" />
            Add Spec
          </Button>
        </div>
      </div>

      {specs.length === 0 && !showAdd && (
        <p className="text-xs text-muted-foreground py-2">No specs yet. Add one or generate from the plan above.</p>
      )}

      {specs.map((spec) => (
        <div key={spec.id} className="flex items-start gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 group">
          {statusIcon(spec.status)}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">{spec.title}</span>
              <Badge variant="outline" className="text-[10px] h-4 px-1.5 shrink-0">
                {statusLabel(spec.status)}
              </Badge>
            </div>
            {spec.spec && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">{spec.spec.split('\n')[0]}</p>
            )}
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            {!spec.testId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleGenerateTest(spec.id)}
                disabled={generatingId === spec.id}
                className="h-6 text-xs px-2"
              >
                {generatingId === spec.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Wand2 className="h-3 w-3" />
                )}
              </Button>
            )}
            {spec.testId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push(`/tests/${spec.testId}`)}
                className="h-6 text-xs px-2"
              >
                <ExternalLink className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      ))}

      {showAdd && (
        <div className="border rounded-md p-3 space-y-2 bg-muted/30">
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Spec title"
            className="text-sm h-8"
            autoFocus
          />
          <Textarea
            value={newSpec}
            onChange={(e) => setNewSpec(e.target.value)}
            placeholder="Describe what this test should verify..."
            className="text-sm min-h-[60px]"
            rows={3}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleAddSpec} disabled={saving || !newTitle.trim() || !newSpec.trim()} className="h-7 text-xs">
              {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setShowAdd(false); setNewTitle(''); setNewSpec(''); }} className="h-7 text-xs">
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
