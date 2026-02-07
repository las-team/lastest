import type { AIProvider, GenerateOptions, StreamCallbacks } from './types';

export interface OllamaConfig {
  baseUrl: string;
  model: string;
}

export class OllamaProvider implements AIProvider {
  private baseUrl: string;
  private model: string;

  constructor(config: OllamaConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.model = config.model;
  }

  async generate(options: GenerateOptions): Promise<string> {
    const { prompt, systemPrompt, maxTokens = 4096, temperature = 0.7, images } = options;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: { role: string; content: any }[] = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    // Handle multimodal (vision models like llava)
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

    // OpenAI-compatible endpoint
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        error: { message: response.statusText }
      }));
      throw new Error(`Ollama API error: ${error.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async generateStream(options: GenerateOptions, callbacks: StreamCallbacks): Promise<void> {
    const { prompt, systemPrompt, maxTokens = 4096, temperature = 0.7 } = options;

    const messages: { role: string; content: string }[] = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          max_tokens: maxTokens,
          temperature,
          stream: true,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          error: { message: response.statusText }
        }));
        throw new Error(`Ollama API error: ${error.error?.message || 'Unknown error'}`);
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
}

export function createOllamaProvider(config: OllamaConfig): OllamaProvider {
  return new OllamaProvider(config);
}
