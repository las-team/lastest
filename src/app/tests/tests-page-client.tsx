'use client';

import { useState } from 'react';
import { TreeView } from '@/components/test-browser/tree-view';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createFunctionalArea } from '@/server/actions/tests';
import { FileCode, Plus } from 'lucide-react';
import Link from 'next/link';
import type { FunctionalArea, Test } from '@/lib/db/schema';

interface TestWithStatus extends Test {
  latestStatus: string | null;
}

interface TestsPageClientProps {
  areas: FunctionalArea[];
  tests: TestWithStatus[];
}

export function TestsPageClient({ areas, tests }: TestsPageClientProps) {
  const [isNewAreaOpen, setIsNewAreaOpen] = useState(false);
  const [newAreaName, setNewAreaName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateArea = async () => {
    if (!newAreaName.trim()) return;

    setIsCreating(true);
    try {
      await createFunctionalArea({ name: newAreaName.trim() });
      setNewAreaName('');
      setIsNewAreaOpen(false);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left Sidebar - Test Browser */}
      <div className="w-64 border-r bg-muted/30">
        <TreeView
          areas={areas}
          tests={tests}
          onNewArea={() => setIsNewAreaOpen(true)}
        />
      </div>

      {/* Main Content */}
      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-3xl">
          <Card>
            <CardHeader>
              <CardTitle>Tests Overview</CardTitle>
              <CardDescription>
                Select a test from the sidebar or create a new one
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tests.length === 0 ? (
                <div className="text-center py-8">
                  <FileCode className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <p className="text-muted-foreground mb-4">No tests created yet</p>
                  <Button asChild>
                    <Link href="/record">
                      <Plus className="h-4 w-4 mr-2" />
                      Record First Test
                    </Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">
                      {tests.length} test{tests.length !== 1 ? 's' : ''} total
                    </span>
                    <Button asChild size="sm">
                      <Link href="/record">
                        <Plus className="h-4 w-4 mr-2" />
                        Record New Test
                      </Link>
                    </Button>
                  </div>

                  <div className="grid gap-2">
                    {tests.slice(0, 5).map((test) => (
                      <Link
                        key={test.id}
                        href={`/tests/${test.id}`}
                        className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <FileCode className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <div className="font-medium">{test.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {test.pathType} path
                            </div>
                          </div>
                        </div>
                        <div className={`text-xs px-2 py-1 rounded ${
                          test.latestStatus === 'passed'
                            ? 'bg-green-100 text-green-700'
                            : test.latestStatus === 'failed'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-muted text-muted-foreground'
                        }`}>
                          {test.latestStatus || 'Not run'}
                        </div>
                      </Link>
                    ))}
                  </div>

                  {tests.length > 5 && (
                    <p className="text-sm text-muted-foreground text-center">
                      +{tests.length - 5} more tests
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* New Area Dialog */}
      <Dialog open={isNewAreaOpen} onOpenChange={setIsNewAreaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Functional Area</DialogTitle>
            <DialogDescription>
              Group your tests by functional area (e.g., auth, checkout, dashboard)
            </DialogDescription>
          </DialogHeader>

          <Input
            placeholder="Area name"
            value={newAreaName}
            onChange={(e) => setNewAreaName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateArea()}
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsNewAreaOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateArea} disabled={isCreating || !newAreaName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
