'use client';

import { useState, useTransition, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { saveAISettings, resetAISettings, testAIConnection } from '@/server/actions/ai-settings';
import { DEFAULT_AI_SETTINGS } from '@/lib/db/schema';
import type { AISettings, AIProvider, AgentSdkPermissionMode } from '@/lib/db/schema';
import { Loader2, RotateCcw, Sparkles, CheckCircle2, XCircle, Zap, Bot } from 'lucide-react';
import { toast } from 'sonner';

interface AISettingsCardProps {
  settings: AISettings;
  repositoryId?: string | null;
}

const OPENROUTER_MODELS = [
  { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' },
  { value: 'anthropic/claude-opus-4', label: 'Claude Opus 4' },
  { value: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
  { value: 'openai/gpt-4o', label: 'GPT-4o' },
  { value: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' },
];

export function AISettingsCard({ settings, repositoryId }: AISettingsCardProps) {
  const [isPending, startTransition] = useTransition();
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const [provider, setProvider] = useState<AIProvider>(
    (settings.provider as AIProvider) || DEFAULT_AI_SETTINGS.provider
  );
  const [openrouterApiKey, setOpenrouterApiKey] = useState(settings.openrouterApiKey || '');
  const [openrouterModel, setOpenrouterModel] = useState(
    settings.openrouterModel || DEFAULT_AI_SETTINGS.openrouterModel
  );
  const [customInstructions, setCustomInstructions] = useState(settings.customInstructions || '');
  const [agentSdkPermissionMode, setAgentSdkPermissionMode] = useState<AgentSdkPermissionMode>(
    (settings.agentSdkPermissionMode as AgentSdkPermissionMode) || 'plan'
  );
  const [agentSdkWorkingDir, setAgentSdkWorkingDir] = useState(settings.agentSdkWorkingDir || '');

  const isInitialMount = useRef(true);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const doSave = useCallback(() => {
    startTransition(async () => {
      await saveAISettings({
        repositoryId,
        provider,
        openrouterApiKey: openrouterApiKey || null,
        openrouterModel,
        agentSdkPermissionMode,
        agentSdkWorkingDir: agentSdkWorkingDir || null,
        customInstructions: customInstructions || null,
      });
      toast.success('AI settings saved');
    });
  }, [repositoryId, provider, openrouterApiKey, openrouterModel, agentSdkPermissionMode, agentSdkWorkingDir, customInstructions]);

  // Auto-save with debounce
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

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
  }, [provider, openrouterApiKey, openrouterModel, agentSdkPermissionMode, agentSdkWorkingDir, customInstructions, doSave]);

  const handleReset = () => {
    startTransition(async () => {
      await resetAISettings(repositoryId);
      setProvider(DEFAULT_AI_SETTINGS.provider);
      setOpenrouterApiKey('');
      setOpenrouterModel(DEFAULT_AI_SETTINGS.openrouterModel);
      setCustomInstructions('');
      setAgentSdkPermissionMode('plan');
      setAgentSdkWorkingDir('');
      setTestResult(null);
      toast.success('AI settings reset to defaults');
    });
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testAIConnection(provider, openrouterApiKey || undefined, agentSdkPermissionMode);
      setTestResult(result);
      if (result.success) {
        toast.success(result.message);
        try { localStorage.setItem('lastest2-ai-configured', 'true'); } catch {}
      } else {
        toast.error(result.message);
      }
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5" />
          AI Settings
        </CardTitle>
        <CardDescription>
          Configure AI provider for test generation, fixing, and enhancement
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Provider Selection */}
        <div className="space-y-2">
          <Label>AI Provider</Label>
          <Select value={provider} onValueChange={(v) => setProvider(v as AIProvider)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="claude-cli">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4" />
                  Claude CLI (requires `claude login`)
                </div>
              </SelectItem>
              <SelectItem value="openrouter">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  OpenRouter API
                </div>
              </SelectItem>
              <SelectItem value="claude-agent-sdk">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4" />
                  Claude Agent SDK
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {provider === 'claude-cli'
              ? 'Uses the Claude CLI tool. Run `claude login` to authenticate.'
              : provider === 'openrouter'
              ? 'Uses OpenRouter API with your API key.'
              : 'Uses Claude Agent SDK for agentic interactions.'}
          </p>
        </div>

        {/* OpenRouter Settings */}
        {provider === 'openrouter' && (
          <>
            <div className="space-y-2">
              <Label htmlFor="apiKey">OpenRouter API Key</Label>
              <Input
                id="apiKey"
                type="password"
                value={openrouterApiKey}
                onChange={(e) => setOpenrouterApiKey(e.target.value)}
                placeholder="sk-or-v1-..."
              />
              <p className="text-xs text-muted-foreground">
                Get your API key from{' '}
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  openrouter.ai/keys
                </a>
              </p>
            </div>

            <div className="space-y-2">
              <Label>Model</Label>
              <Select value={openrouterModel} onValueChange={setOpenrouterModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPENROUTER_MODELS.map((model) => (
                    <SelectItem key={model.value} value={model.value}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        {/* Claude Agent SDK Settings */}
        {provider === 'claude-agent-sdk' && (
          <>
            <div className="space-y-2">
              <Label>Permission Mode</Label>
              <Select
                value={agentSdkPermissionMode}
                onValueChange={(v) => setAgentSdkPermissionMode(v as AgentSdkPermissionMode)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="plan">Plan (Read-only, safest)</SelectItem>
                  <SelectItem value="default">Default (Standard permissions)</SelectItem>
                  <SelectItem value="acceptEdits">Accept Edits (Allow file modifications)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Controls what actions the agent can perform. &quot;Plan&quot; is read-only and safest.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="workingDir">Working Directory (Optional)</Label>
              <Input
                id="workingDir"
                value={agentSdkWorkingDir}
                onChange={(e) => setAgentSdkWorkingDir(e.target.value)}
                placeholder="/path/to/project"
              />
              <p className="text-xs text-muted-foreground">
                The directory where the agent will operate. Defaults to current working directory.
              </p>
            </div>
          </>
        )}

        {/* Custom Instructions */}
        <div className="space-y-2">
          <Label htmlFor="customInstructions">Custom Instructions (Optional)</Label>
          <Textarea
            id="customInstructions"
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
            placeholder="Add any custom instructions for AI test generation..."
            rows={3}
          />
          <p className="text-xs text-muted-foreground">
            These instructions will be included in all AI prompts.
          </p>
        </div>

        {/* Test Connection */}
        <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTestConnection}
            disabled={isTesting || (provider === 'openrouter' && !openrouterApiKey)}
          >
            {isTesting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Zap className="w-4 h-4 mr-2" />
            )}
            Test Connection
          </Button>
          {testResult && (
            <div className={`flex items-center gap-2 text-sm ${testResult.success ? 'text-green-600' : 'text-red-600'}`}>
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <XCircle className="w-4 h-4" />
              )}
              {testResult.message}
            </div>
          )}
        </div>

        {/* Reset */}
        <div className="flex gap-2 pt-2">
          <Button variant="outline" onClick={handleReset} disabled={isPending}>
            {isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RotateCcw className="w-4 h-4 mr-2" />
            )}
            Reset to Defaults
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
