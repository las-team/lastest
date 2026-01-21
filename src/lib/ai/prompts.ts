import type { TestGenerationContext } from './types';

export const TEST_SIGNATURE = `export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any)`;

export const SYSTEM_PROMPT = `You are an expert Playwright test engineer. Generate high-quality visual regression tests.

IMPORTANT: All tests MUST follow this exact function signature:
${TEST_SIGNATURE}

The test function receives:
- page: Playwright Page object
- baseUrl: The base URL of the application (e.g., "http://localhost:3000")
- screenshotPath: Path where the screenshot should be saved
- stepLogger: Logger for recording test steps (use stepLogger.log('message'))

Example test structure:
\`\`\`typescript
import { Page } from 'playwright';

${TEST_SIGNATURE} {
  stepLogger.log('Navigating to page');
  await page.goto(\`\${baseUrl}/dashboard\`);

  stepLogger.log('Waiting for content to load');
  await page.waitForSelector('[data-testid="main-content"]');

  stepLogger.log('Taking screenshot');
  await page.screenshot({ path: screenshotPath, fullPage: true });
}
\`\`\`

Guidelines:
- Always use the baseUrl parameter for navigation, not hardcoded URLs
- Use stepLogger.log() to document each significant action
- Prefer data-testid selectors when available
- Add appropriate waits for dynamic content
- Take screenshot at the end using the provided screenshotPath
- Handle loading states and animations
- Keep tests focused and atomic`;

export function createTestPrompt(context: TestGenerationContext): string {
  const parts: string[] = [];

  parts.push('Generate a Playwright visual regression test with the following requirements:');

  if (context.userPrompt) {
    parts.push(`\nUser request: ${context.userPrompt}`);
  }

  if (context.targetUrl || context.routePath) {
    parts.push(`\nTarget route: ${context.targetUrl || context.routePath}`);
  }

  parts.push(`\nReturn ONLY the TypeScript code, no explanations. The code must start with the import and function signature.`);

  return parts.join('\n');
}

export function createFixPrompt(context: TestGenerationContext): string {
  return `Fix this failing Playwright test.

Original test code:
\`\`\`typescript
${context.existingCode}
\`\`\`

Error message:
${context.errorMessage}

Instructions:
1. Analyze the error and identify the root cause
2. Fix the test while maintaining the same function signature
3. Keep the test's original intent
4. Add better error handling if needed

Return ONLY the fixed TypeScript code, no explanations.`;
}

export function createEnhancePrompt(context: TestGenerationContext): string {
  const parts: string[] = [];

  parts.push(`Enhance this Playwright visual regression test:

Current test code:
\`\`\`typescript
${context.existingCode}
\`\`\``);

  if (context.userPrompt) {
    parts.push(`\nEnhancement request: ${context.userPrompt}`);
  } else {
    parts.push(`\nEnhancements to make:
- Add more assertions to verify page state
- Improve selector reliability
- Add checks for common edge cases
- Improve logging with stepLogger
- Add waits for dynamic content`);
  }

  parts.push(`\nReturn ONLY the enhanced TypeScript code, no explanations.`);

  return parts.join('\n');
}

export function createRouteScanPrompt(codebaseContext: string): string {
  return `Analyze this codebase structure and identify all testable routes/pages.

Codebase context:
${codebaseContext}

Return a JSON array of routes with this structure:
[
  {
    "path": "/dashboard",
    "type": "static",
    "description": "Main dashboard page",
    "testSuggestions": ["Verify dashboard loads", "Check metric widgets"]
  },
  {
    "path": "/users/[id]",
    "type": "dynamic",
    "description": "User profile page",
    "testSuggestions": ["Test with valid user ID", "Test error state for invalid ID"]
  }
]

Guidelines:
- Include all user-facing pages
- Mark routes as "static" or "dynamic" based on URL parameters
- For dynamic routes, note the parameter pattern
- Provide brief test suggestions for each route
- Focus on routes that benefit from visual regression testing

Return ONLY the JSON array, no explanations.`;
}

export function extractCodeFromResponse(response: string): string {
  // Try to extract code from markdown code blocks
  const codeBlockMatch = response.match(/```(?:typescript|ts|javascript|js)?\n([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // If no code block, check if response starts with import or export
  if (response.trim().startsWith('import') || response.trim().startsWith('export')) {
    return response.trim();
  }

  // Return as-is if we can't extract
  return response.trim();
}
