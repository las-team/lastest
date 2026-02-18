'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle,
  Circle,
  ExternalLink,
  RotateCcw,
  ClipboardCheck,
  XCircle,
  AlertTriangle,
  ListTodo,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BranchSelector } from '@/components/settings/branch-selector';
import { resolveReviewTodo, reopenReviewTodo } from '@/server/actions/todos';
import type { VisualDiffWithTestStatus } from '@/lib/db/schema';

interface TodoRow {
  todo: {
    id: string;
    repositoryId: string | null;
    diffId: string | null;
    buildId: string | null;
    testId: string | null;
    branch: string;
    description: string;
    status: string;
    createdBy: string | null;
    resolvedBy: string | null;
    resolvedAt: Date | null;
    createdAt: Date | null;
  };
  testName: string | null;
  functionalAreaName: string | null;
}

interface ReviewClientProps {
  repositoryId: string | null;
  currentBranch: string | null;
  defaultBranch: string | null;
  initialTodos: TodoRow[];
  initialDiffs: VisualDiffWithTestStatus[];
  latestBuildId: string | null;
}

export function ReviewClient({
  repositoryId,
  currentBranch,
  defaultBranch,
  initialTodos,
  initialDiffs,
  latestBuildId,
}: ReviewClientProps) {
  const router = useRouter();
  const [todos, setTodos] = useState<TodoRow[]>(initialTodos);

  const handleResolve = async (todoId: string) => {
    await resolveReviewTodo(todoId);
    setTodos(prev => prev.map(t =>
      t.todo.id === todoId ? { ...t, todo: { ...t.todo, status: 'resolved' } } : t
    ));
    router.refresh();
  };

  const handleReopen = async (todoId: string) => {
    await reopenReviewTodo(todoId);
    setTodos(prev => prev.map(t =>
      t.todo.id === todoId ? { ...t, todo: { ...t.todo, status: 'open' } } : t
    ));
    router.refresh();
  };

  const openTodos = todos.filter(t => t.todo.status === 'open');
  const resolvedTodos = todos.filter(t => t.todo.status === 'resolved');

  // Group diffs by functional area for branch overview
  const byArea: Record<string, {
    diffs: VisualDiffWithTestStatus[];
    passed: number;
    failed: number;
    todo: number;
    pending: number;
    approved: number;
  }> = {};

  for (const diff of initialDiffs) {
    const area = diff.functionalAreaName || 'Ungrouped';
    if (!byArea[area]) byArea[area] = { diffs: [], passed: 0, failed: 0, todo: 0, pending: 0, approved: 0 };
    byArea[area].diffs.push(diff);

    const isFailed = diff.testResultStatus === 'failed' || diff.status === 'rejected';
    if (isFailed) byArea[area].failed++;
    else if (diff.status === 'todo') byArea[area].todo++;
    else if (diff.status === 'pending') byArea[area].pending++;
    else if (diff.status === 'approved' || diff.status === 'auto_approved') byArea[area].approved++;
    else byArea[area].passed++;
  }

  const sortedAreas = Object.entries(byArea).sort(
    ([, a], [, b]) => (b.failed + b.todo) - (a.failed + a.todo)
  );

  // Summary counts
  const totalDiffs = initialDiffs.length;
  const totalFailed = initialDiffs.filter(d => d.testResultStatus === 'failed' || d.status === 'rejected').length;
  const totalTodo = initialDiffs.filter(d => d.status === 'todo').length;
  const totalPending = initialDiffs.filter(d => d.status === 'pending').length;
  const totalApproved = initialDiffs.filter(d => d.status === 'approved' || d.status === 'auto_approved').length;

  if (!repositoryId) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Select a repository to view review todos.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Review</h1>
          <p className="text-sm text-muted-foreground mt-1">Track review todos and branch status</p>
        </div>
        <BranchSelector
          repositoryId={repositoryId}
          currentBranch={currentBranch}
          defaultBranch={defaultBranch}
        />
      </div>

      {/* Section 1: Developer Todos */}
      <div>
        <h2 className="text-lg font-semibold mb-3">
          Developer Todos
          {openTodos.length > 0 && (
            <Badge variant="secondary" className="ml-2">{openTodos.length} open</Badge>
          )}
        </h2>

        {todos.length === 0 ? (
          <div className="border rounded-lg p-8 text-center text-muted-foreground space-y-2">
            <ClipboardCheck className="w-8 h-8 mx-auto opacity-40" />
            <p className="text-sm">No todos for this branch. Todos appear when reviewers flag diffs.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {openTodos.map(({ todo, testName, functionalAreaName }) => (
              <div key={todo.id} className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/30 transition-colors">
                <button
                  onClick={() => handleResolve(todo.id)}
                  className="flex-shrink-0 text-amber-500 hover:text-green-600 transition-colors"
                  title="Mark as resolved"
                >
                  <Circle className="w-5 h-5" />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{todo.description}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    {testName && <span>{testName}</span>}
                    {functionalAreaName && (
                      <>
                        <span className="text-muted-foreground/40">&middot;</span>
                        <span className="text-primary">{functionalAreaName}</span>
                      </>
                    )}
                  </div>
                </div>
                {todo.diffId && todo.buildId && (
                  <a
                    href={`/builds/${todo.buildId}/diff/${todo.diffId}`}
                    className="text-muted-foreground hover:text-primary transition-colors"
                    title="View diff"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>
            ))}

            {resolvedTodos.length > 0 && (
              <div className="pt-2">
                <p className="text-xs text-muted-foreground mb-2">Resolved ({resolvedTodos.length})</p>
                {resolvedTodos.map(({ todo, testName, functionalAreaName }) => (
                  <div key={todo.id} className="flex items-center gap-3 p-3 border rounded-lg opacity-60">
                    <button
                      onClick={() => handleReopen(todo.id)}
                      className="flex-shrink-0 text-green-500 hover:text-amber-500 transition-colors"
                      title="Reopen"
                    >
                      <CheckCircle className="w-5 h-5" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm line-through">{todo.description}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        {testName && <span>{testName}</span>}
                        {functionalAreaName && (
                          <>
                            <span className="text-muted-foreground/40">&middot;</span>
                            <span>{functionalAreaName}</span>
                          </>
                        )}
                        {todo.resolvedBy && <span>&middot; by {todo.resolvedBy}</span>}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleReopen(todo.id)}
                      className="text-xs"
                    >
                      <RotateCcw className="w-3 h-3 mr-1" />
                      Reopen
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Section 2: Branch Overview — all tests from latest build */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Branch Overview</h2>
          {latestBuildId && (
            <a href={`/builds/${latestBuildId}`} className="text-sm text-primary hover:underline flex items-center gap-1">
              View build <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>

        {totalDiffs === 0 ? (
          <div className="border rounded-lg p-8 text-center text-muted-foreground">
            <p className="text-sm">No builds found for this branch yet.</p>
          </div>
        ) : (
          <>
            {/* Summary bar */}
            <div className="flex items-center gap-4 mb-4 text-sm">
              <span className="text-muted-foreground">{totalDiffs} tests</span>
              {totalApproved > 0 && <span className="text-green-600">{totalApproved} expected</span>}
              {totalPending > 0 && <span className="text-yellow-600">{totalPending} pending</span>}
              {totalTodo > 0 && <span className="text-amber-600">{totalTodo} todos</span>}
              {totalFailed > 0 && <span className="text-red-600">{totalFailed} failed</span>}
            </div>

            <div className="space-y-2">
              {sortedAreas.map(([areaName, data]) => (
                <details key={areaName} className="border rounded-lg" open={data.failed > 0 || data.todo > 0}>
                  <summary className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{areaName}</span>
                      <Badge variant="secondary" className="text-xs">{data.diffs.length}</Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      {data.approved > 0 && <span className="text-green-600">{data.approved} expected</span>}
                      {data.pending > 0 && <span className="text-yellow-600">{data.pending} pending</span>}
                      {data.todo > 0 && <span className="text-amber-600">{data.todo} todos</span>}
                      {data.failed > 0 && <span className="text-red-600">{data.failed} failed</span>}
                      {data.passed > 0 && <span className="text-muted-foreground">{data.passed} passed</span>}
                    </div>
                  </summary>
                  <div className="border-t px-3 py-2 space-y-1">
                    {data.diffs.map((diff) => {
                      const isFailed = diff.testResultStatus === 'failed' || diff.status === 'rejected';
                      return (
                        <a
                          key={diff.id}
                          href={latestBuildId ? `/builds/${latestBuildId}/diff/${diff.id}` : '#'}
                          className="flex items-center gap-2 py-1.5 text-sm hover:bg-muted/30 rounded px-1 -mx-1 transition-colors"
                        >
                          {isFailed ? (
                            <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                          ) : diff.status === 'todo' ? (
                            <ListTodo className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                          ) : diff.status === 'pending' ? (
                            <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" />
                          ) : (
                            <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                          )}
                          <span className={isFailed ? 'text-red-700' : ''}>
                            {diff.testName || 'Unnamed Test'}
                            {diff.stepLabel && (
                              <span className="text-muted-foreground font-normal"> &rsaquo; {diff.stepLabel}</span>
                            )}
                          </span>
                          {diff.currentImagePath && (
                            <img
                              src={diff.currentImagePath}
                              alt=""
                              className="w-12 h-7 object-cover rounded border ml-auto flex-shrink-0"
                            />
                          )}
                        </a>
                      );
                    })}
                  </div>
                </details>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
