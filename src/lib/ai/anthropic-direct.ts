import type { AIProvider, GenerateOptions, StreamCallbacks } from './types';

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
    const { prompt, systemPrompt, maxTokens = 4096, temperature = 0.7, images } = options;

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
    const { prompt, systemPrompt, maxTokens = 4096, temperature = 0.7, images } = options;

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
}

export function createAnthropicDirectProvider(config: AnthropicDirectConfig): AnthropicDirectProvider {
  return new AnthropicDirectProvider(config);
}
