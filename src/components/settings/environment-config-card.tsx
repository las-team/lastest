'use client';

import { useState, useTransition, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { saveEnvironmentConfig, testServerConnection } from '@/server/actions/environment';
import type { EnvironmentConfig } from '@/lib/db/schema';
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

  const [baseUrl, setBaseUrl] = useState(config.baseUrl || 'http://localhost:3000');

  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Store original values to compare against (prevents save on mount)
  const originalValues = useRef({
    baseUrl: config.baseUrl || 'http://localhost:3000',
  });

  const doSave = useCallback(() => {
    startTransition(async () => {
      await saveEnvironmentConfig({
        repositoryId,
        mode: 'manual',
        baseUrl,
        startCommand: null,
        healthCheckUrl: null,
        healthCheckTimeout: 60000,
        reuseExistingServer: true,
      });
      toast.success('Environment settings saved');
    });
  }, [repositoryId, baseUrl]);

  // Auto-save with debounce - only when values differ from original props
  useEffect(() => {
    const orig = originalValues.current;
    const hasChanges = baseUrl !== orig.baseUrl;

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
  }, [baseUrl, doSave]);

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


      </CardContent>
    </Card>
  );
}
