'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ArrowLeft, Download, Save, Undo2, ChevronDown, ChevronRight, FileText, Loader2, Pencil, X } from 'lucide-react';
import Link from 'next/link';
import { updateAreaPlan, rollbackAreaPlan, exportAllPlans, exportAreaPlan } from '@/server/actions/areas';
import { toast } from 'sonner';
import { timeAgo, downloadMarkdown } from '@/lib/utils';
import type { FunctionalAreaPlanSnapshot } from '@/lib/db/schema';

interface PlanArea {
  id: string;
  name: string;
  description: string | null;
  agentPlan: string;
  planGeneratedAt: Date | null;
  planSnapshot: string | null;
  tests: { id: string; name: string; description: string | null }[];
}

interface PlanPageClientProps {
  areas: PlanArea[];
  repoName: string;
  repositoryId: string;
}

export function PlanPageClient({ areas, repoName, repositoryId }: PlanPageClientProps) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<PlanArea | null>(null);
  const [exporting, setExporting] = useState(false);

  // Auto-scroll to hash target on mount
  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      const el = document.querySelector(hash);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const handleEdit = (area: PlanArea) => {
    setEditingId(area.id);
    setEditContent(area.agentPlan);
  };

  const handleSave = async (areaId: string) => {
    setSaving(areaId);
    try {
      await updateAreaPlan(areaId, editContent);
      setEditingId(null);
      toast.success('Plan saved');
      router.refresh();
    } catch {
      toast.error('Failed to save plan');
    } finally {
      setSaving(null);
    }
  };

  const handleRollback = async (area: PlanArea) => {
    setRollingBack(area.id);
    try {
      await rollbackAreaPlan(area.id);
      setRollbackTarget(null);
      toast.success('Plan rolled back');
      router.refresh();
    } catch {
      toast.error('Failed to rollback');
    } finally {
      setRollingBack(null);
    }
  };

  const handleExportAll = async () => {
    setExporting(true);
    try {
      const md = await exportAllPlans(repositoryId);
      downloadMarkdown(md, `${repoName.toLowerCase().replace(/\s+/g, '-')}-testing-manifesto.md`);
      toast.success('Manifesto exported');
    } catch {
      toast.error('Failed to export');
    } finally {
      setExporting(false);
    }
  };

  const handleExportArea = async (area: PlanArea) => {
    try {
      const md = await exportAreaPlan(area.id);
      downloadMarkdown(md, `${area.name.toLowerCase().replace(/\s+/g, '-')}-plan.md`);
      toast.success('Plan exported');
    } catch {
      toast.error('Failed to export area plan');
    }
  };

  const rollbackSnapshot: FunctionalAreaPlanSnapshot | null = rollbackTarget?.planSnapshot
    ? JSON.parse(rollbackTarget.planSnapshot)
    : null;
  const rollbackTestCount = rollbackSnapshot?.generatedTestIds?.length ?? 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/areas">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Areas
            </Link>
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <div>
            <h1 className="text-lg font-semibold">Testing Plan</h1>
            <p className="text-sm text-muted-foreground">{repoName} — {areas.length} area{areas.length !== 1 ? 's' : ''} with plans</p>
          </div>
        </div>
        <Button onClick={handleExportAll} disabled={exporting || areas.length === 0} variant="outline">
          {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
          Export Manifesto
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl mx-auto space-y-6">
          {areas.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No test plans generated yet.</p>
                <p className="text-sm mt-1">Run the Play Agent to generate test plans for your functional areas.</p>
              </CardContent>
            </Card>
          ) : (
            areas.map((area) => (
              <AreaPlanCard
                key={area.id}
                area={area}
                isEditing={editingId === area.id}
                editContent={editContent}
                isSaving={saving === area.id}
                onEdit={() => handleEdit(area)}
                onCancelEdit={() => setEditingId(null)}
                onEditChange={setEditContent}
                onSave={() => handleSave(area.id)}
                onRequestRollback={() => setRollbackTarget(area)}
                onExport={() => handleExportArea(area)}
              />
            ))
          )}
        </div>
      </div>

      {/* Rollback confirmation dialog */}
      <Dialog open={!!rollbackTarget} onOpenChange={(open) => !open && setRollbackTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rollback &ldquo;{rollbackTarget?.name}&rdquo;</DialogTitle>
            <DialogDescription>
              This will restore the previous plan and description.
              {rollbackTestCount > 0 && (
                <> <strong>{rollbackTestCount} generated test{rollbackTestCount !== 1 ? 's' : ''}</strong> will be deleted.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRollbackTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => rollbackTarget && handleRollback(rollbackTarget)}
              disabled={rollingBack === rollbackTarget?.id}
            >
              {rollingBack === rollbackTarget?.id ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Undo2 className="h-4 w-4 mr-1" />}
              Rollback
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface AreaPlanCardProps {
  area: PlanArea;
  isEditing: boolean;
  editContent: string;
  isSaving: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onEditChange: (v: string) => void;
  onSave: () => void;
  onRequestRollback: () => void;
  onExport: () => void;
}

function AreaPlanCard({
  area,
  isEditing,
  editContent,
  isSaving,
  onEdit,
  onCancelEdit,
  onEditChange,
  onSave,
  onRequestRollback,
  onExport,
}: AreaPlanCardProps) {
  const [testsOpen, setTestsOpen] = useState(false);
  const hasSnapshot = !!area.planSnapshot;

  return (
    <Card id={`area-${area.id}`}>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div className="space-y-1">
          <CardTitle className="text-lg">{area.name}</CardTitle>
          {area.description && (
            <p className="text-sm text-muted-foreground line-clamp-2">{area.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="secondary" className="text-xs">
            {timeAgo(area.planGeneratedAt)}
          </Badge>
          <Button variant="ghost" size="sm" onClick={onExport} title="Export this area">
            <Download className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isEditing ? (
          /* Split-pane: editor left, preview right */
          <div className="grid grid-cols-2 gap-4 min-h-[400px]">
            <div className="flex flex-col">
              <p className="text-xs font-medium text-muted-foreground mb-2">Edit</p>
              <Textarea
                value={editContent}
                onChange={(e) => onEditChange(e.target.value)}
                className="flex-1 font-mono text-sm resize-none min-h-[380px]"
              />
            </div>
            <div className="flex flex-col">
              <p className="text-xs font-medium text-muted-foreground mb-2">Preview</p>
              <div className="flex-1 border rounded-md p-4 overflow-auto prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{editContent}</ReactMarkdown>
              </div>
            </div>
          </div>
        ) : (
          /* Read-only rendered view */
          <div className="border rounded-md p-4 prose prose-sm dark:prose-invert max-w-none max-h-[500px] overflow-auto">
            <ReactMarkdown>{area.agentPlan}</ReactMarkdown>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {isEditing ? (
              <>
                <Button size="sm" onClick={onSave} disabled={isSaving}>
                  {isSaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={onCancelEdit}>
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={onEdit}>
                <Pencil className="h-4 w-4 mr-1" />
                Edit Plan
              </Button>
            )}
          </div>
          {hasSnapshot && !isEditing && (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={onRequestRollback}
            >
              <Undo2 className="h-4 w-4 mr-1" />
              Rollback
            </Button>
          )}
        </div>

        {/* Generated Tests collapsible */}
        {area.tests.length > 0 && (
          <>
            <Separator />
            <Collapsible open={testsOpen} onOpenChange={setTestsOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-between">
                  <span className="text-sm">Generated Tests ({area.tests.length})</span>
                  {testsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                <div className="space-y-1">
                  {area.tests.map(test => (
                    <div key={test.id} className="flex items-center gap-2 px-3 py-1.5 text-sm rounded hover:bg-muted/50">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <Link href={`/tests/${test.id}`} className="hover:underline truncate">
                        {test.name}
                      </Link>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </>
        )}
      </CardContent>
    </Card>
  );
}
