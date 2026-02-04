'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2, Loader2, Play, CheckCircle, XCircle } from 'lucide-react';
import { createSetupConfig, updateSetupConfig, testSetupConfig } from '@/server/actions/setup-configs';
import { toast } from 'sonner';
import type { SetupConfig, SetupAuthType, SetupAuthConfig } from '@/lib/db/schema';

interface ApiConfigFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClose: () => void;
  repositoryId: string;
  editConfig: SetupConfig | null;
}

export function ApiConfigForm({
  open,
  onOpenChange,
  onClose,
  repositoryId,
  editConfig,
}: ApiConfigFormProps) {
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [authType, setAuthType] = useState<SetupAuthType>('none');
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [customHeaders, setCustomHeaders] = useState<{ key: string; value: string }[]>([
    { key: '', value: '' },
  ]);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);

  // Reset form when dialog opens/closes or edit target changes
  useEffect(() => {
    if (open) {
      if (editConfig) {
        setName(editConfig.name);
        setBaseUrl(editConfig.baseUrl);
        setAuthType(editConfig.authType as SetupAuthType);
        const config = editConfig.authConfig as SetupAuthConfig | null;
        setToken(config?.token || '');
        setUsername(config?.username || '');
        setPassword(config?.password || '');
        if (config?.headers) {
          const entries = Object.entries(config.headers);
          setCustomHeaders(entries.length > 0 ? entries.map(([key, value]) => ({ key, value })) : [{ key: '', value: '' }]);
        } else {
          setCustomHeaders([{ key: '', value: '' }]);
        }
      } else {
        setName('');
        setBaseUrl('');
        setAuthType('none');
        setToken('');
        setUsername('');
        setPassword('');
        setCustomHeaders([{ key: '', value: '' }]);
      }
      setTestResult(null);
    }
  }, [open, editConfig]);

  const buildAuthConfig = (): SetupAuthConfig | undefined => {
    switch (authType) {
      case 'bearer':
        return { token };
      case 'basic':
        return { username, password };
      case 'custom':
        const headers: Record<string, string> = {};
        customHeaders.forEach(({ key, value }) => {
          if (key.trim() && value.trim()) {
            headers[key.trim()] = value.trim();
          }
        });
        return Object.keys(headers).length > 0 ? { headers } : undefined;
      default:
        return undefined;
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (!baseUrl.trim()) {
      toast.error('Base URL is required');
      return;
    }

    setIsSaving(true);
    try {
      const authConfig = buildAuthConfig();

      if (editConfig) {
        await updateSetupConfig(editConfig.id, {
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          authType,
          authConfig,
        });
        toast.success('API config updated');
      } else {
        await createSetupConfig({
          repositoryId,
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          authType,
          authConfig,
        });
        toast.success('API config created');
      }
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save config');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    if (!editConfig) {
      toast.error('Save the config first to test it');
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testSetupConfig(editConfig.id);
      setTestResult(result);
      if (result.success) {
        toast.success('Connection successful');
      } else {
        toast.error(result.error || 'Connection failed');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to test connection');
    } finally {
      setIsTesting(false);
    }
  };

  const addHeader = () => {
    setCustomHeaders([...customHeaders, { key: '', value: '' }]);
  };

  const removeHeader = (index: number) => {
    setCustomHeaders(customHeaders.filter((_, i) => i !== index));
  };

  const updateHeader = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...customHeaders];
    updated[index][field] = value;
    setCustomHeaders(updated);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editConfig ? 'Edit API Configuration' : 'Create API Configuration'}
          </DialogTitle>
          <DialogDescription>
            Configure an API endpoint for data seeding.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Development API"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="baseUrl">Base URL</Label>
            <Input
              id="baseUrl"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="authType">Authentication</Label>
            <Select value={authType} onValueChange={(v) => setAuthType(v as SetupAuthType)}>
              <SelectTrigger id="authType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="bearer">Bearer Token</SelectItem>
                <SelectItem value="basic">Basic Auth</SelectItem>
                <SelectItem value="custom">Custom Headers</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Conditional auth fields */}
          {authType === 'bearer' && (
            <div className="space-y-2">
              <Label htmlFor="token">Token</Label>
              <Input
                id="token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Bearer token"
              />
            </div>
          )}

          {authType === 'basic' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Username"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                />
              </div>
            </div>
          )}

          {authType === 'custom' && (
            <div className="space-y-2">
              <Label>Custom Headers</Label>
              <div className="space-y-2">
                {customHeaders.map((header, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      value={header.key}
                      onChange={(e) => updateHeader(index, 'key', e.target.value)}
                      placeholder="Header name"
                      className="flex-1"
                    />
                    <Input
                      value={header.value}
                      onChange={(e) => updateHeader(index, 'value', e.target.value)}
                      placeholder="Value"
                      className="flex-1"
                    />
                    {customHeaders.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeHeader(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addHeader}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Header
                </Button>
              </div>
            </div>
          )}

          {/* Test Result */}
          {testResult && (
            <div
              className={`p-3 rounded-lg border ${
                testResult.success
                  ? 'bg-green-50 border-green-200'
                  : 'bg-red-50 border-red-200'
              }`}
            >
              <div className="flex items-center gap-2">
                {testResult.success ? (
                  <CheckCircle className="h-4 w-4 text-green-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-600" />
                )}
                <span
                  className={`font-medium ${
                    testResult.success ? 'text-green-700' : 'text-red-700'
                  }`}
                >
                  {testResult.success ? 'Connection Successful' : 'Connection Failed'}
                </span>
              </div>
              {testResult.error && (
                <p className="mt-2 text-sm text-red-600">{testResult.error}</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {editConfig && (
            <Button variant="outline" onClick={handleTest} disabled={isTesting}>
              {isTesting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Test
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {editConfig ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
