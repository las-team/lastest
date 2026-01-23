import type { TestGenerationContext } from './types';

export const TEST_SIGNATURE = `export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any)`;

export const MCP_SYSTEM_PROMPT = `You are an expert visual regression test engineer. Use Playwright MCP tools to EXPLORE pages and discover accurate selectors, then OUTPUT standard Playwright test code.

AVAILABLE MCP TOOLS FOR EXPLORATION:
- mcp__plugin_playwright_playwright__browser_navigate - Navigate to URLs
- mcp__plugin_playwright_playwright__browser_snapshot - Get accessibility tree with element refs and text content
- mcp__plugin_playwright_playwright__browser_click - Click elements (requires ref from snapshot)
- mcp__plugin_playwright_playwright__browser_type - Type into inputs (requires ref from snapshot)
- mcp__plugin_playwright_playwright__browser_wait_for - Wait for text or time

EXPLORATION WORKFLOW:
1. browser_navigate to the target URL
2. browser_snapshot to see the page structure, element refs, and text content
3. Use browser_click/browser_type with refs to interact and explore
4. browser_snapshot again after interactions to verify state changes
5. Identify reliable selectors from the snapshot (data-testid, aria-labels, roles, text)

CRITICAL RULES:
- Use MCP tools to EXPLORE and DISCOVER what's on the page
- NEVER guess selectors - always verify them via browser_snapshot first
- Element refs (like "ref=s2e5") are for MCP exploration only, NOT for final test code
- Do NOT use browser_take_screenshot during exploration - screenshots go in the OUTPUT test code
- After exploring, OUTPUT standard Playwright test code using discovered selectors

DYNAMIC ROUTE DISCOVERY:
When testing routes with parameters like /users/[id] or /posts/[slug]:
1. First browser_navigate to the parent list page (e.g., /users)
2. browser_snapshot to find links with actual IDs/slugs in href attributes
3. Extract the real URL and navigate to it
4. Explore the actual page with real data

FINAL OUTPUT FORMAT:
After exploration, generate standard Playwright test code.
IMPORTANT: The function body must use plain JavaScript only - do NOT use TypeScript type annotations (no ": string", ": Type[]", "as Type", etc.) inside the function body. The signature uses types but the body is executed at runtime as JavaScript.

\`\`\`typescript
import { Page } from 'playwright';

${TEST_SIGNATURE} {
  stepLogger.log('Navigating to page');
  await page.goto(\`\${baseUrl}/path\`);

  // Use selectors discovered from MCP exploration
  await page.locator('[data-testid="discovered-element"]').click();

  // Use plain JS - no type annotations in the body
  const items = [];

  stepLogger.log('Taking screenshot');
  await page.screenshot({ path: screenshotPath, fullPage: true });
}
\`\`\``;

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
- Keep tests focused and atomic
- IMPORTANT: Do NOT use TypeScript type annotations inside the function body (no ": string", ": number", ": string[]", etc). The function signature uses types but the body must be plain JavaScript since it is executed at runtime via eval.`;

export function createTestPrompt(context: TestGenerationContext): string {
  const parts: string[] = [];

  if (context.useMCP) {
    parts.push('Use MCP tools to explore the page, then generate standard Playwright test code.');

    if (context.userPrompt) {
      parts.push(`\nUser request: ${context.userPrompt}`);
    }

    if (context.targetUrl || context.routePath) {
      const route = context.targetUrl || context.routePath;
      parts.push(`\nTarget route: ${route}`);

      if (context.isDynamicRoute) {
        parts.push(`\nThis is a DYNAMIC route with parameters. You MUST:`);
        parts.push(`1. First browser_navigate to a parent/list page`);
        parts.push(`2. Use browser_snapshot to find links with actual IDs`);
        parts.push(`3. Navigate to discovered URL with real parameters`);

        if (context.siblingRoutes?.length) {
          parts.push(`\nRelated routes that may help find real data: ${context.siblingRoutes.join(', ')}`);
        }
      }
    }

    parts.push(`\nWorkflow: navigate → snapshot → explore → OUTPUT Playwright test code with discovered selectors`);
    return parts.join('\n');
  }

  parts.push('Generate a Playwright visual regression test with the following requirements:');

  if (context.userPrompt) {
    parts.push(`\nUser request: ${context.userPrompt}`);
  }

  if (context.targetUrl || context.routePath) {
    const route = context.targetUrl || context.routePath;
    parts.push(`\nTarget route: ${route}`);

    if (context.isDynamicRoute) {
      parts.push(`\nIMPORTANT: This is a dynamic route. Before testing it directly:`);
      parts.push(`1. Navigate to the parent list page first (e.g., for /users/[id], go to /users)`);
      parts.push(`2. Wait for the list to load and find a valid link`);
      parts.push(`3. Click the link or extract the href to get a real ID`);
      parts.push(`4. Then test the actual page with real data`);

      if (context.siblingRoutes?.length) {
        parts.push(`\nRelated routes: ${context.siblingRoutes.join(', ')}`);
      }
    }
  }

  parts.push(`\nReturn ONLY the code, no explanations. The code must start with the import and function signature. Do NOT use TypeScript type annotations inside the function body - only plain JavaScript.`);

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

Return ONLY the fixed code, no explanations. Do NOT use TypeScript type annotations inside the function body - only plain JavaScript.`;
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

  parts.push(`\nReturn ONLY the enhanced code, no explanations. Do NOT use TypeScript type annotations inside the function body - only plain JavaScript.`);

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

export function createSpecAnalysisPrompt(specContent: string): string {
  return `Analyze the following specification/documentation content and extract functional areas, routes, and test scenarios.

Specification content:
${specContent}

Return a JSON object with this exact structure:
{
  "functionalAreas": [
    {
      "name": "Area Name",
      "description": "Brief description of this functional area",
      "routes": [
        {
          "path": "/example-path",
          "type": "static",
          "description": "What this route does"
        }
      ]
    }
  ],
  "testScenarios": [
    {
      "route": "/example-path",
      "suggestions": ["Test scenario 1", "Test scenario 2"]
    }
  ]
}

Guidelines:
- Group related routes under logical functional areas
- Route type should be "static" or "dynamic" (dynamic routes have parameters like [id])
- For dynamic routes, use bracket notation: /users/[id]
- Test scenarios should be actionable visual regression test descriptions
- Focus on user-facing pages that benefit from visual testing
- Extract as many meaningful routes and test scenarios as possible from the spec

Return ONLY the JSON object, no explanations or markdown formatting.`;
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
