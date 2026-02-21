# Feature Spec: AI Prompt System

## Overview

Simplified AI prompt functions for code diff scanning and MCP-based test fixing. Prompts were streamlined (30-40% more concise) while maintaining functional parity.

## New Prompt Functions

### `createCodeDiffScanPrompt(changedFilesContext, baseBranch, headBranch, repoFullName)`
**Purpose**: AI analyzes git diffs to identify which visual tests are affected by code changes.

**Parameters**:
- `changedFilesContext` — string of file paths and diff content
- `baseBranch` — base branch name (e.g., `main`)
- `headBranch` — head branch name (e.g., `feature/login`)
- `repoFullName` — GitHub repo identifier (e.g., `owner/repo`) — required

**Returns**: Prompt string that instructs AI to:
1. Analyze changed files
2. Identify affected UI areas/routes
3. Map to existing test coverage
4. Suggest which tests to run

### `createMcpFixPrompt(context: TestGenerationContext)`
**Purpose**: AI uses MCP tools to explore a live page and discover working selectors for fixing failing tests.

**Parameters**: `TestGenerationContext` object with test code, error messages, and page context.

**Returns**: Prompt string focused on MCP tool-based selector discovery on live pages.

## Modified Prompt Functions

### `createRouteScanPrompt()`
- **Changed**: Returns flat JSON array instead of grouped functional areas
- **Removed**: `repoFullName` parameter (no longer accepted)

### `createMCPExploreRoutesPrompt()`
- **Changed**: Returns flat array instead of grouped structure

### General Simplification
All prompts stripped of:
- Repetitive matcher lists
- Selector rules documentation
- Import statement examples
- ~40 lines of technical constraints per prompt

## AI Providers
4 supported providers (unchanged):
- `claude-cli` — Claude CLI tool
- `openrouter` — OpenRouter API
- `claude-agent-sdk` — Claude Agent SDK
- `anthropic-direct` — Direct Anthropic API

**Removed**: Ollama provider support (from diff-analyzer)

## Key Files
| File | Purpose |
|------|---------|
| `src/lib/ai/prompts.ts` | All prompt builders |
| `src/lib/ai/diff-analyzer.ts` | Visual diff classification |
| `src/lib/ai/parallel.ts` | Concurrent AI execution |
| `src/lib/ai/claude-cli.ts` | Claude CLI integration |
| `src/lib/ai/claude-agent-sdk.ts` | Agent SDK integration |
