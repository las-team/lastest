import type { AIProvider, GenerateOptions, StreamCallbacks, ToolDefinition, ToolCall, ToolResult } from './types';

export interface AnthropicDirectConfig {
  apiKey: string;
  model: string;
}

export class AnthropicDirectProvider implements AIProvider {
  private apiKey: string;
  private model: string;

  constructor(config: AnthropicDirectConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  async generate(options: GenerateOptions): Promise<string> {
    const { prompt, systemPrompt, maxTokens = 4096, temperature = 0.7, images, signal } = options;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any[] = [];

    // Add images first using Anthropic's native format
    if (images && images.length > 0) {
      for (const img of images) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: img.mediaType,
            data: img.base64,
          },
        });
      }
    }

    content.push({ type: 'text', text: prompt });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = {
      model: this.model,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: 'user', content }],
    };

    if (systemPrompt) {
      body.system = systemPrompt;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
      throw new Error(`Anthropic API error: ${error.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    const textBlocks = data.content?.filter((b: { type: string }) => b.type === 'text') || [];
    return textBlocks.map((b: { text: string }) => b.text).join('') || '';
  }

  async generateStream(options: GenerateOptions, callbacks: StreamCallbacks): Promise<void> {
    const { prompt, systemPrompt, maxTokens = 4096, temperature = 0.7, images, signal } = options;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any[] = [];

    if (images && images.length > 0) {
      for (const img of images) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: img.mediaType,
            data: img.base64,
          },
        });
      }
    }

    content.push({ type: 'text', text: prompt });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = {
      model: this.model,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: 'user', content }],
      stream: true,
    };

    if (systemPrompt) {
      body.system = systemPrompt;
    }

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
        throw new Error(`Anthropic API error: ${error.error?.message || 'Unknown error'}`);
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

            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
                const text = parsed.delta.text;
                if (text) {
                  fullText += text;
                  callbacks.onToken?.(text);
                }
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
    const messages: { role: string; content: any }[] = [];

    // Build initial user message
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userContent: any[] = [];
    if (images && images.length > 0) {
      for (const img of images) {
        userContent.push({
          type: 'image',
          source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
        });
      }
    }
    userContent.push({ type: 'text', text: prompt });
    messages.push({ role: 'user', content: userContent });

    // Anthropic tool format
    const anthropicTools = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));

    const headers = {
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    };

    for (let round = 0; round < maxToolRounds; round++) {
      if (signal?.aborted) throw new Error('Aborted');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body: any = {
        model: this.model, max_tokens: maxTokens, temperature, messages,
        tools: anthropicTools,
      };
      if (systemPrompt) body.system = systemPrompt;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers, body: JSON.stringify(body), signal,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
        throw new Error(`Anthropic API error: ${error.error?.message || 'Unknown error'}`);
      }

      const data = await response.json();

      // Append assistant response to conversation
      messages.push({ role: 'assistant', content: data.content });

      // Check if model wants to use tools
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolUseBlocks = data.content?.filter((b: any) => b.type === 'tool_use') || [];

      if (toolUseBlocks.length === 0 || data.stop_reason === 'end_turn') {
        // Extract text from response
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const textBlocks = data.content?.filter((b: any) => b.type === 'text') || [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return textBlocks.map((b: any) => b.text).join('') || '';
      }

      // Execute tool calls and build tool_result messages
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolResults: any[] = [];
      for (const block of toolUseBlocks) {
        if (signal?.aborted) throw new Error('Aborted');

        const result = await onToolCall({
          id: block.id,
          name: block.name,
          arguments: block.input || {},
        });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: result.toolCallId,
          content: result.content,
          is_error: result.isError || false,
        });
      }

      messages.push({ role: 'user', content: toolResults });
    }

    // Exceeded maxToolRounds — request final answer
    messages.push({ role: 'user', content: [{ type: 'text', text: 'Maximum tool call rounds reached. Provide your final answer.' }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const finalBody: any = { model: this.model, max_tokens: maxTokens, temperature, messages };
    if (systemPrompt) finalBody.system = systemPrompt;

    const finalResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers, body: JSON.stringify(finalBody), signal,
    });

    if (!finalResponse.ok) throw new Error('Anthropic API error on final response');
    const finalData = await finalResponse.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textBlocks = finalData.content?.filter((b: any) => b.type === 'text') || [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return textBlocks.map((b: any) => b.text).join('') || '';
  }
}

export function createAnthropicDirectProvider(config: AnthropicDirectConfig): AnthropicDirectProvider {
  return new AnthropicDirectProvider(config);
}
