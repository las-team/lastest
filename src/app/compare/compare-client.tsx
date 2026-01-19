'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  GitBranch,
  ArrowRight,
  Loader2,
  CheckCircle,
  XCircle,
  ImageIcon,
} from 'lucide-react';
import type { TestRun } from '@/lib/db/schema';

interface CompareClientProps {
  branches: string[];
  runs: TestRun[];
  defaultBaseline?: string | null;
}

interface ComparisonResult {
  testName: string;
  baseline: string | null;
  current: string | null;
  diff: string | null;
  percentDiff: number;
  match: boolean;
}

export function CompareClient({ branches, runs, defaultBaseline }: CompareClientProps) {
  const [baseBranch, setBaseBranch] = useState<string>(defaultBaseline || '');
  const [targetBranch, setTargetBranch] = useState<string>('');
  const [isComparing, setIsComparing] = useState(false);
  const [results, setResults] = useState<ComparisonResult[]>([]);
  const [hasCompared, setHasCompared] = useState(false);

  // Get runs grouped by branch
  const runsByBranch = runs.reduce((acc, run) => {
    if (!acc[run.gitBranch]) acc[run.gitBranch] = [];
    acc[run.gitBranch].push(run);
    return acc;
  }, {} as Record<string, TestRun[]>);

  const handleCompare = async () => {
    if (!baseBranch || !targetBranch) return;

    setIsComparing(true);
    setHasCompared(false);

    try {
      // In a real implementation, this would:
      // 1. Get the latest run from each branch
      // 2. Compare screenshots using the differ module
      // For now, show placeholder results

      // Simulated comparison
      await new Promise(resolve => setTimeout(resolve, 2000));

      const baseRuns = runsByBranch[baseBranch] || [];
      const targetRuns = runsByBranch[targetBranch] || [];

      if (baseRuns.length === 0 || targetRuns.length === 0) {
        setResults([]);
      } else {
        // Placeholder results
        setResults([
          {
            testName: 'Login Page',
            baseline: '/screenshots/placeholder.png',
            current: '/screenshots/placeholder.png',
            diff: null,
            percentDiff: 0,
            match: true,
          },
        ]);
      }

      setHasCompared(true);
    } finally {
      setIsComparing(false);
    }
  };

  const matchingCount = results.filter(r => r.match).length;
  const diffCount = results.filter(r => !r.match).length;

  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Branch Selection */}
        <Card>
          <CardHeader>
            <CardTitle>Compare Branches</CardTitle>
            <CardDescription>
              Select two branches to compare visual differences
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="text-sm font-medium mb-2 block">Base Branch</label>
                <Select value={baseBranch} onValueChange={setBaseBranch}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select base branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((branch) => (
                      <SelectItem key={branch} value={branch}>
                        <span className="flex items-center gap-2">
                          <GitBranch className="h-4 w-4" />
                          {branch}
                          {runsByBranch[branch] && (
                            <Badge variant="secondary" className="ml-2">
                              {runsByBranch[branch].length} runs
                            </Badge>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <ArrowRight className="h-5 w-5 text-muted-foreground mt-6" />

              <div className="flex-1">
                <label className="text-sm font-medium mb-2 block">Target Branch</label>
                <Select value={targetBranch} onValueChange={setTargetBranch}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select target branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((branch) => (
                      <SelectItem key={branch} value={branch}>
                        <span className="flex items-center gap-2">
                          <GitBranch className="h-4 w-4" />
                          {branch}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={handleCompare}
                disabled={!baseBranch || !targetBranch || isComparing}
                className="mt-6"
              >
                {isComparing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                Compare
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        {hasCompared && (
          <Card>
            <CardHeader>
              <CardTitle>Comparison Results</CardTitle>
              <CardDescription>
                {baseBranch} → {targetBranch}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {results.length > 0 ? (
                <>
                  {/* Summary */}
                  <div className="flex items-center gap-6 mb-6 p-4 bg-muted rounded-lg">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-5 w-5 text-green-500" />
                      <span className="font-medium">{matchingCount} matching</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <XCircle className="h-5 w-5 text-destructive" />
                      <span className="font-medium">{diffCount} different</span>
                    </div>
                  </div>

                  {/* Comparison List */}
                  <div className="space-y-4">
                    {results.map((result, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between p-4 border rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          {result.match ? (
                            <CheckCircle className="h-5 w-5 text-green-500" />
                          ) : (
                            <XCircle className="h-5 w-5 text-destructive" />
                          )}
                          <div>
                            <div className="font-medium">{result.testName}</div>
                            {!result.match && (
                              <div className="text-sm text-muted-foreground">
                                {result.percentDiff}% different
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {result.baseline && (
                            <Button variant="outline" size="sm">
                              <ImageIcon className="h-4 w-4 mr-1" />
                              Baseline
                            </Button>
                          )}
                          {result.current && (
                            <Button variant="outline" size="sm">
                              <ImageIcon className="h-4 w-4 mr-1" />
                              Current
                            </Button>
                          )}
                          {result.diff && (
                            <Button variant="outline" size="sm">
                              <ImageIcon className="h-4 w-4 mr-1" />
                              Diff
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No comparison results available</p>
                  <p className="text-sm mt-2">
                    Make sure both branches have test runs with screenshots
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {!hasCompared && branches.length === 0 && (
          <Card>
            <CardContent className="py-8">
              <div className="text-center text-muted-foreground">
                <GitBranch className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No git branches found</p>
                <p className="text-sm mt-2">
                  Initialize a git repository to enable branch comparison
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
