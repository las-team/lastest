'use client';

import { useState, useTransition, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
import type { AISettings, AIProvider, AgentSdkPermissionMode, AIDiffingProvider } from '@/lib/db/schema';
import { Loader2, RotateCcw, Sparkles, CheckCircle2, XCircle, Zap, Bot, Eye, Server, Brain, Cloud } from 'lucide-react';
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

const ANTHROPIC_MODELS = [
  { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
  { value: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
];

const OPENAI_MODELS = [
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'o3', label: 'o3' },
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
  const [agentSdkModel, setAgentSdkModel] = useState(settings.agentSdkModel || '');
  const [agentSdkWorkingDir, setAgentSdkWorkingDir] = useState(settings.agentSdkWorkingDir || '');
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState(
    settings.ollamaBaseUrl || DEFAULT_AI_SETTINGS.ollamaBaseUrl
  );
  const [ollamaModel, setOllamaModel] = useState(settings.ollamaModel || '');
  const [anthropicApiKey, setAnthropicApiKey] = useState(settings.anthropicApiKey || '');
  const [anthropicModel, setAnthropicModel] = useState(
    settings.anthropicModel || DEFAULT_AI_SETTINGS.anthropicModel
  );
  const [openaiApiKey, setOpenaiApiKey] = useState(settings.openaiApiKey || '');
  const [openaiModel, setOpenaiModel] = useState(
    settings.openaiModel || DEFAULT_AI_SETTINGS.openaiModel
  );

  // AI Diffing settings
  const [aiDiffingEnabled, setAiDiffingEnabled] = useState(settings.aiDiffingEnabled ?? false);
  const [aiDiffingProvider, setAiDiffingProvider] = useState<AIDiffingProvider>(
    (settings.aiDiffingProvider as AIDiffingProvider) || 'same-as-test-gen'
  );
  const [aiDiffingApiKey, setAiDiffingApiKey] = useState(settings.aiDiffingApiKey || '');
  const [aiDiffingModel, setAiDiffingModel] = useState(
    settings.aiDiffingModel || DEFAULT_AI_SETTINGS.aiDiffingModel
  );
  const [aiDiffingOllamaBaseUrl, setAiDiffingOllamaBaseUrl] = useState(
    settings.aiDiffingOllamaBaseUrl || 'http://localhost:11434'
  );
  const [aiDiffingOllamaModel, setAiDiffingOllamaModel] = useState(settings.aiDiffingOllamaModel || '');

  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Store original values to compare against (prevents save on mount)
  const originalValues = useRef({
    provider: (settings.provider as AIProvider) || DEFAULT_AI_SETTINGS.provider,
    openrouterApiKey: settings.openrouterApiKey || '',
    openrouterModel: settings.openrouterModel || DEFAULT_AI_SETTINGS.openrouterModel,
    customInstructions: settings.customInstructions || '',
    agentSdkPermissionMode: (settings.agentSdkPermissionMode as AgentSdkPermissionMode) || 'plan',
    agentSdkModel: settings.agentSdkModel || '',
    agentSdkWorkingDir: settings.agentSdkWorkingDir || '',
    ollamaBaseUrl: settings.ollamaBaseUrl || DEFAULT_AI_SETTINGS.ollamaBaseUrl,
    ollamaModel: settings.ollamaModel || '',
    anthropicApiKey: settings.anthropicApiKey || '',
    anthropicModel: settings.anthropicModel || DEFAULT_AI_SETTINGS.anthropicModel,
    openaiApiKey: settings.openaiApiKey || '',
    openaiModel: settings.openaiModel || DEFAULT_AI_SETTINGS.openaiModel,
    aiDiffingEnabled: settings.aiDiffingEnabled ?? false,
    aiDiffingProvider: (settings.aiDiffingProvider as AIDiffingProvider) || 'same-as-test-gen',
    aiDiffingApiKey: settings.aiDiffingApiKey || '',
    aiDiffingModel: settings.aiDiffingModel || DEFAULT_AI_SETTINGS.aiDiffingModel,
    aiDiffingOllamaBaseUrl: settings.aiDiffingOllamaBaseUrl || 'http://localhost:11434',
    aiDiffingOllamaModel: settings.aiDiffingOllamaModel || '',
  });

  const doSave = useCallback(() => {
    startTransition(async () => {
      await saveAISettings({
        repositoryId,
        provider,
        openrouterApiKey: openrouterApiKey || null,
        openrouterModel,
        agentSdkPermissionMode,
        agentSdkModel: agentSdkModel || null,
        agentSdkWorkingDir: agentSdkWorkingDir || null,
        ollamaBaseUrl: ollamaBaseUrl || null,
        ollamaModel: ollamaModel || null,
        anthropicApiKey: anthropicApiKey || null,
        anthropicModel: anthropicModel || null,
        openaiApiKey: openaiApiKey || null,
        openaiModel: openaiModel || null,
        customInstructions: customInstructions || null,
        aiDiffingEnabled,
        aiDiffingProvider: aiDiffingProvider || null,
        aiDiffingApiKey: aiDiffingApiKey || null,
        aiDiffingModel: aiDiffingModel || null,
        aiDiffingOllamaBaseUrl: aiDiffingOllamaBaseUrl || null,
        aiDiffingOllamaModel: aiDiffingOllamaModel || null,
      });
      toast.success('AI settings saved');
    });
  }, [repositoryId, provider, openrouterApiKey, openrouterModel, agentSdkPermissionMode, agentSdkModel, agentSdkWorkingDir, ollamaBaseUrl, ollamaModel, anthropicApiKey, anthropicModel, openaiApiKey, openaiModel, customInstructions, aiDiffingEnabled, aiDiffingProvider, aiDiffingApiKey, aiDiffingModel, aiDiffingOllamaBaseUrl, aiDiffingOllamaModel]);

  // Auto-save with debounce - only when values differ from original props
  useEffect(() => {
    const orig = originalValues.current;
    const hasChanges =
      provider !== orig.provider ||
      openrouterApiKey !== orig.openrouterApiKey ||
      openrouterModel !== orig.openrouterModel ||
      customInstructions !== orig.customInstructions ||
      agentSdkPermissionMode !== orig.agentSdkPermissionMode ||
      agentSdkModel !== orig.agentSdkModel ||
      agentSdkWorkingDir !== orig.agentSdkWorkingDir ||
      ollamaBaseUrl !== orig.ollamaBaseUrl ||
      ollamaModel !== orig.ollamaModel ||
      anthropicApiKey !== orig.anthropicApiKey ||
      anthropicModel !== orig.anthropicModel ||
      openaiApiKey !== orig.openaiApiKey ||
      openaiModel !== orig.openaiModel ||
      aiDiffingEnabled !== orig.aiDiffingEnabled ||
      aiDiffingProvider !== orig.aiDiffingProvider ||
      aiDiffingApiKey !== orig.aiDiffingApiKey ||
      aiDiffingModel !== orig.aiDiffingModel ||
      aiDiffingOllamaBaseUrl !== orig.aiDiffingOllamaBaseUrl ||
      aiDiffingOllamaModel !== orig.aiDiffingOllamaModel;

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
  }, [provider, openrouterApiKey, openrouterModel, agentSdkPermissionMode, agentSdkModel, agentSdkWorkingDir, ollamaBaseUrl, ollamaModel, anthropicApiKey, anthropicModel, openaiApiKey, openaiModel, customInstructions, aiDiffingEnabled, aiDiffingProvider, aiDiffingApiKey, aiDiffingModel, aiDiffingOllamaBaseUrl, aiDiffingOllamaModel, doSave]);

  const handleReset = () => {
    startTransition(async () => {
      await resetAISettings(repositoryId);
      setProvider(DEFAULT_AI_SETTINGS.provider);
      setOpenrouterApiKey('');
      setOpenrouterModel(DEFAULT_AI_SETTINGS.openrouterModel);
      setCustomInstructions('');
      setAgentSdkPermissionMode('plan');
      setAgentSdkModel('');
      setAgentSdkWorkingDir('');
      setOllamaBaseUrl(DEFAULT_AI_SETTINGS.ollamaBaseUrl);
      setOllamaModel('');
      setAnthropicApiKey('');
      setAnthropicModel(DEFAULT_AI_SETTINGS.anthropicModel);
      setOpenaiApiKey('');
      setOpenaiModel(DEFAULT_AI_SETTINGS.openaiModel);
      setAiDiffingEnabled(false);
      setAiDiffingProvider(DEFAULT_AI_SETTINGS.aiDiffingProvider);
      setAiDiffingApiKey('');
      setAiDiffingModel(DEFAULT_AI_SETTINGS.aiDiffingModel);
      setAiDiffingOllamaBaseUrl('http://localhost:11434');
      setAiDiffingOllamaModel('');
      setTestResult(null);
      toast.success('AI settings reset to defaults');
    });
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testAIConnection(
        provider,
        openrouterApiKey || undefined,
        agentSdkPermissionMode,
        ollamaBaseUrl,
        ollamaModel,
        anthropicApiKey || undefined,
        openaiApiKey || undefined
      );
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
              <SelectItem value="anthropic">
                <div className="flex items-center gap-2">
                  <Brain className="h-4 w-4" />
                  Anthropic API
                </div>
              </SelectItem>
              <SelectItem value="openai">
                <div className="flex items-center gap-2">
                  <Cloud className="h-4 w-4" />
                  OpenAI API
                </div>
              </SelectItem>
              <SelectItem value="ollama">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4" />
                  Ollama (Local)
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {provider === 'claude-cli'
              ? 'Uses the Claude CLI tool. Run `claude login` to authenticate.'
              : provider === 'openrouter'
              ? 'Uses OpenRouter API with your API key.'
              : provider === 'anthropic'
              ? 'Uses the Anthropic Messages API directly with your API key.'
              : provider === 'openai'
              ? 'Uses the OpenAI Chat Completions API with your API key.'
              : provider === 'ollama'
              ? 'Uses Ollama for local open-source LLMs (Llama, Qwen, DeepSeek, etc.)'
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
                  className="text-primary hover:underline"
                >
                  openrouter.ai/keys
                </a>
              </p>
            </div>

            <div className="space-y-2">
              <Label>Model</Label>
              <Input
                value={openrouterModel}
                onChange={(e) => setOpenrouterModel(e.target.value)}
                placeholder="e.g. anthropic/claude-sonnet-4"
              />
              <div className="flex flex-wrap gap-1.5">
                {OPENROUTER_MODELS.map((model) => (
                  <button
                    key={model.value}
                    type="button"
                    onClick={() => setOpenrouterModel(model.value)}
                    className={`rounded-md border px-2 py-0.5 text-xs transition-colors ${
                      openrouterModel === model.value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                    }`}
                  >
                    {model.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Anthropic API Settings */}
        {provider === 'anthropic' && (
          <>
            <div className="space-y-2">
              <Label htmlFor="anthropicApiKey">Anthropic API Key</Label>
              <Input
                id="anthropicApiKey"
                type="password"
                value={anthropicApiKey}
                onChange={(e) => setAnthropicApiKey(e.target.value)}
                placeholder="sk-ant-..."
              />
              <p className="text-xs text-muted-foreground">
                Get your API key from{' '}
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  console.anthropic.com
                </a>
              </p>
            </div>

            <div className="space-y-2">
              <Label>Model</Label>
              <Input
                value={anthropicModel}
                onChange={(e) => setAnthropicModel(e.target.value)}
                placeholder="e.g. claude-sonnet-4-5-20250929"
              />
              <div className="flex flex-wrap gap-1.5">
                {ANTHROPIC_MODELS.map((model) => (
                  <button
                    key={model.value}
                    type="button"
                    onClick={() => setAnthropicModel(model.value)}
                    className={`rounded-md border px-2 py-0.5 text-xs transition-colors ${
                      anthropicModel === model.value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                    }`}
                  >
                    {model.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* OpenAI API Settings */}
        {provider === 'openai' && (
          <>
            <div className="space-y-2">
              <Label htmlFor="openaiApiKey">OpenAI API Key</Label>
              <Input
                id="openaiApiKey"
                type="password"
                value={openaiApiKey}
                onChange={(e) => setOpenaiApiKey(e.target.value)}
                placeholder="sk-..."
              />
              <p className="text-xs text-muted-foreground">
                Get your API key from{' '}
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  platform.openai.com
                </a>
              </p>
            </div>

            <div className="space-y-2">
              <Label>Model</Label>
              <Input
                value={openaiModel}
                onChange={(e) => setOpenaiModel(e.target.value)}
                placeholder="e.g. gpt-4o"
              />
              <div className="flex flex-wrap gap-1.5">
                {OPENAI_MODELS.map((model) => (
                  <button
                    key={model.value}
                    type="button"
                    onClick={() => setOpenaiModel(model.value)}
                    className={`rounded-md border px-2 py-0.5 text-xs transition-colors ${
                      openaiModel === model.value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                    }`}
                  >
                    {model.label}
                  </button>
                ))}
              </div>
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
              <Label htmlFor="agentSdkModel">Model (Optional)</Label>
              <Input
                id="agentSdkModel"
                value={agentSdkModel}
                onChange={(e) => setAgentSdkModel(e.target.value)}
                placeholder="claude-sonnet-4-5-20250929"
              />
              <p className="text-xs text-muted-foreground">
                Claude model ID (e.g. claude-sonnet-4-5-20250929). Leave empty for CLI default.
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

        {/* Ollama Settings */}
        {provider === 'ollama' && (
          <>
            <div className="space-y-2">
              <Label htmlFor="ollamaBaseUrl">Ollama Server URL</Label>
              <Input
                id="ollamaBaseUrl"
                type="text"
                value={ollamaBaseUrl}
                onChange={(e) => setOllamaBaseUrl(e.target.value)}
                placeholder="http://localhost:11434"
              />
              <p className="text-xs text-muted-foreground">
                Base URL of your Ollama server. Default: http://localhost:11434
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ollamaModel">Model Name</Label>
              <Input
                id="ollamaModel"
                type="text"
                value={ollamaModel}
                onChange={(e) => setOllamaModel(e.target.value)}
                placeholder="llama3.3, qwen2.5-coder, deepseek-r1, etc."
              />
              <p className="text-xs text-muted-foreground">
                Model to use (e.g., llama3.3, llava for vision). Run `ollama list` to see installed models.
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

        {/* Visual Diff Analysis Section */}
        <div className="border-t pt-6">
          <div className="flex items-center gap-2 mb-4">
            <Eye className="w-4 h-4 text-purple-600" />
            <h3 className="font-medium">Visual Diff Analysis</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Send screenshot diffs to a vision model for AI-powered classification and recommendations.
          </p>

          {/* Enable Toggle */}
          <div className="flex items-center gap-3 mb-4">
            <Switch
              checked={aiDiffingEnabled}
              onCheckedChange={setAiDiffingEnabled}
            />
            <Label>Enable AI Diff Analysis</Label>
          </div>

          {aiDiffingEnabled && (
            <div className="space-y-4 pl-2 border-l-2 border-border ml-2">
              {/* Provider */}
              <div className="space-y-2">
                <Label>Vision Provider</Label>
                <Select value={aiDiffingProvider} onValueChange={(v) => setAiDiffingProvider(v as AIDiffingProvider)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="same-as-test-gen">Same as Test Generation</SelectItem>
                    <SelectItem value="openrouter">OpenRouter API</SelectItem>
                    <SelectItem value="anthropic">Anthropic Direct</SelectItem>
                    <SelectItem value="claude-agent-sdk">Claude Agent SDK</SelectItem>
                    <SelectItem value="ollama">Ollama (Local)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {aiDiffingProvider === 'same-as-test-gen'
                    ? 'Will use your test generation provider settings. Claude CLI will be skipped (no vision support).'
                    : aiDiffingProvider === 'claude-agent-sdk'
                    ? 'Screenshots are read from disk by the agent. No API key needed. Requires `claude login`.'
                    : aiDiffingProvider === 'openrouter'
                    ? 'Uses OpenRouter to access vision models.'
                    : aiDiffingProvider === 'ollama'
                    ? 'Uses Ollama for local vision models (llava, bakllava, etc.)'
                    : 'Uses Anthropic Messages API directly with native image support.'}
                </p>
              </div>

              {/* API Key — only for openrouter/anthropic */}
              {(aiDiffingProvider === 'openrouter' || aiDiffingProvider === 'anthropic') && (
                <div className="space-y-2">
                  <Label htmlFor="aiDiffingApiKey">API Key</Label>
                  <Input
                    id="aiDiffingApiKey"
                    type="password"
                    value={aiDiffingApiKey}
                    onChange={(e) => setAiDiffingApiKey(e.target.value)}
                    placeholder={aiDiffingProvider === 'openrouter' ? 'sk-or-v1-...' : 'sk-ant-...'}
                  />
                </div>
              )}

              {/* Ollama Settings — only for ollama */}
              {aiDiffingProvider === 'ollama' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="aiDiffingOllamaBaseUrl">Ollama Server URL</Label>
                    <Input
                      id="aiDiffingOllamaBaseUrl"
                      type="text"
                      value={aiDiffingOllamaBaseUrl}
                      onChange={(e) => setAiDiffingOllamaBaseUrl(e.target.value)}
                      placeholder="http://localhost:11434"
                    />
                    <p className="text-xs text-muted-foreground">
                      Base URL of your Ollama server. Default: http://localhost:11434
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="aiDiffingOllamaModel">Vision Model Name</Label>
                    <Input
                      id="aiDiffingOllamaModel"
                      type="text"
                      value={aiDiffingOllamaModel}
                      onChange={(e) => setAiDiffingOllamaModel(e.target.value)}
                      placeholder="llava, bakllava, llava-llama3, etc."
                    />
                    <p className="text-xs text-muted-foreground">
                      Vision-capable model (e.g., llava, bakllava). Run `ollama list` to see installed models.
                    </p>
                  </div>
                </>
              )}

              {/* Model — for all direct providers except ollama */}
              {aiDiffingProvider !== 'same-as-test-gen' && aiDiffingProvider !== 'ollama' && (
                <div className="space-y-2">
                  <Label htmlFor="aiDiffingModel">Vision Model</Label>
                  <Input
                    id="aiDiffingModel"
                    value={aiDiffingModel}
                    onChange={(e) => setAiDiffingModel(e.target.value)}
                    placeholder={aiDiffingProvider === 'claude-agent-sdk' ? 'claude-sonnet-4-5-20250929' : 'anthropic/claude-sonnet-4-5-20250929'}
                  />
                  <p className="text-xs text-muted-foreground">
                    {aiDiffingProvider === 'claude-agent-sdk'
                      ? 'Model ID without vendor prefix (e.g. claude-sonnet-4-5-20250929)'
                      : 'Must be a vision-capable model. Default: anthropic/claude-sonnet-4-5-20250929'}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Test Connection */}
        <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTestConnection}
            disabled={isTesting || (provider === 'openrouter' && !openrouterApiKey) || (provider === 'ollama' && !ollamaModel) || (provider === 'anthropic' && !anthropicApiKey) || (provider === 'openai' && !openaiApiKey)}
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
