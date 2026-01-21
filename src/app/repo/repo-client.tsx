'use client';

import { useEffect, useState, useTransition } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { GitBranch, CheckCircle2, Circle, FolderGit2, AlertCircle, Scan, Loader2, PartyPopper } from 'lucide-react';
import { fetchRepoBranches, updateRepoBaseline } from '@/server/actions/repos';
import { startRouteScan } from '@/server/actions/scanner';
import type { Repository, Route, ScanStatus } from '@/lib/db/schema';
import type { GitHubBranch } from '@/lib/github/oauth';

interface RepoClientProps {
  repository: Repository | null;
  branchTestStatus: Record<string, boolean>;
  routes: Route[];
  coverage: { total: number; withTests: number; percentage: number };
  scanStatus?: ScanStatus;
}

export function RepoClient({ repository, branchTestStatus, routes, coverage, scanStatus }: RepoClientProps) {
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isScanning, setIsScanning] = useState(scanStatus?.status === 'scanning');

  useEffect(() => {
    if (repository) {
      setIsLoading(true);
      fetchRepoBranches(repository.id)
        .then(setBranches)
        .finally(() => setIsLoading(false));
    }
  }, [repository]);

  useEffect(() => {
    setIsScanning(scanStatus?.status === 'scanning');
  }, [scanStatus]);

  const handleBaselineChange = (branch: string) => {
    if (!repository) return;
    startTransition(async () => {
      await updateRepoBaseline(repository.id, branch);
    });
  };

  const handleScan = async () => {
    if (!repository) return;
    setIsScanning(true);
    try {
      await startRouteScan(repository.id);
    } finally {
      setIsScanning(false);
    }
  };

  if (!repository) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <FolderGit2 className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No repository selected</p>
          <p className="text-sm text-muted-foreground">
            Select a repository from the sidebar to view details
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Repo Header */}
      <div className="flex items-center gap-3">
        <FolderGit2 className="h-8 w-8 text-primary" />
        <div>
          <h2 className="text-2xl font-bold">{repository.fullName}</h2>
          <p className="text-sm text-muted-foreground">
            Default branch: {repository.defaultBranch || 'main'}
          </p>
        </div>
      </div>

      {/* Baseline Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Baseline Branch</CardTitle>
          <CardDescription>
            Select which branch to use as the baseline for visual comparisons
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={repository.selectedBaseline || repository.defaultBranch || ''}
            onValueChange={handleBaselineChange}
            disabled={isPending || isLoading || branches.length === 0}
          >
            <SelectTrigger className="w-[300px]">
              <SelectValue placeholder="Select baseline branch">
                {repository.selectedBaseline || repository.defaultBranch || 'Select branch'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {branches.map((branch) => (
                <SelectItem key={branch.name} value={branch.name}>
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-4 w-4" />
                    {branch.name}
                    {branch.protected && (
                      <Badge variant="secondary" className="text-xs">protected</Badge>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Route Discovery */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Route Discovery</CardTitle>
              <CardDescription>
                Scan codebase to discover routes and track test coverage
              </CardDescription>
            </div>
            <Button onClick={handleScan} disabled={isScanning}>
              {isScanning ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Scanning...
                </>
              ) : (
                <>
                  <Scan className="h-4 w-4 mr-2" />
                  Scan Routes
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isScanning ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Scanning routes...</span>
            </div>
          ) : routes.length > 0 ? (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <PartyPopper className="h-4 w-4" />
              <span>{routes.length} routes found!</span>
              {scanStatus?.framework && (
                <Badge variant="outline" className="ml-2">{scanStatus.framework}</Badge>
              )}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              No routes discovered. Click Scan Routes to detect routes.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Branch Tree View */}
      <Card>
        <CardHeader>
          <CardTitle>Branches</CardTitle>
          <CardDescription>
            View all branches and their test status
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading branches...
            </div>
          ) : branches.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <AlertCircle className="h-8 w-8 mx-auto mb-2" />
              <p>No branches found</p>
              <p className="text-sm">Connect GitHub to sync branches</p>
            </div>
          ) : (
            <div className="space-y-1">
              {branches.map((branch) => {
                const hasTested = branchTestStatus[branch.name] || false;
                const isBaseline =
                  branch.name === repository.selectedBaseline ||
                  (!repository.selectedBaseline && branch.name === repository.defaultBranch);

                return (
                  <div
                    key={branch.name}
                    className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 border"
                  >
                    <div className="flex items-center gap-3">
                      <GitBranch className="h-4 w-4 text-muted-foreground" />
                      <span className="font-mono text-sm">{branch.name}</span>
                      {isBaseline && (
                        <Badge variant="outline" className="text-xs">
                          baseline
                        </Badge>
                      )}
                      {branch.protected && (
                        <Badge variant="secondary" className="text-xs">
                          protected
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {hasTested ? (
                        <Badge variant="default" className="flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          Tested
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="flex items-center gap-1 text-muted-foreground">
                          <Circle className="h-3 w-3" />
                          Not tested
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
