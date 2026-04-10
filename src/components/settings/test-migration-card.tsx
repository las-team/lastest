'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { fetchRemoteRepositories, migrateTests } from '@/server/actions/test-migration';
import { toast } from 'sonner';

interface RemoteRepo {
  id: string;
  fullName: string;
  name: string;
  owner: string;
}

interface MigrationResult {
  success: boolean;
  areasCreated: number;
  areasUpdated: number;
  testsCreated: number;
  testsUpdated: number;
  errors: string[];
}

export function TestMigrationCard({ repositoryId }: { repositoryId: string }) {
  const [remoteUrl, setRemoteUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [remoteRepos, setRemoteRepos] = useState<RemoteRepo[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState('');
  const [fetchingRepos, setFetchingRepos] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [result, setResult] = useState<MigrationResult | null>(null);

  async function handleFetchRepos() {
    if (!remoteUrl || !apiKey) {
      toast.error('Remote URL and API key are required');
      return;
    }
    setFetchingRepos(true);
    setRemoteRepos([]);
    setSelectedRepoId('');
    setResult(null);

    try {
      const res = await fetchRemoteRepositories(remoteUrl, apiKey);
      if (res.error) {
        toast.error(res.error);
      } else if (res.repos && res.repos.length > 0) {
        setRemoteRepos(res.repos);
        toast.success(`Found ${res.repos.length} repositories`);
      } else {
        toast.error('No repositories found on remote');
      }
    } finally {
      setFetchingRepos(false);
    }
  }

  async function handleMigrate() {
    if (!selectedRepoId) {
      toast.error('Select a target repository');
      return;
    }
    setMigrating(true);
    setResult(null);

    try {
      const res = await migrateTests(repositoryId, remoteUrl, apiKey, selectedRepoId);
      setResult(res);
      if (res.success) {
        toast.success('Migration completed successfully');
      } else {
        toast.error('Migration completed with errors');
      }
    } catch {
      toast.error('Migration failed');
    } finally {
      setMigrating(false);
    }
  }

  return (
    <Card id="test-migration">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="w-5 h-5" />
          Test Migration
        </CardTitle>
        <CardDescription>
          Migrate tests and functional areas to a remote Lastest instance
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="remote-url">Remote URL</Label>
          <Input
            id="remote-url"
            placeholder="https://app.lastest.cloud"
            value={remoteUrl}
            onChange={(e) => setRemoteUrl(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="api-key">API Key</Label>
          <Input
            id="api-key"
            type="password"
            placeholder="lastest_api_..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleFetchRepos}
          disabled={fetchingRepos || !remoteUrl || !apiKey}
        >
          {fetchingRepos && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Fetch Repositories
        </Button>

        {remoteRepos.length > 0 && (
          <>
            <div className="space-y-2">
              <Label>Target Repository</Label>
              <Select value={selectedRepoId} onValueChange={setSelectedRepoId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a repository" />
                </SelectTrigger>
                <SelectContent>
                  {remoteRepos.map((repo) => (
                    <SelectItem key={repo.id} value={repo.id}>
                      {repo.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={handleMigrate}
              disabled={migrating || !selectedRepoId}
            >
              {migrating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Migrate Tests
            </Button>
          </>
        )}

        {result && (
          <div
            className={`p-4 rounded-lg border text-sm space-y-1 ${
              result.success
                ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800'
                : 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800'
            }`}
          >
            <div className="flex items-center gap-2 font-medium">
              {result.success ? (
                <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
              ) : (
                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              )}
              Migration {result.success ? 'complete' : 'completed with errors'}
            </div>
            <div className="text-muted-foreground">
              Areas: {result.areasCreated} created, {result.areasUpdated} updated
            </div>
            <div className="text-muted-foreground">
              Tests: {result.testsCreated} created, {result.testsUpdated} updated
            </div>
            {result.errors.length > 0 && (
              <div className="mt-2 space-y-1">
                {result.errors.map((err, i) => (
                  <div key={i} className="text-destructive text-xs">
                    {err}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
