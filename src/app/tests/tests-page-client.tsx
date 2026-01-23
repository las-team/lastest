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
import { generateBasicTests } from '@/server/actions/scanner';
import { CoverageBar } from '@/components/coverage/coverage-bar';
import { RouteSelectorDialog } from '@/components/routes/route-selector-dialog';
import { AICreateTestDialog } from '@/components/ai/ai-create-test-dialog';
import { MCPCreateTestDialog } from '@/components/ai/mcp-create-test-dialog';
import { FileCode, Plus, FlaskConical, Sparkles, Wand2 } from 'lucide-react';
import Link from 'next/link';
import type { FunctionalArea, Test, Route } from '@/lib/db/schema';

interface TestWithStatus extends Test {
  latestStatus: string | null;
}

interface TestsPageClientProps {
  areas: FunctionalArea[];
  tests: TestWithStatus[];
  routes: Route[];
  coverage: { total: number; withTests: number; percentage: number };
  repositoryId?: string;
  baseUrl?: string;
}

export function TestsPageClient({ areas, tests, routes, coverage, repositoryId, baseUrl = 'http://localhost:3000' }: TestsPageClientProps) {
  const [isNewAreaOpen, setIsNewAreaOpen] = useState(false);
  const [newAreaName, setNewAreaName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isAddTestsOpen, setIsAddTestsOpen] = useState(false);
  const [isAICreateOpen, setIsAICreateOpen] = useState(false);
  const [isMCPCreateOpen, setIsMCPCreateOpen] = useState(false);
  const [showAllTests, setShowAllTests] = useState(false);

  const handleCreateArea = async () => {
    if (!newAreaName.trim()) return;

    setIsCreating(true);
    try {
      await createFunctionalArea({ name: newAreaName.trim(), repositoryId });
      setNewAreaName('');
      setIsNewAreaOpen(false);
    } finally {
      setIsCreating(false);
    }
  };

  const handleAddTests = async (routeIds: string[]) => {
    if (!repositoryId) return;
    // Use localhost:3000 as default base URL for now
    await generateBasicTests(repositoryId, routeIds, 'http://localhost:3000');
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
        <div className="max-w-3xl space-y-6">
          {/* Coverage Bar */}
          {coverage.total > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Route Coverage</CardTitle>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsAddTestsOpen(true)}
                      disabled={routes.filter(r => !r.hasTest).length === 0}
                    >
                      <FlaskConical className="h-4 w-4 mr-2" />
                      Add Basic Tests
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <CoverageBar covered={coverage.withTests} total={coverage.total} />
              </CardContent>
            </Card>
          )}

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
                    <div className="flex gap-2">
                      {repositoryId && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setIsAICreateOpen(true)}
                          >
                            <Sparkles className="h-4 w-4 mr-2" />
                            Create with AI
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setIsMCPCreateOpen(true)}
                          >
                            <Wand2 className="h-4 w-4 mr-2" />
                            Create with MCP
                          </Button>
                        </>
                      )}
                      <Button asChild size="sm">
                        <Link href="/record">
                          <Plus className="h-4 w-4 mr-2" />
                          Record New Test
                        </Link>
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    {(showAllTests ? tests : tests.slice(0, 5)).map((test) => (
                      <Link
                        key={test.id}
                        href={`/tests/${test.id}`}
                        className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <FileCode className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <div className="font-medium">{test.name}</div>
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
                    <div className="text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowAllTests(!showAllTests)}
                        className="text-muted-foreground"
                      >
                        {showAllTests ? 'Show less' : `+${tests.length - 5} more tests`}
                      </Button>
                    </div>
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

      {/* Add Basic Tests Dialog */}
      <RouteSelectorDialog
        open={isAddTestsOpen}
        onOpenChange={setIsAddTestsOpen}
        routes={routes.filter(r => !r.hasTest)}
        title="Generate Basic Tests"
        description="Select routes to generate smoke tests for (visit, screenshot, check errors)"
        actionLabel="Generate Tests"
        onAction={handleAddTests}
      />

      {/* AI Create Test Dialog */}
      {repositoryId && (
        <AICreateTestDialog
          open={isAICreateOpen}
          onOpenChange={setIsAICreateOpen}
          repositoryId={repositoryId}
          areas={areas}
        />
      )}

      {/* MCP Create Test Dialog */}
      {repositoryId && (
        <MCPCreateTestDialog
          open={isMCPCreateOpen}
          onOpenChange={setIsMCPCreateOpen}
          repositoryId={repositoryId}
          areas={areas}
          baseUrl={baseUrl}
        />
      )}
    </div>
  );
}
