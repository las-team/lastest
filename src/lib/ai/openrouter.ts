import type { AIProvider, GenerateOptions, StreamCallbacks, ToolDefinition, ToolCall, ToolResult } from './types';

export interface OpenRouterConfig {
  apiKey: string;
  model: string;
}

/** Max prompt size (in chars) before truncation. */
const MAX_PROMPT_CHARS = 100_000;

function truncatePrompt(prompt: string): string {
  if (prompt.length <= MAX_PROMPT_CHARS) return prompt;
  const truncated = prompt.slice(0, MAX_PROMPT_CHARS);
  return `${truncated}\n\n[TRUNCATED — original prompt was ${(prompt.length / 1024).toFixed(0)}KB, exceeding the ${(MAX_PROMPT_CHARS / 1024).toFixed(0)}KB limit for this provider. Please work with the content above.]`;
}

// Reasoning models (Nemotron Ultra/Super, DeepSeek-R1, etc.) emit thinking blocks
// that pollute downstream JSON parsers and code-extractors. Strip them from the
// final assembled assistant text. We deliberately do NOT strip from the per-token
// stream — UIs may want to render reasoning live.
const REASONING_PATTERNS = [
  /<think\b[^>]*>[\s\S]*?<\/think>/gi,
  /<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi,
  /<\|thinking\|>[\s\S]*?<\|\/thinking\|>/gi, // <|thinking|>...<|/thinking|>
  /<\|thinking\|>[\s\S]*?<\/\|thinking\|>/gi, // <|thinking|>...</|thinking|>
  /<\|begin_of_thought\|>[\s\S]*?<\|end_of_thought\|>/gi,
];

export function stripReasoning(text: string): string {
  if (!text) return text;
  let out = text;
  for (const pattern of REASONING_PATTERNS) {
    out = out.replace(pattern, '');
  }
  return out.replace(/^\s+/, '');
}

// Some non-Anthropic models (notably Nemotron) emit tool invocations as plain
// content instead of populating the OpenAI `tool_calls` array. Recognize the
// common shapes and recover so the agent loop can continue.
export function extractFallbackToolCall(content: string): { name: string; arguments: Record<string, unknown> } | null {
  if (!content) return null;

  // <tool_call>{...}</tool_call> (Nemotron / Hermes format)
  const tagMatch = content.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/i);
  if (tagMatch) {
    const parsed = tryParseToolCall(tagMatch[1]);
    if (parsed) return parsed;
  }

  // ```json ... ``` fenced block with name + arguments
  const fenceMatch = content.match(/```(?:json|tool_call)?\s*\n?([\s\S]*?)\n?```/i);
  if (fenceMatch) {
    const parsed = tryParseToolCall(fenceMatch[1]);
    if (parsed) return parsed;
  }

  // Bare JSON object with name + arguments somewhere in content
  const braceStart = content.indexOf('{');
  if (braceStart !== -1) {
    const candidate = sliceBalancedJson(content, braceStart);
    if (candidate) {
      const parsed = tryParseToolCall(candidate);
      if (parsed) return parsed;
    }
  }

  return null;
}

function tryParseToolCall(raw: string): { name: string; arguments: Record<string, unknown> } | null {
  try {
    const obj = JSON.parse(raw.trim());
    if (obj && typeof obj === 'object' && typeof obj.name === 'string') {
      const args = obj.arguments ?? obj.parameters ?? {};
      const argsObj = typeof args === 'string'
        ? (() => { try { return JSON.parse(args); } catch { return {}; } })()
        : args;
      if (argsObj && typeof argsObj === 'object') {
        return { name: obj.name, arguments: argsObj as Record<string, unknown> };
      }
    }
  } catch { /* fall through */ }
  return null;
}

function sliceBalancedJson(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ChatMessage = { role: string; content: any; tool_calls?: any[]; tool_call_id?: string };

function buildUserMessage(prompt: string, images?: GenerateOptions['images']): ChatMessage {
  if (images && images.length > 0) {
    return {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        ...images.map(img => ({
          type: 'image_url',
          image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
        })),
      ],
    };
  }
  return { role: 'user', content: prompt };
}

const OPENROUTER_HEADERS = {
  'Content-Type': 'application/json',
  'HTTP-Referer': 'http://localhost:3000',
  'X-Title': 'Visual Regression Platform',
} as const;

export class OpenRouterProvider implements AIProvider {
  private apiKey: string;
  private model: string;

  constructor(config: OpenRouterConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  private headers() {
    return { ...OPENROUTER_HEADERS, Authorization: `Bearer ${this.apiKey}` };
  }

  async generate(options: GenerateOptions): Promise<string> {
    const { prompt, systemPrompt, maxTokens = 4096, temperature = 0.7, images, signal, responseFormat } = options;

    const messages: ChatMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push(buildUserMessage(truncatePrompt(prompt), images));

    const body: Record<string, unknown> = { model: this.model, messages, max_tokens: maxTokens, temperature };
    if (responseFormat === 'json_object') {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
      throw new Error(`OpenRouter API error: ${error.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    return stripReasoning(data.choices?.[0]?.message?.content || '');
  }

  async generateStream(options: GenerateOptions, callbacks: StreamCallbacks): Promise<void> {
    const { prompt, systemPrompt, maxTokens = 4096, temperature = 0.7, images, signal, responseFormat } = options;

    const messages: ChatMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push(buildUserMessage(truncatePrompt(prompt), images));

    try {
      const body: Record<string, unknown> = { model: this.model, messages, max_tokens: maxTokens, temperature, stream: true };
      if (responseFormat === 'json_object') {
        body.response_format = { type: 'json_object' };
      }

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
        throw new Error(`OpenRouter API error: ${error.error?.message || 'Unknown error'}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter((line) => line.trim() !== '');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullText += content;
                callbacks.onToken?.(content);
              }
            } catch {
              // Skip invalid JSON chunks
            }
          }
        }
      }

      callbacks.onComplete?.(stripReasoning(fullText));
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Stream failed');
      callbacks.onError?.(err);
      throw err;
    }
  }

  /**
   * Agentic tool-calling loop. Sends the prompt with tool definitions, executes
   * tool calls via the provided callback, and loops until the model produces a
   * final text response (or maxToolRounds is exceeded).
   */
  async generateWithTools(options: {
    prompt: string;
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
    images?: GenerateOptions['images'];
    signal?: AbortSignal;
    responseFormat?: 'json_object';
    tools: ToolDefinition[];
    maxToolRounds?: number;
    onToolCall: (call: ToolCall) => Promise<ToolResult>;
  }): Promise<string> {
    const {
      prompt, systemPrompt, maxTokens = 4096, temperature = 0.7,
      images, signal, responseFormat, tools, maxToolRounds = 50, onToolCall,
    } = options;

    const messages: ChatMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push(buildUserMessage(truncatePrompt(prompt), images));

    // Convert tool definitions to OpenAI function-calling format
    const openaiTools = tools.map(t => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));

    for (let round = 0; round < maxToolRounds; round++) {
      if (signal?.aborted) throw new Error('Aborted');

      const body: Record<string, unknown> = {
        model: this.model,
        messages,
        max_tokens: maxTokens,
        temperature,
        tools: openaiTools,
      };
      // response_format is incompatible with tool calls on most providers, so only
      // request it on the final round (when we drop tools below).
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
        throw new Error(`OpenRouter API error: ${error.error?.message || 'Unknown error'}`);
      }

      const data = await response.json();
      const choice = data.choices?.[0];
      if (!choice) throw new Error('OpenRouter returned no choices');

      const assistantMsg = choice.message;
      // Drop any non-standard `reasoning` field OpenRouter exposes; never feed it back.
      delete assistantMsg.reasoning;
      // Strip thinking blocks from the assistant content before it re-enters history.
      if (typeof assistantMsg.content === 'string') {
        assistantMsg.content = stripReasoning(assistantMsg.content);
      }

      // Append assistant message to conversation history
      messages.push(assistantMsg);

      let toolCalls = assistantMsg.tool_calls;

      // Fallback: model emitted a tool call as plain content instead of using
      // the structured tool_calls array. Recover and continue.
      if ((!toolCalls || toolCalls.length === 0) && typeof assistantMsg.content === 'string') {
        const recovered = extractFallbackToolCall(assistantMsg.content);
        if (recovered) {
          const synthId = `call_${Date.now()}_${round}`;
          const synthetic = [{
            id: synthId,
            type: 'function' as const,
            function: { name: recovered.name, arguments: JSON.stringify(recovered.arguments) },
          }];
          // Replace the just-pushed assistant message so history is well-formed
          // (the next `tool` message must reference a valid tool_call_id).
          messages[messages.length - 1] = {
            role: 'assistant',
            content: '',
            tool_calls: synthetic,
          };
          toolCalls = synthetic;
        }
      }

      if (!toolCalls || toolCalls.length === 0) {
        // No tool calls — model produced a final response
        return assistantMsg.content || '';
      }

      // Execute each tool call and append results
      for (const tc of toolCalls) {
        if (signal?.aborted) throw new Error('Aborted');

        let args: Record<string, unknown>;
        try {
          args = typeof tc.function.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : tc.function.arguments;
        } catch {
          args = {};
        }

        const result = await onToolCall({
          id: tc.id,
          name: tc.function.name,
          arguments: args,
        });

        messages.push({
          role: 'tool',
          tool_call_id: result.toolCallId,
          content: result.content,
        });
      }
    }

    // Exceeded maxToolRounds — do one final call without tools to get a summary
    const finalBody: Record<string, unknown> = {
      model: this.model,
      messages: [
        ...messages,
        { role: 'user', content: 'You have reached the maximum number of tool call rounds. Please provide your final answer based on the information gathered so far.' },
      ],
      max_tokens: maxTokens,
      temperature,
    };
    if (responseFormat === 'json_object') {
      finalBody.response_format = { type: 'json_object' };
    }

    const finalResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(finalBody),
      signal,
    });

    if (!finalResponse.ok) {
      throw new Error('OpenRouter API error on final response');
    }

    const finalData = await finalResponse.json();
    return stripReasoning(finalData.choices?.[0]?.message?.content || '');
  }
}

export function createOpenRouterProvider(config: OpenRouterConfig): OpenRouterProvider {
  return new OpenRouterProvider(config);
}
