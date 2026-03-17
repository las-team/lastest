'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Plus, Search, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SuiteTestItem } from './suite-test-item';
import { addTestsToSuite, removeTestFromSuite, reorderSuiteTests } from '@/server/actions/suites';
import type { FunctionalArea } from '@/lib/db/schema';

interface SuiteTest {
  id: string;
  suiteId: string;
  testId: string;
  orderIndex: number;
  testName: string;
  testCode: string;
  targetUrl: string | null;
  functionalAreaId: string | null;
}

interface TestWithStatus {
  id: string;
  name: string;
  code: string;
  targetUrl: string | null;
  functionalAreaId: string | null;
  latestStatus: string | null;
  area: FunctionalArea | null;
}

interface TestResult {
  testId: string | null;
  status: string | null;
  errorMessage: string | null;
  durationMs: number | null;
}

interface RunProgress {
  status: string | null;
  completedAt: Date | null;
  results: TestResult[];
}

interface SuiteBuilderProps {
  suiteId: string;
  suiteTests: SuiteTest[];
  availableTests: TestWithStatus[];
  areas: FunctionalArea[];
  isRunning?: boolean;
  runProgress?: RunProgress | null;
  completedCount?: number;
}

export function SuiteBuilder({ suiteId, suiteTests, availableTests, areas, isRunning, runProgress, completedCount = 0 }: SuiteBuilderProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [orderedTests, setOrderedTests] = useState(suiteTests);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedAreas, setExpandedAreas] = useState<Set<string>>(new Set());

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setOrderedTests(suiteTests);
  }, [suiteTests]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Group available tests by functional area
  const groupedTests = useMemo(() => {
    // Tests already in suite
    const suiteTestIds = new Set(orderedTests.map((t) => t.testId));
    const filtered = availableTests.filter(
      (t) =>
        !suiteTestIds.has(t.id) &&
        t.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const groups: Map<string, { area: FunctionalArea | null; tests: TestWithStatus[] }> = new Map();
    groups.set('__uncategorized__', { area: null, tests: [] });

    for (const test of filtered) {
      const areaId = test.functionalAreaId || '__uncategorized__';
      if (!groups.has(areaId)) {
        const area = areas.find((a) => a.id === areaId) || null;
        groups.set(areaId, { area, tests: [] });
      }
      groups.get(areaId)!.tests.push(test);
    }

    // Remove empty groups
    for (const [key, value] of groups) {
      if (value.tests.length === 0) groups.delete(key);
    }

    return groups;
  }, [availableTests, orderedTests, searchQuery, areas]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = orderedTests.findIndex((t) => t.testId === active.id);
    const newIndex = orderedTests.findIndex((t) => t.testId === over.id);

    const newOrder = arrayMove(orderedTests, oldIndex, newIndex);
    setOrderedTests(newOrder);

    // Persist reorder
    await reorderSuiteTests(suiteId, newOrder.map((t) => t.testId));
  };

  const handleAddTest = async (testId: string) => {
    await addTestsToSuite(suiteId, [testId]);
    router.refresh();
  };

  const handleRemoveTest = async (testId: string) => {
    await removeTestFromSuite(suiteId, testId);
    router.refresh();
  };

  const toggleArea = (areaId: string) => {
    const next = new Set(expandedAreas);
    if (next.has(areaId)) {
      next.delete(areaId);
    } else {
      next.add(areaId);
    }
    setExpandedAreas(next);
  };

  // Build a map of test results by testId
  const resultsByTestId = new Map(
    runProgress?.results.map((r) => [r.testId, r]) ?? []
  );

  if (!mounted) {
    return (
      <div className="flex-1 flex gap-4 p-6 overflow-hidden">
        <div className="w-1/2 border rounded-lg p-4">Loading...</div>
        <div className="w-1/2 border rounded-lg p-4">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex gap-4 p-6 overflow-hidden">
      {/* Available Tests Panel */}
      <div className="w-1/2 border rounded-lg flex flex-col bg-card">
        <div className="p-4 border-b">
          <h3 className="font-medium mb-3">Available Tests</h3>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search tests..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-2">
          {groupedTests.size === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {searchQuery ? 'No tests match your search' : 'All tests are in the suite'}
            </p>
          ) : (
            Array.from(groupedTests.entries()).map(([areaId, { area, tests }]) => (
              <div key={areaId} className="border rounded-lg">
                <button
                  className="w-full flex items-center gap-2 p-3 text-left hover:bg-muted/50 transition-colors"
                  onClick={() => toggleArea(areaId)}
                >
                  <ChevronRight
                    className={`w-4 h-4 transition-transform ${
                      expandedAreas.has(areaId) ? 'rotate-90' : ''
                    }`}
                  />
                  <span className="font-medium text-sm">
                    {area?.name || 'Uncategorized'}
                  </span>
                  <Badge variant="secondary" className="ml-auto">
                    {tests.length}
                  </Badge>
                </button>
                {expandedAreas.has(areaId) && (
                  <div className="border-t divide-y">
                    {tests.map((test) => (
                      <div
                        key={test.id}
                        className="flex items-center gap-3 p-3 hover:bg-muted/30"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{test.name}</p>
                          {test.targetUrl && (
                            <p className="text-xs text-muted-foreground truncate">
                              {test.targetUrl}
                            </p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleAddTest(test.id)}
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Suite Tests Panel (Sortable) */}
      <div className="w-1/2 border rounded-lg flex flex-col bg-card">
        <div className="p-4 border-b">
          <h3 className="font-medium">Suite Tests</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Drag to reorder. Tests run in this order.
          </p>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {orderedTests.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Add tests from the left panel
            </p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={orderedTests.map((t) => t.testId)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {orderedTests.map((test, index) => {
                    const result = resultsByTestId.get(test.testId);
                    const isCurrent = isRunning && !result && index === completedCount;
                    return (
                      <SuiteTestItem
                        key={test.testId}
                        test={test}
                        index={index}
                        onRemove={() => handleRemoveTest(test.testId)}
                        isRunning={isRunning}
                        isCurrent={isCurrent}
                        status={result?.status ?? null}
                        durationMs={result?.durationMs ?? null}
                        disabled={isRunning}
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>
    </div>
  );
}
