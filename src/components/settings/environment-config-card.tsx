'use client';

import { useState, useTransition, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { saveEnvironmentConfig, testServerConnection } from '@/server/actions/environment';
import type { EnvironmentConfig, EnvironmentMode } from '@/lib/db/schema';
import { Loader2, Server, Wifi, CheckCircle, XCircle } from 'lucide-react';
import { toast } from 'sonner';

interface EnvironmentConfigCardProps {
  config: EnvironmentConfig;
  repositoryId?: string | null;
}

export function EnvironmentConfigCard({
  config,
  repositoryId,
}: EnvironmentConfigCardProps) {
  const [, startTransition] = useTransition();
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    statusCode?: number;
    error?: string;
    responseTime?: number;
  } | null>(null);

  const [mode, setMode] = useState<EnvironmentMode>(config.mode as EnvironmentMode || 'manual');
  const [baseUrl, setBaseUrl] = useState(config.baseUrl || 'http://localhost:3000');
  const [startCommand, setStartCommand] = useState(config.startCommand || '');
  const [healthCheckUrl, setHealthCheckUrl] = useState(config.healthCheckUrl || '');
  const [healthCheckTimeout, setHealthCheckTimeout] = useState(config.healthCheckTimeout || 60000);
  const [reuseExistingServer, setReuseExistingServer] = useState(config.reuseExistingServer ?? true);

  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Store original values to compare against (prevents save on mount)
  const originalValues = useRef({
    mode: (config.mode as EnvironmentMode) || 'manual',
    baseUrl: config.baseUrl || 'http://localhost:3000',
    startCommand: config.startCommand || '',
    healthCheckUrl: config.healthCheckUrl || '',
    healthCheckTimeout: config.healthCheckTimeout || 60000,
    reuseExistingServer: config.reuseExistingServer ?? true,
  });

  const doSave = useCallback(() => {
    startTransition(async () => {
      await saveEnvironmentConfig({
        repositoryId,
        mode,
        baseUrl,
        startCommand: startCommand || null,
        healthCheckUrl: healthCheckUrl || null,
        healthCheckTimeout,
        reuseExistingServer,
      });
      toast.success('Environment settings saved');
    });
  }, [repositoryId, mode, baseUrl, startCommand, healthCheckUrl, healthCheckTimeout, reuseExistingServer]);

  // Auto-save with debounce - only when values differ from original props
  useEffect(() => {
    const orig = originalValues.current;
    const hasChanges =
      mode !== orig.mode ||
      baseUrl !== orig.baseUrl ||
      startCommand !== orig.startCommand ||
      healthCheckUrl !== orig.healthCheckUrl ||
      healthCheckTimeout !== orig.healthCheckTimeout ||
      reuseExistingServer !== orig.reuseExistingServer;

    if (!hasChanges) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      doSave();
    }, 500);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [mode, baseUrl, startCommand, healthCheckUrl, healthCheckTimeout, reuseExistingServer, doSave]);

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testServerConnection(baseUrl);
      setTestResult(result);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="w-5 h-5" />
          Environment Configuration
        </CardTitle>
        <CardDescription>
          Configure how the dev server is managed before running tests
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Mode Selection */}
        <div className="space-y-2">
          <Label htmlFor="mode">Server Mode</Label>
          <Select value={mode} onValueChange={(v) => setMode(v as EnvironmentMode)}>
            <SelectTrigger id="mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Manual - Server must be running</SelectItem>
              <SelectItem value="managed">Managed - Auto-start server</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {mode === 'manual'
              ? 'You must start the dev server before running tests'
              : 'The server will be automatically started before tests run'}
          </p>
        </div>

        {/* Base URL */}
        <div className="space-y-2">
          <Label htmlFor="baseUrl">Base URL</Label>
          <div className="flex gap-2">
            <Input
              id="baseUrl"
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:3000"
              className="flex-1"
            />
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={isTesting || !baseUrl}
            >
              {isTesting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Wifi className="w-4 h-4" />
              )}
              <span className="ml-2">Test</span>
            </Button>
          </div>
          {testResult && (
            <div
              className={`flex items-center gap-2 text-sm ${
                testResult.success ? 'text-green-600' : 'text-red-600'
              }`}
            >
              {testResult.success ? (
                <>
                  <CheckCircle className="w-4 h-4" />
                  Connected (HTTP {testResult.statusCode}, {testResult.responseTime}ms)
                </>
              ) : (
                <>
                  <XCircle className="w-4 h-4" />
                  {testResult.error || 'Connection failed'}
                </>
              )}
            </div>
          )}
        </div>

        {/* Managed Mode Settings */}
        {mode === 'managed' && (
          <>
            {/* Start Command */}
            <div className="space-y-2">
              <Label htmlFor="startCommand">Start Command</Label>
              <Input
                id="startCommand"
                value={startCommand}
                onChange={(e) => setStartCommand(e.target.value)}
                placeholder="pnpm dev"
              />
              <p className="text-xs text-muted-foreground">
                Command to start the dev server (e.g., pnpm dev, npm run dev)
              </p>
            </div>

            {/* Health Check URL */}
            <div className="space-y-2">
              <Label htmlFor="healthCheckUrl">Health Check URL (optional)</Label>
              <Input
                id="healthCheckUrl"
                type="url"
                value={healthCheckUrl}
                onChange={(e) => setHealthCheckUrl(e.target.value)}
                placeholder={baseUrl || 'Same as Base URL'}
              />
              <p className="text-xs text-muted-foreground">
                URL to check if server is ready. Defaults to Base URL.
              </p>
            </div>

            {/* Health Check Timeout */}
            <div className="space-y-2">
              <Label htmlFor="healthCheckTimeout">Health Check Timeout</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="healthCheckTimeout"
                  type="number"
                  value={healthCheckTimeout}
                  onChange={(e) => setHealthCheckTimeout(parseInt(e.target.value) || 60000)}
                  className="w-32"
                />
                <span className="text-sm text-muted-foreground">ms</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Max time to wait for server to become ready
              </p>
            </div>

            {/* Reuse Existing Server */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Reuse Existing Server</Label>
                <p className="text-xs text-muted-foreground">
                  If server is already running, use it instead of starting a new one
                </p>
              </div>
              <Switch
                checked={reuseExistingServer}
                onCheckedChange={setReuseExistingServer}
              />
            </div>
          </>
        )}

      </CardContent>
    </Card>
  );
}
