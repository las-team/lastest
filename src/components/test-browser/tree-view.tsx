'use client';

import { useState } from 'react';
import { ChevronRight, ChevronDown, Folder, FileCode, Check, X, Pause, Plus, Lightbulb, CircleDot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import Link from 'next/link';
import type { FunctionalArea, Test } from '@/lib/db/schema';

interface TestWithStatus extends Test {
  latestStatus: string | null;
}

interface TestSuggestion {
  id: string;
  suggestion: string;
  matchedTestId: string | null;
  matchedTestName?: string | null;
  routePath?: string | null;
}

interface TreeViewProps {
  areas: FunctionalArea[];
  tests: TestWithStatus[];
  suggestions?: TestSuggestion[];
  onNewArea?: () => void;
}

function StatusIcon({ status }: { status: string | null }) {
  switch (status) {
    case 'passed':
      return <Check className="h-3 w-3 text-green-500" />;
    case 'failed':
      return <X className="h-3 w-3 text-destructive" />;
    case 'running':
      return <Pause className="h-3 w-3 text-yellow-500" />;
    default:
      return <div className="h-3 w-3 rounded-full bg-muted" />;
  }
}

export function TreeView({ areas, tests, suggestions = [], onNewArea }: TreeViewProps) {
  const [expandedAreas, setExpandedAreas] = useState<Set<string>>(new Set());
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(true);

  const toggleArea = (areaId: string) => {
    const newExpanded = new Set(expandedAreas);
    if (newExpanded.has(areaId)) {
      newExpanded.delete(areaId);
    } else {
      newExpanded.add(areaId);
    }
    setExpandedAreas(newExpanded);
  };

  const testsByArea = tests.reduce((acc, test) => {
    const areaId = test.functionalAreaId || 'uncategorized';
    if (!acc[areaId]) acc[areaId] = [];
    acc[areaId].push(test);
    return acc;
  }, {} as Record<string, TestWithStatus[]>);

  const uncategorizedTests = testsByArea['uncategorized'] || [];

  const unmatchedSuggestions = suggestions.filter(s => !s.matchedTestId);
  const matchedSuggestions = suggestions.filter(s => s.matchedTestId);

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b font-medium text-sm">Test Browser</div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {/* Suggested Tests Section */}
          {suggestions.length > 0 && (
            <div className="mb-3">
              <button
                onClick={() => setSuggestionsExpanded(!suggestionsExpanded)}
                className="flex items-center gap-2 w-full px-2 py-1.5 rounded hover:bg-muted text-sm bg-amber-500/10 border border-amber-500/20"
              >
                {suggestionsExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                <Lightbulb className="h-4 w-4 text-amber-500" />
                <span className="flex-1 text-left font-medium">Suggested Tests</span>
                <span className="text-xs text-muted-foreground">
                  {unmatchedSuggestions.length} remaining
                </span>
              </button>

              {suggestionsExpanded && (
                <div className="ml-4 pl-2 border-l border-amber-500/20 mt-1">
                  {unmatchedSuggestions.map((suggestion) => (
                    <div
                      key={suggestion.id}
                      className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground"
                    >
                      <CircleDot className="h-3 w-3 text-amber-500" />
                      <span className="truncate">{suggestion.suggestion}</span>
                    </div>
                  ))}
                  {matchedSuggestions.map((suggestion) => (
                    <div
                      key={suggestion.id}
                      className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground/60"
                    >
                      <Check className="h-3 w-3 text-green-500" />
                      <span className="truncate line-through">{suggestion.suggestion}</span>
                      {suggestion.matchedTestName && (
                        <span className="text-xs text-green-600">
                          → {suggestion.matchedTestName}
                        </span>
                      )}
                    </div>
                  ))}
                  {suggestions.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      No suggestions
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {areas.map((area) => {
            const areaTests = testsByArea[area.id] || [];
            const isExpanded = expandedAreas.has(area.id);

            return (
              <div key={area.id} className="mb-1">
                <button
                  onClick={() => toggleArea(area.id)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 rounded hover:bg-muted text-sm"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <Folder className="h-4 w-4 text-primary" />
                  <span className="flex-1 text-left">{area.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {areaTests.length}
                  </span>
                </button>

                {isExpanded && (
                  <div className="ml-4 pl-2 border-l">
                    {areaTests.map((test) => (
                      <Link
                        key={test.id}
                        href={`/tests/${test.id}`}
                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted text-sm"
                      >
                        <StatusIcon status={test.latestStatus} />
                        <FileCode className="h-4 w-4 text-muted-foreground" />
                        <span className="truncate">{test.name}</span>
                      </Link>
                    ))}
                    {areaTests.length === 0 && (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        No tests
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {uncategorizedTests.length > 0 && (
            <div className="mb-1">
              <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
                <Folder className="h-4 w-4" />
                <span>Uncategorized</span>
              </div>
              <div className="ml-4 pl-2 border-l">
                {uncategorizedTests.map((test) => (
                  <Link
                    key={test.id}
                    href={`/tests/${test.id}`}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted text-sm"
                  >
                    <StatusIcon status={test.latestStatus} />
                    <FileCode className="h-4 w-4 text-muted-foreground" />
                    <span className="truncate">{test.name}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {areas.length === 0 && uncategorizedTests.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <FileCode className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No tests yet</p>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="p-2 border-t">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={onNewArea}
        >
          <Plus className="h-4 w-4 mr-2" />
          New Area
        </Button>
      </div>
    </div>
  );
}
