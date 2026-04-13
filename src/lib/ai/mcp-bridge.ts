/**
 * MCP Client Bridge — spawns an MCP server (e.g. @playwright/mcp) as a stdio
 * subprocess and exposes its tools in OpenAI-compatible format for use with
 * providers that support function calling (OpenRouter, Anthropic Direct, OpenAI).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ToolDefinition, ToolCall, ToolResult } from './types';

export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export class MCPBridge {
  private client: Client;
  private transport: StdioClientTransport;
  private connected = false;

  constructor(private serverConfig: MCPServerConfig) {
    this.client = new Client({ name: 'lastest-mcp-bridge', version: '1.0.0' });
    this.transport = new StdioClientTransport({
      command: serverConfig.command,
      args: serverConfig.args,
      env: serverConfig.env,
      stderr: 'pipe',
    });
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.client.connect(this.transport);
    this.connected = true;
  }

  /**
   * List all tools from the MCP server, returned as ToolDefinition[] ready
   * for conversion to OpenAI function-calling format.
   */
  async listTools(): Promise<ToolDefinition[]> {
    if (!this.connected) await this.connect();

    const result = await this.client.listTools();
    return result.tools.map(tool => ({
      name: tool.name,
      description: tool.description || '',
      inputSchema: (tool.inputSchema as Record<string, unknown>) || { type: 'object', properties: {} },
    }));
  }

  /**
   * Call a tool on the MCP server. Used as the `onToolCall` callback for
   * provider tool-calling loops.
   */
  async callTool(call: ToolCall): Promise<ToolResult> {
    if (!this.connected) await this.connect();

    try {
      const result = await this.client.callTool({
        name: call.name,
        arguments: call.arguments,
      });

      // MCP returns content as an array of content blocks
      const content = Array.isArray(result.content)
        ? result.content
            .map(block => {
              if (block.type === 'text') return block.text;
              if (block.type === 'image') return `[image: ${block.mimeType}]`;
              return JSON.stringify(block);
            })
            .join('\n')
        : String(result.content ?? '');

      return {
        toolCallId: call.id,
        content,
        isError: result.isError === true,
      };
    } catch (error) {
      return {
        toolCallId: call.id,
        content: `Tool call error: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    try {
      await this.client.close();
    } catch {
      // Ignore close errors — subprocess may have already exited
    }
    this.connected = false;
  }
}

/**
 * Create an MCPBridge for the Playwright MCP server.
 * Mirrors the config used in generator-agent.ts / generateWithAI MCP injection.
 */
export function createPlaywrightMCPBridge(options?: {
  cdpEndpoint?: string;
  headless?: boolean;
}): MCPBridge {
  const args = ['@playwright/mcp@latest'];
  if (options?.cdpEndpoint) {
    args.push('--cdp-endpoint', options.cdpEndpoint);
  }
  if (options?.headless !== false) {
    args.push('--headless');
  }
  return new MCPBridge({ command: 'npx', args });
}
