'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Separator } from '@/components/ui/separator';
import { ExternalLink, Play, Pencil, Save, X, Folder, FileCode, ListChecks, Trash2, ScrollText, Undo2, Loader2 } from 'lucide-react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import { updateArea, getArea, rollbackAreaPlan } from '@/server/actions/areas';
import { toast } from 'sonner';
import { getTest, updateTest } from '@/server/actions/tests';
import { getSuite, updateSuite } from '@/server/actions/suites';
import type { TreeSelection, SuiteItem } from './area-tree';
import type { FunctionalArea, Test, Suite } from '@/lib/db/schema';
import type { FunctionalAreaWithChildren } from '@/lib/db/queries';

interface AreaDetailSectionProps {
  selection: TreeSelection | null;
  areas: FunctionalAreaWithChildren[];
  suites: SuiteItem[];
  repositoryId: string;
  onUpdate: () => void;
  onDeleteArea?: (id: string) => void;
}

export function AreaDetailSection({ selection, areas, suites, repositoryId: _repositoryId, onUpdate, onDeleteArea }: AreaDetailSectionProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [areaData, setAreaData] = useState<FunctionalArea | null>(null);
  const [testData, setTestData] = useState<Test | null>(null);
  const [suiteData, setSuiteData] = useState<Suite | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);
  const [targetUrl, setTargetUrl] = useState('');

  // Flatten areas for parent selector
  const flattenAreas = (items: FunctionalAreaWithChildren[], exclude?: string): { id: string; name: string; depth: number }[] => {
    const result: { id: string; name: string; depth: number }[] = [];
    const flatten = (arr: FunctionalAreaWithChildren[], depth: number) => {
      for (const item of arr) {
        if (item.id !== exclude) {
          result.push({ id: item.id, name: item.name, depth });
          flatten(item.children, depth + 1);
        }
      }
    };
    flatten(items, 0);
    return result;
  };

  useEffect(() => {
    if (!selection) {
      setAreaData(null);
      setTestData(null);
      setSuiteData(null);
      setIsEditing(false);
      return;
    }

    const loadData = async () => {
      if (selection.type === 'area') {
        const area = await getArea(selection.id);
        setAreaData(area || null);
        setTestData(null);
        setSuiteData(null);
        if (area) {
          setName(area.name);
          setDescription(area.description || '');
          setParentId(area.parentId || null);
        }
      } else if (selection.type === 'test') {
        const test = await getTest(selection.id);
        setTestData(test || null);
        setAreaData(null);
        setSuiteData(null);
        if (test) {
          setName(test.name);
          setTargetUrl(test.targetUrl || '');
        }
      } else if (selection.type === 'suite') {
        const suite = await getSuite(selection.id);
        setSuiteData(suite || null);
        setAreaData(null);
        setTestData(null);
        if (suite) {
          setName(suite.name);
          setDescription(suite.description || '');
        }
      }
      setIsEditing(false);
    };

    loadData();
  }, [selection]);

  const handleSave = async () => {
    if (!selection) return;
    setIsSaving(true);

    try {
      if (selection.type === 'area' && areaData) {
        await updateArea(areaData.id, {
          name,
          description: description || undefined,
          parentId: parentId || undefined,
        });
        setAreaData({ ...areaData, name, description, parentId });
      } else if (selection.type === 'test' && testData) {
        await updateTest(testData.id, { name, targetUrl: targetUrl || undefined });
        setTestData({ ...testData, name, targetUrl });
      } else if (selection.type === 'suite' && suiteData) {
        await updateSuite(suiteData.id, { name, description: description || undefined });
        setSuiteData({ ...suiteData, name, description });
      }
      setIsEditing(false);
      onUpdate();
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (areaData) {
      setName(areaData.name);
      setDescription(areaData.description || '');
      setParentId(areaData.parentId || null);
    } else if (testData) {
      setName(testData.name);
      setTargetUrl(testData.targetUrl || '');
    } else if (suiteData) {
      setName(suiteData.name);
      setDescription(suiteData.description || '');
    }
    setIsEditing(false);
  };

  const availableParents = selection?.type === 'area' ? flattenAreas(areas, selection.id) : [];

  // Empty state
  if (!selection) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <Folder className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Select an area, test, or suite from the tree to view details</p>
        </CardContent>
      </Card>
    );
  }

  // Area details
  if (selection.type === 'area' && areaData) {
    const areaNode = findAreaNode(areas, areaData.id);
    const testCount = areaNode?.tests.length || 0;

    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="flex items-center gap-2">
            <Folder className="h-5 w-5 text-primary" />
            Area Details
          </CardTitle>
          {!isEditing ? (
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </Button>
              {onDeleteArea && (
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => onDeleteArea(areaData.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ) : (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={handleCancel}>
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={isSaving}>
                <Save className="h-4 w-4 mr-2" />
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            {isEditing ? (
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-lg font-medium">{areaData.name}</span>
                {areaData.isRouteFolder && (
                  <Badge variant="secondary">Route Folder</Badge>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            {isEditing ? (
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {areaData.description || 'No description'}
              </p>
            )}
          </div>

          {isEditing && (
            <div className="space-y-2">
              <Label htmlFor="parent">Parent Folder</Label>
              <Select
                value={parentId || 'none'}
                onValueChange={(v) => setParentId(v === 'none' ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="No parent (root level)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No parent (root level)</SelectItem>
                  {availableParents.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {'  '.repeat(p.depth)}{p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Separator />

          <div>
            <Label>Tests in this area</Label>
            <p className="text-2xl font-bold mt-1">{testCount}</p>
          </div>

          {/* Agent Plan Preview */}
          {areaData.agentPlan && (
            <>
              <Separator />
              <AgentPlanPreview
                areaId={areaData.id}
                agentPlan={areaData.agentPlan}
                planGeneratedAt={areaData.planGeneratedAt}
                hasSnapshot={!!areaData.planSnapshot}
                onUpdate={onUpdate}
              />
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  // Test details
  if (selection.type === 'test' && testData) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="flex items-center gap-2">
              <FileCode className="h-5 w-5 text-primary" />
              Test Details
              {testData.isPlaceholder && (
                <Badge variant="outline" className="text-amber-600 border-amber-500/50 text-xs">
                  Placeholder
                </Badge>
              )}
            </CardTitle>
            {!isEditing ? (
              <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={handleCancel}>
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSave} disabled={isSaving}>
                  <Save className="h-4 w-4 mr-2" />
                  {isSaving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              {isEditing ? (
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              ) : (
                <div className="text-lg font-medium">{testData.name}</div>
              )}
              {testData.description && !isEditing && (
                testData.description.includes('\n') ? (
                  <ul className="text-sm text-muted-foreground mt-1 list-disc list-inside space-y-0.5">
                    {testData.description.split('\n').filter(Boolean).map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground mt-1">{testData.description}</p>
                )
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="targetUrl">Target URL</Label>
              {isEditing ? (
                <Input
                  id="targetUrl"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  placeholder="http://localhost:3000"
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {testData.targetUrl || 'No URL set'}
                </p>
              )}
            </div>

            <Separator />

            <div className="flex gap-2">
              <Button asChild variant="outline" className="flex-1">
                <Link href={`/tests/${testData.id}`}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  View Details
                </Link>
              </Button>
              {testData.isPlaceholder ? (
                <Button asChild className="flex-1">
                  <Link href={`/record?rerecordId=${testData.id}`}>
                    <Play className="h-4 w-4 mr-2" />
                    Record Test
                  </Link>
                </Button>
              ) : (
                <Button asChild className="flex-1">
                  <Link href={`/run?testId=${testData.id}`}>
                    <Play className="h-4 w-4 mr-2" />
                    Run Test
                  </Link>
                </Button>
              )}
            </div>

            {testData.createdAt && (
              <div className="text-xs text-muted-foreground">
                Created: {new Date(testData.createdAt).toLocaleDateString()}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Suite details
  if (selection.type === 'suite' && suiteData) {
    const suiteItem = suites.find((s) => s.id === suiteData.id);
    const testCount = suiteItem?.testCount || 0;

    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-violet-500" />
            Suite Details
          </CardTitle>
          {!isEditing ? (
            <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={handleCancel}>
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={isSaving}>
                <Save className="h-4 w-4 mr-2" />
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            {isEditing ? (
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            ) : (
              <div className="text-lg font-medium">{suiteData.name}</div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            {isEditing ? (
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {suiteData.description || 'No description'}
              </p>
            )}
          </div>

          <Separator />

          <div>
            <Label>Tests in this suite</Label>
            <p className="text-2xl font-bold mt-1">{testCount}</p>
          </div>

          <div className="flex gap-2">
            <Button asChild variant="outline" className="flex-1">
              <Link href={`/suites/${suiteData.id}`}>
                <ExternalLink className="h-4 w-4 mr-2" />
                View Suite
              </Link>
            </Button>
            <Button asChild className="flex-1">
              <Link href={`/suites/${suiteData.id}`}>
                <Play className="h-4 w-4 mr-2" />
                Run Suite
              </Link>
            </Button>
          </div>

          {suiteData.createdAt && (
            <div className="text-xs text-muted-foreground">
              Created: {new Date(suiteData.createdAt).toLocaleDateString()}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return null;
}

function findAreaNode(areas: FunctionalAreaWithChildren[], id: string): FunctionalAreaWithChildren | null {
  for (const area of areas) {
    if (area.id === id) return area;
    const found = findAreaNode(area.children, id);
    if (found) return found;
  }
  return null;
}

function AgentPlanPreview({
  areaId,
  agentPlan,
  planGeneratedAt,
  hasSnapshot,
  onUpdate,
}: {
  areaId: string;
  agentPlan: string;
  planGeneratedAt: Date | null;
  hasSnapshot: boolean;
  onUpdate: () => void;
}) {
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleRollback = async () => {
    setIsRollingBack(true);
    try {
      await rollbackAreaPlan(areaId);
      toast.success('Plan rolled back');
      onUpdate();
    } catch {
      toast.error('Failed to rollback');
    } finally {
      setIsRollingBack(false);
    }
  };

  const previewText = expanded ? agentPlan : agentPlan;
  const isLong = agentPlan.split('\n').length > 15;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Label>Agent Plan</Label>
          {planGeneratedAt && (
            <Badge variant="secondary" className="text-xs">
              {new Date(planGeneratedAt).toLocaleDateString()}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/areas/plan#area-${areaId}`}>
              <ScrollText className="h-3.5 w-3.5 mr-1" />
              Full View
            </Link>
          </Button>
          {hasSnapshot && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={handleRollback}
              disabled={isRollingBack}
            >
              {isRollingBack ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
            </Button>
          )}
        </div>
      </div>
      <div className={`border rounded-md p-3 prose prose-sm dark:prose-invert max-w-none overflow-auto ${!expanded && isLong ? 'max-h-[200px]' : ''}`}>
        <ReactMarkdown>{previewText}</ReactMarkdown>
      </div>
      {isLong && (
        <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : 'Show more'}
        </Button>
      )}
    </div>
  );
}
