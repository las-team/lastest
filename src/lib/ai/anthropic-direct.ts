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
    // For diff analysis, streaming is not needed. Fall back to non-streaming.
    try {
      const result = await this.generate(options);
      callbacks.onComplete?.(result);
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Generation failed');
      callbacks.onError?.(err);
      throw err;
    }
  }
}

export function createAnthropicDirectProvider(config: AnthropicDirectConfig): AnthropicDirectProvider {
  return new AnthropicDirectProvider(config);
}
