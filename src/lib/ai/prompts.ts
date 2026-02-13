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
5. Identify reliable selectors from the snapshot

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

FREEDOM:
- Choose selectors that best match the page structure you discover
- Design the test flow based on what you observe during exploration
- Add meaningful assertions that verify the page behaves correctly
- Take screenshots at states that best capture the visual appearance
- Handle loading states and dynamic content as appropriate

CONSTRAINTS:
- Use baseUrl parameter for navigation (not hardcoded URLs)
- Capture at least one screenshot using screenshotPath
- Export async function "test" with exact signature: ${TEST_SIGNATURE}
- Do NOT use \`import\` statements — \`expect\`, \`page\`, \`baseUrl\`, \`screenshotPath\`, and \`stepLogger\` are provided by the runner

AVAILABLE expect MATCHERS (provided by the runner, do NOT import):
- Generic: toBe, toEqual, toBeTruthy, toBeFalsy, toBeNull, toBeUndefined, toBeDefined, toContain, toHaveLength, toBeGreaterThan, toBeLessThan, toBeGreaterThanOrEqual, toBeLessThanOrEqual, toMatch(string|RegExp), toMatchObject
- Page: toHaveURL(string|RegExp), toHaveTitle(string|RegExp)
- Locator: toBeVisible, toBeHidden, toHaveText(string|RegExp), toContainText(string), toHaveAttribute(name, value), toHaveCount(n), toBeEnabled, toBeDisabled, toBeChecked, toHaveValue(string)
- All matchers support .not (e.g. expect(x).not.toBe(y))

SELECTOR RULES:
- Never mix regex text selectors with CSS in one locator string (BAD: \`text=/pattern/i, [data-testid]\`)
- Use page.getByText(/pattern/i) for regex text matching
- Use page.locator('[data-testid="x"]') for CSS selectors

FINAL OUTPUT FORMAT:
After exploration, generate standard Playwright test code.

\`\`\`typescript
import { Page } from 'playwright';

${TEST_SIGNATURE} {
  stepLogger.log('Navigating to page');
  await page.goto(\`\${baseUrl}/path\`);

  // Use selectors discovered from MCP exploration
  await page.locator('[data-testid="discovered-element"]').click();

  stepLogger.log('Taking screenshot');
  await page.screenshot({ path: screenshotPath, fullPage: true });
}
\`\`\``;

export const SYSTEM_PROMPT = `You are an expert Playwright test engineer creating visual regression tests.

FUNCTION SIGNATURE (required):
${TEST_SIGNATURE}

PARAMETERS:
- page: Playwright Page object
- baseUrl: Application base URL (e.g., "http://localhost:3000")
- screenshotPath: Path where screenshot should be saved
- stepLogger: Step documentation (use stepLogger.log('message'))

FREEDOM:
- Choose appropriate selectors (data-testid, aria-label, role, text, css)
- Design the test flow that best verifies the objective
- Add assertions that make sense for the scenario
- Take screenshots at meaningful states
- Handle loading states as needed for stable screenshots

CONSTRAINTS:
- Use baseUrl parameter for navigation (not hardcoded URLs)
- Capture at least one screenshot using screenshotPath
- Export async function "test" with exact signature above
- Do NOT use \`import\` statements — \`expect\`, \`page\`, \`baseUrl\`, \`screenshotPath\`, and \`stepLogger\` are provided by the runner

AVAILABLE expect MATCHERS (provided by the runner, do NOT import):
- Generic: toBe, toEqual, toBeTruthy, toBeFalsy, toBeNull, toBeUndefined, toBeDefined, toContain, toHaveLength, toBeGreaterThan, toBeLessThan, toBeGreaterThanOrEqual, toBeLessThanOrEqual, toMatch(string|RegExp), toMatchObject
- Page: toHaveURL(string|RegExp), toHaveTitle(string|RegExp)
- Locator: toBeVisible, toBeHidden, toHaveText(string|RegExp), toContainText(string), toHaveAttribute(name, value), toHaveCount(n), toBeEnabled, toBeDisabled, toBeChecked, toHaveValue(string)
- All matchers support .not (e.g. expect(x).not.toBe(y))

SELECTOR RULES:
- Never mix regex text selectors with CSS in one locator string (BAD: \`text=/pattern/i, [data-testid]\`)
- Use page.getByText(/pattern/i) for regex text matching
- Use page.locator('[data-testid="x"]') for CSS selectors
- Keep each locator type separate`;

export function createTestPrompt(context: TestGenerationContext): string {
  const parts: string[] = [];

  if (context.useMCP) {
    parts.push('Use MCP tools to explore the page, then generate standard Playwright test code.');

    if (context.userPrompt) {
      parts.push(`\nTest objective: ${context.userPrompt}`);
    }

    if (context.targetUrl || context.routePath) {
      const route = context.targetUrl || context.routePath;
      parts.push(`\nTarget: ${route}`);

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

    // Add scan context if available
    if (context.scanContext) {
      parts.push(buildScanContextSection(context.scanContext));
    }

    parts.push(`\nWorkflow: navigate → snapshot → explore → OUTPUT Playwright test code with discovered selectors`);
    return parts.join('\n');
  }

  parts.push('Generate a Playwright visual regression test.');

  if (context.userPrompt) {
    parts.push(`\nTest objective: ${context.userPrompt}`);
  }

  if (context.targetUrl || context.routePath) {
    const route = context.targetUrl || context.routePath;
    parts.push(`\nTarget: ${route}`);

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

  // Add scan context if available
  if (context.scanContext) {
    parts.push(buildScanContextSection(context.scanContext));
  }

  // Add guidelines and requirements sections
  parts.push(`
--- Guidelines ---
- Be creative with test flow and assertions
- Choose selectors that match the page structure
- Add meaningful assertions for the test objective
- Use stepLogger.log() to document key actions
- Capture screenshot(s) at meaningful states

--- Requirements ---
- Function signature: export async function test(page, baseUrl, screenshotPath, stepLogger)
- At least one screenshot must be captured
- Use baseUrl parameter for navigation
- Do NOT use \`import\` statements — expect and all parameters are provided by the runner
- Available expect matchers: toBe, toEqual, toBeTruthy, toBeFalsy, toContain, toHaveLength, toBeGreaterThan, toBeLessThan, toBeGreaterThanOrEqual, toBeLessThanOrEqual, toMatch(string|RegExp), toMatchObject
- Page matchers: toHaveURL, toHaveTitle. Locator: toBeVisible, toBeHidden, toHaveText, toContainText, toHaveAttribute, toHaveCount
- Never mix regex text and CSS selectors in one locator (use page.getByText(/regex/i) for regex matching)

Return ONLY the code, no explanations.`);

  return parts.join('\n');
}

function buildScanContextSection(scanContext: import('./types').ScanContext): string {
  const lines: string[] = ['\n--- Discovery Context ---'];

  // Add source-specific context
  if (scanContext.discoverySource === 'nav-link' && scanContext.navLabel) {
    lines.push(`This route appears in navigation as "${scanContext.navLabel}".`);
    lines.push('Verify the page matches its navigation label purpose.');
  }

  if (scanContext.discoverySource === 'spec-analysis' && scanContext.specDescription) {
    lines.push(`From specification: ${scanContext.specDescription}`);
    lines.push('Test the documented behavior.');
  }

  if (scanContext.discoverySource === 'file-scan' && scanContext.sourceFilePath) {
    lines.push(`Source file: ${scanContext.sourceFilePath}`);
  }

  // Add framework hint
  if (scanContext.framework) {
    lines.push(`Framework: ${scanContext.framework}`);
  }

  // Add router type if relevant
  if (scanContext.routerType) {
    lines.push(`Router: ${scanContext.routerType}`);
  }

  // Add test suggestions as scenarios to consider
  if (scanContext.testSuggestions && scanContext.testSuggestions.length > 0) {
    lines.push('\nSuggested scenarios to consider:');
    for (const suggestion of scanContext.testSuggestions) {
      lines.push(`- ${suggestion}`);
    }
  }

  // Add functional area context
  if (scanContext.functionalAreaName) {
    lines.push(`\nFunctional area: ${scanContext.functionalAreaName}`);
    if (scanContext.functionalAreaDescription) {
      lines.push(`Context: ${scanContext.functionalAreaDescription}`);
    }
  }

  return lines.join('\n');
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
5. Do NOT use \`import\` — expect is provided by the runner
6. Available matchers: toBe, toEqual, toBeTruthy, toBeFalsy, toContain, toHaveLength, toBeGreaterThan, toBeLessThan, toBeGreaterThanOrEqual, toBeLessThanOrEqual, toMatch(string|RegExp), toMatchObject
7. Page matchers: toHaveURL, toHaveTitle. Locator matchers: toBeVisible, toBeHidden, toHaveText, toContainText, toHaveAttribute, toHaveCount
8. Never mix regex text and CSS selectors in one locator string — use page.getByText(/pattern/i) for regex

Common fix patterns:
- "X is not a function" on expect → the matcher doesn't exist, use one from the list above
- "text=/regex/i" selector errors → use page.getByText(/regex/i) instead
- Timeout on waitForLoadState → use page.waitForLoadState('domcontentloaded') instead of 'networkidle'

Return ONLY the fixed code, no explanations.`;
}

export function createMcpFixPrompt(context: TestGenerationContext): string {
  return `Fix this failing Playwright test by exploring the live page with MCP tools.

Original test code:
\`\`\`typescript
${context.existingCode}
\`\`\`

Error message:
${context.errorMessage}

Target URL: ${context.targetUrl || 'unknown'}

Instructions:
1. Use browser_navigate to go to the target URL
2. Use browser_snapshot to see the current page structure and available selectors
3. Compare what the page actually has with the selectors/assertions in the failing test
4. Identify what changed on the page that caused the failure
5. Fix the test using selectors and content discovered from the live page
6. Maintain the same function signature and test intent
7. Do NOT use \`import\` — expect is provided by the runner
8. Available matchers: toBe, toEqual, toBeTruthy, toBeFalsy, toContain, toHaveLength, toBeGreaterThan, toBeLessThan, toBeGreaterThanOrEqual, toBeLessThanOrEqual, toMatch(string|RegExp), toMatchObject
9. Never mix regex text and CSS selectors in one locator string — use page.getByText(/regex/i) for regex

Return ONLY the fixed code, no explanations.`;
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

  parts.push(`\nReturn ONLY the enhanced code, no explanations.`);

  return parts.join('\n');
}

export function createRouteScanPrompt(codebaseContext: string, repoFullName?: string): string {
  const repoLine = repoFullName ? `\nRepository: ${repoFullName}\n` : '';
  return `Analyze this codebase structure and identify all testable routes/pages, grouped into logical functional areas.
${repoLine}
Codebase context:
${codebaseContext}

Return a JSON object with routes grouped into functional areas:
{
  "functionalAreas": [
    {
      "name": "User Management",
      "description": "User profiles, settings, and account management",
      "routes": [
        {
          "path": "/users",
          "type": "static",
          "description": "User listing page",
          "testSuggestions": ["Verify user list loads", "Check pagination"]
        },
        {
          "path": "/users/[id]",
          "type": "dynamic",
          "description": "User profile page",
          "testSuggestions": ["Test with valid user ID", "Test error state for invalid ID"]
        }
      ]
    },
    {
      "name": "Dashboard",
      "description": "Main dashboard and analytics views",
      "routes": [
        {
          "path": "/dashboard",
          "type": "static",
          "description": "Main dashboard page",
          "testSuggestions": ["Verify dashboard loads", "Check metric widgets"]
        }
      ]
    }
  ]
}

Guidelines:
- Group related routes under logical functional areas (e.g. "Authentication", "User Management", "Settings")
- Use clear, human-readable area names (NOT route paths)
- Include all user-facing pages
- Mark routes as "static" or "dynamic" based on URL parameters
- For dynamic routes, note the parameter pattern
- Provide brief test suggestions for each route
- Focus on routes that benefit from visual regression testing

Return ONLY the JSON object, no explanations.`;
}

export function createCodeDiffScanPrompt(
  changedFilesContext: string,
  baseBranch: string,
  headBranch: string,
  repoFullName?: string
): string {
  const repoNote = repoFullName ? `\nRepository: ${repoFullName}` : '';
  return `You are analyzing code changes between two git branches to identify what visual regression tests should be created to cover the specific changes.
${repoNote}
Base branch: ${baseBranch}
Head branch: ${headBranch}

Changed files and their contents:
${changedFilesContext}

Analyze the actual code changes above and identify:
1. What specific functionality was added or modified
2. Which user-facing pages/routes are affected by these changes
3. What specific behaviors should be tested based on the diff

For each affected route, generate test suggestions that target the EXACT changes — not generic page checks. For example:
- If a new button was added → "Test the new [button name] button click behavior"
- If form validation changed → "Verify updated validation rules for [field]"
- If a component was restyled → "Check visual appearance of [component] after style changes"
- If a new page was added → "Test the new [page] route renders correctly with expected elements"

Return a JSON object with this exact structure:
{
  "functionalAreas": [
    {
      "name": "Area Name",
      "description": "Brief description of what changed in this area",
      "routes": [
        {
          "path": "/affected-route",
          "type": "static",
          "description": "What changed on this page",
          "testSuggestions": ["Specific test targeting the actual code change"]
        }
      ]
    }
  ]
}

Guidelines:
- Group changes under logical functional areas based on what was modified
- Only include routes that are actually affected by the code changes
- Test suggestions MUST reference the specific change, not generic "verify page loads"
- Mark routes as "static" or "dynamic" based on URL parameters
- For dynamic routes, use bracket notation: /users/[id]
- If changes are purely backend/non-visual, still suggest routes where the effects would be visible

Return ONLY the JSON object, no explanations or markdown formatting.`;
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

export function createMCPExploreRoutesPrompt(baseURL: string, existingRoutes: string[]): string {
  const seedSection = existingRoutes.length > 0
    ? `\nAlready known routes (use as seed starting points to explore deeper):\n${existingRoutes.map(r => `- ${r}`).join('\n')}`
    : '';

  return `You are exploring a live web application to discover all available routes/pages, grouped into logical functional areas.

Base URL: ${baseURL}
${seedSection}

EXPLORATION INSTRUCTIONS:
1. Navigate to ${baseURL} and take a snapshot to find navigation links, sidebars, menus
2. Click through all discovered links and record each unique URL pathname
3. After visiting top-level pages, look for sub-navigation, tabs, or nested links
4. Visit any known routes listed above as additional starting points
5. For each discovered page, note whether the route is static or dynamic (has IDs/slugs in the URL)
6. Group the discovered routes into logical functional areas

IMPORTANT:
- Only record routes that belong to this application (same origin as baseURL)
- Convert dynamic segments to bracket notation (e.g., /users/123 → /users/[id])
- Do NOT include hash fragments, query parameters, or external links
- Explore as many unique pages as possible

Return your findings as a JSON object with routes grouped into functional areas:
\`\`\`json
{
  "functionalAreas": [
    {
      "name": "Dashboard",
      "description": "Main dashboard and analytics views",
      "routes": [
        {"path": "/dashboard", "type": "static", "description": "Main dashboard page", "testSuggestions": ["Verify dashboard loads correctly", "Check navigation elements"]}
      ]
    },
    {
      "name": "User Management",
      "description": "User profiles and account pages",
      "routes": [
        {"path": "/users/[id]", "type": "dynamic", "description": "User profile page", "testSuggestions": ["Test with valid user ID", "Test error state for invalid ID"]}
      ]
    }
  ]
}
\`\`\`

Guidelines:
- Group related routes under logical functional areas (e.g. "Authentication", "User Management", "Settings")
- Use clear, human-readable area names (NOT route paths)

Return ONLY the JSON object inside a code block, no other text.`;
}

export function createUserStoryExtractionPrompt(specContent: string): string {
  return `Analyze the following specification/requirements document and extract all User Stories (US) and their Acceptance Criteria (AC).

Document content:
${specContent}

Extract User Stories and Acceptance Criteria with the following rules:
1. Each distinct feature or capability should be its own User Story
2. Each User Story should have clear, testable Acceptance Criteria
3. Group related ACs under the same User Story
4. If an AC is complex enough to warrant multiple tests, split it
5. If multiple ACs are closely related and could be tested together, suggest grouping them
6. Provide a suggested test name for each AC

Return a JSON array with this exact structure:
[
  {
    "id": "US-1",
    "title": "User Story title (as a functional area name)",
    "description": "As a [role], I want [feature] so that [benefit]",
    "acceptanceCriteria": [
      {
        "id": "AC-1.1",
        "description": "Given [context], when [action], then [expected result]",
        "testName": "Suggested test name for this AC"
      },
      {
        "id": "AC-1.2",
        "description": "Given [context], when [action], then [expected result]",
        "testName": "Suggested test name for this AC",
        "groupedWith": "AC-1.1"
      }
    ]
  }
]

Guidelines:
- User Story titles should be concise and work well as functional area names (e.g., "User Authentication", "Dashboard Analytics")
- AC descriptions should be specific and testable
- Use "groupedWith" only when two ACs are so closely related they should be a single test
- Test names should be descriptive (e.g., "Login with valid credentials", "Dashboard shows correct metrics")
- Extract as many meaningful stories and criteria as the document supports
- If the document doesn't follow formal US/AC format, infer them from the requirements

Return ONLY the JSON array, no explanations or markdown formatting.`;
}

export function createBranchAwareTestPrompt(context: {
  testName: string;
  acceptanceCriteria: string;
  userStoryTitle: string;
  userStoryDescription: string;
  targetUrl?: string;
  branchChanges?: {
    changedFiles: string[];
    fileDiffs?: string;
  };
}): string {
  const parts: string[] = [];

  parts.push(`Generate a Playwright visual regression test for the following acceptance criterion.

User Story: ${context.userStoryTitle}
${context.userStoryDescription}

Acceptance Criterion: ${context.acceptanceCriteria}
Test Name: ${context.testName}`);

  if (context.targetUrl) {
    parts.push(`\nTarget URL: ${context.targetUrl}`);
  }

  if (context.branchChanges) {
    parts.push(`\n--- Branch Code Context ---`);
    parts.push(`The following files have been changed in the branch:`);
    for (const file of context.branchChanges.changedFiles) {
      parts.push(`- ${file}`);
    }
    if (context.branchChanges.fileDiffs) {
      parts.push(`\nRelevant code changes:\n${context.branchChanges.fileDiffs}`);
    }
    parts.push(`\nUse this context to write more accurate selectors and assertions based on the actual code changes.`);
  }

  parts.push(`
--- Guidelines ---
- Write the test to verify the acceptance criterion
- Use descriptive stepLogger.log() messages matching the AC steps
- Add assertions that verify the expected behavior
- Capture screenshots at meaningful states
- Handle loading states for stable screenshots

--- Requirements ---
- Function signature: export async function test(page, baseUrl, screenshotPath, stepLogger)
- At least one screenshot must be captured
- Use baseUrl parameter for navigation

Return ONLY the code, no explanations.`);

  return parts.join('\n');
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
