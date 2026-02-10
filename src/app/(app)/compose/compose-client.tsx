'use client';

import { useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Layers, ChevronRight, ChevronsUpDown, GitBranch, Info } from 'lucide-react';
import type { Test, TestVersion } from '@/lib/db/schema';

interface TestWithVersions extends Test {
  versions: TestVersion[];
  functionalAreaName: string | null;
}

interface MainBuildTest {
  testId: string | null;
  testName: string | null;
  functionalAreaName: string | null;
  testVersionId: string | null;
  versionNumber: number | null;
  versionReason: string | null;
  isLatest: boolean;
  status: string | null;
  avgDiffPct: number | null;
}

interface MainBuild {
  id: string;
  gitBranch: string | null;
  gitCommit: string | null;
  totalTests: number | null;
  passedCount: number | null;
  createdAt: Date | null;
}

interface ComposeClientProps {
  tests: TestWithVersions[];
  defaultBranch: string;
  mainBuild: MainBuild | null;
  mainBuildTests: MainBuildTest[];
}

export function ComposeClient({ tests, defaultBranch, mainBuild, mainBuildTests }: ComposeClientProps) {
  const [selectedTestIds, setSelectedTestIds] = useState<Set<string>>(new Set(tests.map(t => t.id)));
  const [versionOverrides, setVersionOverrides] = useState<Record<string, number>>({});
  const [groupByArea, setGroupByArea] = useState(false);
  const [expandKey, setExpandKey] = useState(0);
  const [allExpanded, setAllExpanded] = useState(true);

  const toggleExpandAll = useCallback(() => {
    setAllExpanded(prev => !prev);
    setExpandKey(prev => prev + 1);
  }, []);

  // Canonical sort order: by area name then test name
  const testOrder = useMemo(() => {
    const map = new Map<string, number>();
    const sorted = [...tests].sort((a, b) => {
      const aArea = a.functionalAreaName || 'Ungrouped';
      const bArea = b.functionalAreaName || 'Ungrouped';
      if (aArea === 'Ungrouped' && bArea !== 'Ungrouped') return 1;
      if (bArea === 'Ungrouped' && aArea !== 'Ungrouped') return -1;
      const areaCmp = aArea.localeCompare(bArea);
      if (areaCmp !== 0) return areaCmp;
      return (a.name || '').localeCompare(b.name || '');
    });
    sorted.forEach((t, i) => map.set(t.id, i));
    return map;
  }, [tests]);

  // Sort + group right-column tests
  const sortedTests = useMemo(() =>
    [...tests].sort((a, b) => (testOrder.get(a.id) ?? 0) - (testOrder.get(b.id) ?? 0)),
    [tests, testOrder]
  );

  const groupedTests = useMemo(() => {
    const groups: Record<string, TestWithVersions[]> = {};
    for (const test of sortedTests) {
      const area = test.functionalAreaName || 'Ungrouped';
      (groups[area] ||= []).push(test);
    }
    return Object.entries(groups).sort(([a], [b]) =>
      a === 'Ungrouped' ? 1 : b === 'Ungrouped' ? -1 : a.localeCompare(b)
    );
  }, [sortedTests]);

  // Sort + group left-column main build tests in the same order
  const sortedMainTests = useMemo(() =>
    [...mainBuildTests].sort((a, b) => {
      const ai = a.testId ? (testOrder.get(a.testId) ?? Infinity) : Infinity;
      const bi = b.testId ? (testOrder.get(b.testId) ?? Infinity) : Infinity;
      return ai - bi;
    }),
    [mainBuildTests, testOrder]
  );

  const groupedMainTests = useMemo(() => {
    const groups: Record<string, MainBuildTest[]> = {};
    for (const t of sortedMainTests) {
      const area = t.functionalAreaName || 'Ungrouped';
      (groups[area] ||= []).push(t);
    }
    return Object.entries(groups).sort(([a], [b]) =>
      a === 'Ungrouped' ? 1 : b === 'Ungrouped' ? -1 : a.localeCompare(b)
    );
  }, [sortedMainTests]);

  const toggleTest = (testId: string) => {
    setSelectedTestIds(prev => {
      const next = new Set(prev);
      if (next.has(testId)) next.delete(testId);
      else next.add(testId);
      return next;
    });
  };

  const allSelected = tests.length > 0 && tests.every(t => selectedTestIds.has(t.id));
  const toggleAll = () => {
    if (allSelected) setSelectedTestIds(new Set());
    else setSelectedTestIds(new Set(tests.map(t => t.id)));
  };

  const handleVersionSlider = (testId: string, value: number) => {
    setVersionOverrides(prev => {
      if (value === 0) {
        const next = { ...prev };
        delete next[testId];
        return next;
      }
      return { ...prev, [testId]: value };
    });
  };

  const getVersionLabel = (test: TestWithVersions, sliderValue: number) => {
    if (sliderValue === 0) return 'Latest';
    const version = test.versions[sliderValue - 1];
    if (!version) return 'Latest';
    const reason = version.changeReason?.replace(/_/g, ' ') || '';
    return `v${version.version}${reason ? ` - ${reason}` : ''}`;
  };

  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Layers className="h-5 w-5" />
              Compose Build
            </h1>
            <p className="text-sm text-muted-foreground">
              Compare main branch baseline with your build configuration
            </p>
          </div>
          <div className="flex items-center gap-2">
            {groupByArea && (
              <button
                onClick={toggleExpandAll}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronsUpDown className="w-3.5 h-3.5" />
                {allExpanded ? 'Collapse' : 'Expand'}
              </button>
            )}
            <button
              onClick={() => setGroupByArea(v => !v)}
              className={`inline-flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
                groupByArea
                  ? 'bg-primary/10 text-primary border-primary/30'
                  : 'bg-muted text-muted-foreground border-transparent hover:text-foreground'
              }`}
            >
              <Layers className="w-4 h-4" />
              Group by Area
            </button>
          </div>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column - Main Branch Baseline */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Main Branch</CardTitle>
                  <CardDescription className="text-xs">
                    Last build on default branch
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-xs gap-1">
                  <GitBranch className="h-3 w-3" />
                  {defaultBranch}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {!mainBuild ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Info className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No builds on main branch yet</p>
                </div>
              ) : !groupByArea ? (
                <div className="space-y-1">
                  {sortedMainTests.map((t) => (
                    <MainTestRow key={t.testId ?? t.testVersionId} test={t} />
                  ))}
                  {sortedMainTests.length === 0 && (
                    <p className="text-sm text-muted-foreground py-4 text-center">No tests in this build</p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {groupedMainTests.map(([areaName, areaTests]) => (
                    <Collapsible key={`main-${areaName}-${expandKey}`} defaultOpen={allExpanded}>
                      <div>
                        <CollapsibleTrigger className="flex items-center justify-between w-full p-2 bg-muted/30 hover:bg-muted/50 rounded transition-colors group">
                          <div className="flex items-center gap-2">
                            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
                            <span className="font-medium text-xs">{areaName}</span>
                            <Badge variant="secondary" className="text-[10px]">{areaTests.length}</Badge>
                          </div>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="space-y-1 pt-1">
                            {areaTests.map((t) => (
                              <MainTestRow key={t.testId ?? t.testVersionId} test={t} />
                            ))}
                          </div>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Right Column - Build Configuration */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Build Configuration</CardTitle>
                  <CardDescription className="text-xs">
                    {selectedTestIds.size} of {tests.length} selected
                    {Object.keys(versionOverrides).length > 0 && (
                      <span> &middot; {Object.keys(versionOverrides).length} version override(s)</span>
                    )}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                  <span className="text-xs text-muted-foreground">All</span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {!groupByArea ? (
                <div className="space-y-1">
                  {sortedTests.map((test) => (
                    <ConfigTestRow
                      key={test.id}
                      test={test}
                      isSelected={selectedTestIds.has(test.id)}
                      onToggle={() => toggleTest(test.id)}
                      sliderValue={versionOverrides[test.id] ?? 0}
                      onSliderChange={(v) => handleVersionSlider(test.id, v)}
                      getVersionLabel={getVersionLabel}
                    />
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {groupedTests.map(([areaName, areaTests]) => (
                    <Collapsible key={`config-${areaName}-${expandKey}`} defaultOpen={allExpanded}>
                      <div>
                        <CollapsibleTrigger className="flex items-center justify-between w-full p-2 bg-muted/30 hover:bg-muted/50 rounded transition-colors group">
                          <div className="flex items-center gap-2">
                            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
                            <span className="font-medium text-xs">{areaName}</span>
                            <Badge variant="secondary" className="text-[10px]">{areaTests.length}</Badge>
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            {areaTests.filter(t => selectedTestIds.has(t.id)).length}/{areaTests.length}
                          </span>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="space-y-1 pt-1">
                            {areaTests.map((test) => (
                              <ConfigTestRow
                                key={test.id}
                                test={test}
                                isSelected={selectedTestIds.has(test.id)}
                                onToggle={() => toggleTest(test.id)}
                                sliderValue={versionOverrides[test.id] ?? 0}
                                onSliderChange={(v) => handleVersionSlider(test.id, v)}
                                getVersionLabel={getVersionLabel}
                              />
                            ))}
                          </div>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Read-only row showing a test from the main branch build */
function MainTestRow({ test }: { test: MainBuildTest }) {
  const diffPct = test.avgDiffPct;
  const diffLabel = diffPct === null ? '-' : diffPct === 0 ? '0%' : `${diffPct.toFixed(1)}%`;
  const diffColor = diffPct === null || diffPct === 0 ? 'text-green-600' : diffPct < 1 ? 'text-yellow-600' : 'text-red-600';

  return (
    <div className="flex items-center gap-2 px-2 h-9 border rounded-md">
      <div className="w-4 shrink-0" />
      <span className="text-sm font-medium truncate flex-1 min-w-0">{test.testName || 'Unknown test'}</span>
      <Badge variant="secondary" className="text-[10px] font-mono shrink-0">
        v{test.versionNumber ?? '?'}
      </Badge>
      {test.isLatest && (
        <span className="text-[10px] text-primary font-medium shrink-0">latest</span>
      )}
      <span className={`text-[10px] font-medium shrink-0 ${diffColor}`}>{diffLabel}</span>
      {test.status && (
        <Badge
          variant="secondary"
          className={`text-[10px] shrink-0 ${
            test.status === 'passed' ? 'bg-green-100 text-green-700' :
            test.status === 'failed' ? 'bg-red-100 text-red-700' :
            'bg-gray-100 text-gray-600'
          }`}
        >
          {test.status}
        </Badge>
      )}
    </div>
  );
}

/** Config row with checkbox and version slider */
function ConfigTestRow({
  test,
  isSelected,
  onToggle,
  sliderValue,
  onSliderChange,
  getVersionLabel,
}: {
  test: TestWithVersions;
  isSelected: boolean;
  onToggle: () => void;
  sliderValue: number;
  onSliderChange: (v: number) => void;
  getVersionLabel: (test: TestWithVersions, value: number) => string;
}) {
  const hasVersions = test.versions.length > 0;

  return (
    <div
      className={`flex items-center gap-2 px-2 h-9 border rounded-md transition-colors ${
        isSelected ? 'border-primary/30 bg-primary/5' : 'opacity-60'
      }`}
    >
      <Checkbox checked={isSelected} onCheckedChange={onToggle} />
      <span className="text-sm font-medium truncate flex-1 min-w-0">{test.name}</span>
      {hasVersions && (
        <>
          <span className="text-[10px] text-muted-foreground shrink-0 w-20 truncate text-right">
            {getVersionLabel(test, sliderValue)}
          </span>
          <Slider
            min={0}
            max={test.versions.length}
            step={1}
            value={[sliderValue]}
            onValueChange={([v]) => onSliderChange(v)}
            className="w-28 shrink-0"
          />
        </>
      )}
    </div>
  );
}
