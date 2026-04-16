'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, Code, Globe, MoreVertical, Edit2, Trash2, Copy, Loader2 } from 'lucide-react';
import { SetupScriptEditor } from './setup-script-editor';
import { deleteSetupScript, duplicateSetupScript, getSetupScriptUsage } from '@/server/actions/setup-scripts';
import { toast } from 'sonner';
import type { SetupScript } from '@/lib/db/schema';

interface SetupScriptListProps {
  repositoryId: string;
  scripts: SetupScript[];
}

export function SetupScriptList({ repositoryId, scripts }: SetupScriptListProps) {
  const router = useRouter();
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingScript, setEditingScript] = useState<SetupScript | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [usageMap, setUsageMap] = useState<Map<string, { testCount: number }>>(new Map());

  const handleCreate = () => {
    setEditingScript(null);
    setIsEditorOpen(true);
  };

  const handleEdit = (script: SetupScript) => {
    setEditingScript(script);
    setIsEditorOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this script?')) return;

    setDeletingId(id);
    try {
      await deleteSetupScript(id);
      toast.success('Script deleted');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete script');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDuplicate = async (id: string) => {
    setDuplicatingId(id);
    try {
      await duplicateSetupScript(id);
      toast.success('Script duplicated');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to duplicate script');
    } finally {
      setDuplicatingId(null);
    }
  };

  const loadUsage = async (id: string) => {
    if (usageMap.has(id)) return;
    try {
      const usage = await getSetupScriptUsage(id);
      setUsageMap(prev => new Map(prev).set(id, { testCount: usage.testCount }));
    } catch {
      // Ignore errors
    }
  };

  const handleEditorClose = () => {
    setIsEditorOpen(false);
    setEditingScript(null);
    router.refresh();
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Setup Scripts</CardTitle>
            <CardDescription>
              Reusable scripts that run before tests to prepare the environment.
            </CardDescription>
          </div>
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            New Script
          </Button>
        </CardHeader>
        <CardContent>
          {scripts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Code className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="mb-2">No setup scripts yet</p>
              <p className="text-sm">Create a script to automate test preparation.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {scripts.map((script) => {
                const usage = usageMap.get(script.id);
                return (
                  <div
                    key={script.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                    onMouseEnter={() => loadUsage(script.id)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {script.type === 'playwright' ? (
                        <Code className="h-5 w-5 text-blue-500 shrink-0" />
                      ) : (
                        <Globe className="h-5 w-5 text-green-500 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{script.name}</span>
                          <Badge variant="outline" className="shrink-0">
                            {script.type}
                          </Badge>
                        </div>
                        {script.description && (
                          <p className="text-sm text-muted-foreground truncate mt-0.5">
                            {script.description}
                          </p>
                        )}
                        {usage && usage.testCount > 0 && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Used by {usage.testCount} test{usage.testCount !== 1 ? 's' : ''}
                          </p>
                        )}
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEdit(script)}>
                          <Edit2 className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleDuplicate(script.id)}
                          disabled={duplicatingId === script.id}
                        >
                          {duplicatingId === script.id ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Copy className="h-4 w-4 mr-2" />
                          )}
                          Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleDelete(script.id)}
                          disabled={deletingId === script.id}
                          className="text-destructive focus:text-destructive"
                        >
                          {deletingId === script.id ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4 mr-2" />
                          )}
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <SetupScriptEditor
        open={isEditorOpen}
        onOpenChange={setIsEditorOpen}
        onClose={handleEditorClose}
        repositoryId={repositoryId}
        editScript={editingScript}
      />
    </>
  );
}
