'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { GitBranch, CheckCircle2, Circle, FolderGit2, AlertCircle, Scan, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { fetchRepoBranches } from '@/server/actions/repos';
import { startRemoteRouteScan } from '@/server/actions/scanner';
import { AIScanRoutesDialog } from '@/components/ai/ai-scan-routes-dialog';
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
  const [isScanning, setIsScanning] = useState(scanStatus?.status === 'scanning');
  const [showAIScanDialog, setShowAIScanDialog] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState(repository?.selectedBranch || repository?.defaultBranch || '');

  useEffect(() => {
    if (repository) {
      setIsLoading(true);
      fetchRepoBranches(repository.id)
        .then((fetchedBranches) => {
          setBranches(fetchedBranches);
          // Set default selected branch if not already set
          if (!selectedBranch && fetchedBranches.length > 0) {
            const defaultBranch = fetchedBranches.find(b => b.name === repository.defaultBranch);
            setSelectedBranch(defaultBranch?.name || fetchedBranches[0].name);
          }
        })
        .finally(() => setIsLoading(false));
    }
  }, [repository]);

  useEffect(() => {
    setIsScanning(scanStatus?.status === 'scanning');
  }, [scanStatus]);

  // Update selected branch when repository changes
  useEffect(() => {
    if (repository?.selectedBranch) {
      setSelectedBranch(repository.selectedBranch);
    } else if (repository?.defaultBranch) {
      setSelectedBranch(repository.defaultBranch);
    }
  }, [repository?.selectedBranch, repository?.defaultBranch]);

  const handleScan = async () => {
    if (!repository || !selectedBranch) {
      toast.error('Please select a branch first');
      return;
    }

    setIsScanning(true);
    try {
      const result = await startRemoteRouteScan(repository.id, selectedBranch);
      if (result.success) {
        toast.success(`${result.routesFound} routes found!`);
      } else {
        toast.error(result.error || 'Failed to scan routes');
      }
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

      {/* Route Discovery */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Route Discovery</CardTitle>
              <CardDescription>
                Select a branch and scan to discover routes via GitHub API
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((branch) => (
                    <SelectItem key={branch.name} value={branch.name}>
                      <div className="flex items-center gap-2">
                        <GitBranch className="h-4 w-4" />
                        {branch.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={handleScan} disabled={isScanning || !selectedBranch}>
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
              {selectedBranch && (
                <Button
                  variant="outline"
                  onClick={() => setShowAIScanDialog(true)}
                  disabled={isScanning}
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  AI Scan
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Branch Info Display */}
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-2 text-sm">
              <GitBranch className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Selected branch:</span>
              <code className="font-mono text-xs px-2 py-1 rounded bg-background">
                {selectedBranch || 'None selected'}
              </code>
              {repository.selectedBranch && repository.selectedBranch === selectedBranch && (
                <Badge variant="outline" className="text-xs">Last scanned</Badge>
              )}
            </div>
          </div>
          {isScanning && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Scanning routes via GitHub API...</span>
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

                return (
                  <div
                    key={branch.name}
                    className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 border"
                  >
                    <div className="flex items-center gap-3">
                      <GitBranch className="h-4 w-4 text-muted-foreground" />
                      <span className="font-mono text-sm">{branch.name}</span>
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

      {/* AI Scan Routes Dialog */}
      {selectedBranch && (
        <AIScanRoutesDialog
          open={showAIScanDialog}
          onOpenChange={setShowAIScanDialog}
          repositoryId={repository.id}
          branch={selectedBranch}
        />
      )}
    </div>
  );
}
