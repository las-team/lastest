import { describe, it, expect } from 'vitest';
import { stripReasoning, extractFallbackToolCall } from './openrouter';

describe('stripReasoning', () => {
  it('removes <think>…</think> blocks', () => {
    const input = '<think>I should call the tool</think>Final answer.';
    expect(stripReasoning(input)).toBe('Final answer.');
  });

  it('removes <thinking>…</thinking> blocks', () => {
    const input = '<thinking>step by step…</thinking>\n{"foo": 1}';
    expect(stripReasoning(input)).toBe('{"foo": 1}');
  });

  it('removes Nemotron-style <|thinking|> blocks', () => {
    const input = '<|thinking|>plan</|thinking|>code';
    expect(stripReasoning(input)).toBe('code');
  });

  it('removes <|begin_of_thought|>…<|end_of_thought|> blocks', () => {
    const input = '<|begin_of_thought|>hmm<|end_of_thought|>{"a":1}';
    expect(stripReasoning(input)).toBe('{"a":1}');
  });

  it('preserves code fences and surrounding content', () => {
    const input = '<think>plan</think>\n```js\nconsole.log(1);\n```';
    expect(stripReasoning(input)).toBe('```js\nconsole.log(1);\n```');
  });

  it('is a no-op on plain text without reasoning tags', () => {
    const input = 'just a normal response, no think tags.';
    expect(stripReasoning(input)).toBe(input);
  });

  it('handles multi-line and nested-looking content (non-greedy)', () => {
    const input = '<think>line1\nline2 with </closing> chars</think>after';
    expect(stripReasoning(input)).toBe('after');
  });

  it('handles empty input', () => {
    expect(stripReasoning('')).toBe('');
  });
});

describe('extractFallbackToolCall', () => {
  it('parses <tool_call>…</tool_call> tag form (Nemotron / Hermes)', () => {
    const content = '<tool_call>{"name":"browser_snapshot","arguments":{"url":"https://x"}}</tool_call>';
    expect(extractFallbackToolCall(content)).toEqual({
      name: 'browser_snapshot',
      arguments: { url: 'https://x' },
    });
  });

  it('parses fenced ```json block', () => {
    const content = 'I will now call:\n```json\n{"name":"browser_click","arguments":{"selector":"#go"}}\n```';
    expect(extractFallbackToolCall(content)).toEqual({
      name: 'browser_click',
      arguments: { selector: '#go' },
    });
  });

  it('parses bare JSON object in content', () => {
    const content = 'okay -> {"name":"browser_navigate","arguments":{"url":"/home"}}';
    expect(extractFallbackToolCall(content)).toEqual({
      name: 'browser_navigate',
      arguments: { url: '/home' },
    });
  });

  it('accepts `parameters` as an alias for `arguments`', () => {
    const content = '<tool_call>{"name":"foo","parameters":{"x":1}}</tool_call>';
    expect(extractFallbackToolCall(content)).toEqual({
      name: 'foo',
      arguments: { x: 1 },
    });
  });

  it('parses string-encoded arguments', () => {
    const content = '<tool_call>{"name":"foo","arguments":"{\\"x\\":2}"}</tool_call>';
    expect(extractFallbackToolCall(content)).toEqual({
      name: 'foo',
      arguments: { x: 2 },
    });
  });

  it('returns null for plain prose with no tool call shape', () => {
    expect(extractFallbackToolCall('Just a normal answer.')).toBeNull();
  });

  it('returns null for JSON without a name field', () => {
    expect(extractFallbackToolCall('{"foo":"bar"}')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(extractFallbackToolCall('')).toBeNull();
  });
});
