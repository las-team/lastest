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
import { Plus, Globe, MoreVertical, Edit2, Trash2, Play, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { ApiConfigForm } from './api-config-form';
import { deleteSetupConfig, testSetupConfig } from '@/server/actions/setup-configs';
import { toast } from 'sonner';
import type { SetupConfig } from '@/lib/db/schema';

interface ApiConfigListProps {
  repositoryId: string;
  configs: SetupConfig[];
}

export function ApiConfigList({ repositoryId, configs }: ApiConfigListProps) {
  const router = useRouter();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<SetupConfig | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Map<string, boolean>>(new Map());

  const handleCreate = () => {
    setEditingConfig(null);
    setIsFormOpen(true);
  };

  const handleEdit = (config: SetupConfig) => {
    setEditingConfig(config);
    setIsFormOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this API config?')) return;

    setDeletingId(id);
    try {
      await deleteSetupConfig(id);
      toast.success('API config deleted');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete config');
    } finally {
      setDeletingId(null);
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const result = await testSetupConfig(id);
      setTestResults(prev => new Map(prev).set(id, result.success));
      if (result.success) {
        toast.success('Connection successful');
      } else {
        toast.error(result.error || 'Connection failed');
      }
    } catch (error) {
      setTestResults(prev => new Map(prev).set(id, false));
      toast.error(error instanceof Error ? error.message : 'Failed to test connection');
    } finally {
      setTestingId(null);
    }
  };

  const handleFormClose = () => {
    setIsFormOpen(false);
    setEditingConfig(null);
    router.refresh();
  };

  const getAuthBadge = (authType: string) => {
    switch (authType) {
      case 'bearer':
        return <Badge variant="secondary">Bearer</Badge>;
      case 'basic':
        return <Badge variant="secondary">Basic</Badge>;
      case 'custom':
        return <Badge variant="secondary">Custom</Badge>;
      default:
        return <Badge variant="outline">None</Badge>;
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>API Configurations</CardTitle>
            <CardDescription>
              Configure API endpoints for data seeding and authentication.
            </CardDescription>
          </div>
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            New Config
          </Button>
        </CardHeader>
        <CardContent>
          {configs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Globe className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="mb-2">No API configurations yet</p>
              <p className="text-sm">Create a config to enable API-based setup.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {configs.map((config) => {
                const testResult = testResults.get(config.id);
                return (
                  <div
                    key={config.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Globe className="h-5 w-5 text-green-500 shrink-0" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{config.name}</span>
                          {getAuthBadge(config.authType)}
                          {testResult !== undefined && (
                            testResult ? (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            ) : (
                              <XCircle className="h-4 w-4 text-red-500" />
                            )
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground truncate mt-0.5">
                          {config.baseUrl}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleTest(config.id)}
                        disabled={testingId === config.id}
                      >
                        {testingId === config.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEdit(config)}>
                            <Edit2 className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleDelete(config.id)}
                            disabled={deletingId === config.id}
                            className="text-destructive focus:text-destructive"
                          >
                            {deletingId === config.id ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4 mr-2" />
                            )}
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <ApiConfigForm
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        onClose={handleFormClose}
        repositoryId={repositoryId}
        editConfig={editingConfig}
      />
    </>
  );
}
