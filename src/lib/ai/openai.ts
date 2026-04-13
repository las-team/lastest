import type { AIProvider, GenerateOptions, StreamCallbacks, ToolDefinition, ToolCall, ToolResult } from './types';

export interface OpenAIConfig {
  apiKey: string;
  model: string;
}

export class OpenAIProvider implements AIProvider {
  private apiKey: string;
  private model: string;

  constructor(config: OpenAIConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  async generate(options: GenerateOptions): Promise<string> {
    const { prompt, systemPrompt, maxTokens = 4096, temperature = 0.7, images, signal } = options;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: { role: string; content: any }[] = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    if (images && images.length > 0) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...images.map(img => ({
            type: 'image_url',
            image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
          })),
        ],
      });
    } else {
      messages.push({ role: 'user', content: prompt });
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
      signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
      throw new Error(`OpenAI API error: ${error.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async generateStream(options: GenerateOptions, callbacks: StreamCallbacks): Promise<void> {
    const { prompt, systemPrompt, maxTokens = 4096, temperature = 0.7, signal } = options;

    const messages: { role: string; content: string }[] = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          max_tokens: maxTokens,
          temperature,
          stream: true,
        }),
        signal,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
        throw new Error(`OpenAI API error: ${error.error?.message || 'Unknown error'}`);
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: { role: string; content: any; tool_calls?: any[]; tool_call_id?: string }[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    if (images && images.length > 0) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...images.map(img => ({
            type: 'image_url',
            image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
          })),
        ],
      });
    } else {
      messages.push({ role: 'user', content: prompt });
    }

    const openaiTools = tools.map(t => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));

    for (let round = 0; round < maxToolRounds; round++) {
      if (signal?.aborted) throw new Error('Aborted');

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: this.model, messages, max_tokens: maxTokens, temperature, tools: openaiTools }),
        signal,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
        throw new Error(`OpenAI API error: ${error.error?.message || 'Unknown error'}`);
      }

      const data = await response.json();
      const choice = data.choices?.[0];
      if (!choice) throw new Error('OpenAI returned no choices');

      const assistantMsg = choice.message;
      messages.push(assistantMsg);

      const toolCalls = assistantMsg.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        return assistantMsg.content || '';
      }

      for (const tc of toolCalls) {
        if (signal?.aborted) throw new Error('Aborted');

        let args: Record<string, unknown>;
        try {
          args = typeof tc.function.arguments === 'string'
            ? JSON.parse(tc.function.arguments) : tc.function.arguments;
        } catch { args = {}; }

        const result = await onToolCall({ id: tc.id, name: tc.function.name, arguments: args });
        messages.push({ role: 'tool', tool_call_id: result.toolCallId, content: result.content });
      }
    }

    // Exceeded maxToolRounds
    const finalResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [...messages, { role: 'user', content: 'Maximum tool call rounds reached. Provide your final answer.' }],
        max_tokens: maxTokens, temperature,
      }),
      signal,
    });

    if (!finalResponse.ok) throw new Error('OpenAI API error on final response');
    const finalData = await finalResponse.json();
    return finalData.choices?.[0]?.message?.content || '';
  }
}

export function createOpenAIProvider(config: OpenAIConfig): OpenAIProvider {
  return new OpenAIProvider(config);
}
