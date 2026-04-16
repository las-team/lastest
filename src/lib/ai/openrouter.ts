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
    const { prompt, systemPrompt, maxTokens = 4096, temperature = 0.7, images, signal } = options;

    const messages: ChatMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push(buildUserMessage(truncatePrompt(prompt), images));

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model: this.model, messages, max_tokens: maxTokens, temperature }),
      signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
      throw new Error(`OpenRouter API error: ${error.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async generateStream(options: GenerateOptions, callbacks: StreamCallbacks): Promise<void> {
    const { prompt, systemPrompt, maxTokens = 4096, temperature = 0.7, images, signal } = options;

    const messages: ChatMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push(buildUserMessage(truncatePrompt(prompt), images));

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ model: this.model, messages, max_tokens: maxTokens, temperature, stream: true }),
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

      callbacks.onComplete?.(fullText);
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
    tools: ToolDefinition[];
    maxToolRounds?: number;
    onToolCall: (call: ToolCall) => Promise<ToolResult>;
  }): Promise<string> {
    const {
      prompt, systemPrompt, maxTokens = 4096, temperature = 0.7,
      images, signal, tools, maxToolRounds = 50, onToolCall,
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

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: this.model,
          messages,
          max_tokens: maxTokens,
          temperature,
          tools: openaiTools,
        }),
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

      // Append assistant message to conversation history
      messages.push(assistantMsg);

      const toolCalls = assistantMsg.tool_calls;
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
    const finalResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: this.model,
        messages: [
          ...messages,
          { role: 'user', content: 'You have reached the maximum number of tool call rounds. Please provide your final answer based on the information gathered so far.' },
        ],
        max_tokens: maxTokens,
        temperature,
      }),
      signal,
    });

    if (!finalResponse.ok) {
      throw new Error('OpenRouter API error on final response');
    }

    const finalData = await finalResponse.json();
    return finalData.choices?.[0]?.message?.content || '';
  }
}

export function createOpenRouterProvider(config: OpenRouterConfig): OpenRouterProvider {
  return new OpenRouterProvider(config);
}
