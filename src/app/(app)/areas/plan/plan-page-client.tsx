'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ArrowLeft, Download, Save, Undo2, ChevronDown, ChevronRight, FileText, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { updateAreaPlan, rollbackAreaPlan, exportAllPlans, exportAreaPlan } from '@/server/actions/areas';
import { toast } from 'sonner';

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

function downloadMarkdown(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function timeAgo(date: Date | null): string {
  if (!date) return 'Unknown';
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function PlanPageClient({ areas, repoName, repositoryId }: PlanPageClientProps) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

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

  const handleRollback = async (areaId: string) => {
    setRollingBack(areaId);
    try {
      await rollbackAreaPlan(areaId);
      toast.success('Plan rolled back — generated tests deleted');
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
    } catch {
      toast.error('Failed to export area plan');
    }
  };

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
                isRollingBack={rollingBack === area.id}
                onEdit={() => handleEdit(area)}
                onCancelEdit={() => setEditingId(null)}
                onEditChange={setEditContent}
                onSave={() => handleSave(area.id)}
                onRollback={() => handleRollback(area.id)}
                onExport={() => handleExportArea(area)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

interface AreaPlanCardProps {
  area: PlanArea;
  isEditing: boolean;
  editContent: string;
  isSaving: boolean;
  isRollingBack: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onEditChange: (v: string) => void;
  onSave: () => void;
  onRollback: () => void;
  onExport: () => void;
}

function AreaPlanCard({
  area,
  isEditing,
  editContent,
  isSaving,
  isRollingBack,
  onEdit,
  onCancelEdit,
  onEditChange,
  onSave,
  onRollback,
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
          <Button variant="ghost" size="sm" onClick={onExport}>
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
                  Cancel
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={onEdit}>
                Edit Plan
              </Button>
            )}
          </div>
          {hasSnapshot && !isEditing && (
            <Button
              size="sm"
              variant="destructive"
              onClick={onRollback}
              disabled={isRollingBack}
            >
              {isRollingBack ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Undo2 className="h-4 w-4 mr-1" />}
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
