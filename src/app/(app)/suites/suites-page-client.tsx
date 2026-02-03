'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Play, Trash2, Pencil, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { CreateSuiteDialog } from '@/components/suites/create-suite-dialog';
import { deleteSuite, runSuite } from '@/server/actions/suites';
import { useNotifyJobStarted } from '@/components/queue/job-polling-context';
import type { Suite } from '@/lib/db/schema';

interface SuitesPageClientProps {
  suites: Suite[];
  repositoryId?: string;
}

export function SuitesPageClient({ suites, repositoryId }: SuitesPageClientProps) {
  const router = useRouter();
  const notifyJobStarted = useNotifyJobStarted();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete suite "${name}"?`)) return;
    await deleteSuite(id);
    router.refresh();
  };

  const handleRun = async (id: string) => {
    setRunningId(id);
    try {
      await runSuite(id);
      notifyJobStarted();
      router.push('/run');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to run suite');
    } finally {
      setRunningId(null);
    }
  };

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold">Test Suites</h2>
          <p className="text-sm text-muted-foreground">
            Organize tests into ordered collections for targeted execution
          </p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Suite
        </Button>
      </div>

      {suites.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Layers className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No suites yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create a suite to group and order your tests
            </p>
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Suite
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {suites.map((suite) => (
            <Card key={suite.id} className="group hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <Link href={`/suites/${suite.id}`} className="flex-1 min-w-0">
                    <CardTitle className="text-base truncate hover:text-primary transition-colors">
                      {suite.name}
                    </CardTitle>
                  </Link>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleRun(suite.id)}
                      disabled={runningId === suite.id}
                    >
                      <Play className="w-4 h-4" />
                    </Button>
                    <Link href={`/suites/${suite.id}`}>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <Pencil className="w-4 h-4" />
                      </Button>
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => handleDelete(suite.id, suite.name)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                {suite.description && (
                  <CardDescription className="line-clamp-2">
                    {suite.description}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Created {suite.createdAt?.toLocaleDateString()}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CreateSuiteDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        repositoryId={repositoryId}
      />
    </div>
  );
}
