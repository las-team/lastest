import type { TestGenerationContext, CodebaseIntelligenceContext } from './types';

export const TEST_SIGNATURE = `export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any)`;

export const MCP_SYSTEM_PROMPT = `You are an expert visual regression test engineer. Use Playwright MCP tools to EXPLORE pages and discover accurate selectors, then OUTPUT standard Playwright test code.

MCP TOOLS: browser_navigate, browser_snapshot (accessibility tree + refs), browser_click, browser_type, browser_wait_for

WORKFLOW: navigate → snapshot → interact with refs → snapshot to verify → identify reliable selectors → OUTPUT test code

CRITICAL RULES:
- NEVER guess selectors — always verify via browser_snapshot first
- Element refs (e.g. "ref=s2e5") are for MCP exploration only, NOT for final test code
- Do NOT use browser_take_screenshot during exploration — screenshots go in the OUTPUT test code

DYNAMIC ROUTES (e.g. /users/[id]):
Navigate to the parent list page first, snapshot to find links with real IDs, then navigate to the actual URL.

CONSTRAINTS:
- Use baseUrl for navigation (no hardcoded URLs)
- Capture at least one screenshot using screenshotPath
- Export async function "test" with exact signature: ${TEST_SIGNATURE}
- Do NOT use \`import\` — \`expect\`, \`page\`, \`baseUrl\`, \`screenshotPath\`, \`stepLogger\` are provided by the runner
- expect matchers: toBe, toEqual, toBeTruthy, toBeFalsy, toContain, toHaveLength, toMatch, toMatchObject, toHaveURL, toHaveTitle, toBeVisible, toBeHidden, toHaveText, toContainText, toHaveAttribute, toHaveCount, toBeEnabled, toBeDisabled, toBeChecked, toHaveValue (all support .not)
- Never mix regex text and CSS selectors in one locator — use page.getByText(/pattern/i) for regex, page.locator('[attr="x"]') for CSS

FINAL OUTPUT: After exploration, generate standard Playwright test code using discovered selectors.

\`\`\`typescript
import { Page } from 'playwright';

${TEST_SIGNATURE} {
  stepLogger.log('Navigating to page');
  await page.goto(\`\${baseUrl}/path\`);
  await page.locator('[data-testid="discovered-element"]').click();
  stepLogger.log('Taking screenshot');
  await page.screenshot({ path: screenshotPath, fullPage: true });
}
\`\`\``;

export const SYSTEM_PROMPT = `You generate Playwright visual regression tests. Output ONLY a JavaScript code block.

RULES:
- Plain JavaScript, NO TypeScript, NO imports
- Signature: export async function test(page, baseUrl, screenshotPath, stepLogger)
- Navigate: await page.goto(\`\${baseUrl}/path\`, { waitUntil: 'domcontentloaded' })
- Wait: await page.waitForLoadState('domcontentloaded')
- URL assert: ALWAYS regex — await expect(page).toHaveURL(/\\/path/)
- Visibility: await expect(page.locator('body')).toBeVisible()
- Screenshot: await page.screenshot({ path: screenshotPath, fullPage: true })
- Log: stepLogger.log('message')

AUTH: Tests run with pre-authenticated browser state (Playwright storageState).
- Do NOT add login steps — auth cookies are already set
- If redirected to /login or /sign-in, the auth state expired — take screenshot and return gracefully
- After page.goto(), optionally check: if (page.url().includes('/login')) { await page.screenshot({ path: screenshotPath }); return; }

SYNTAX — CRITICAL:
- WRONG: const el: Locator = page.locator(...) → RIGHT: const el = page.locator(...)
- WRONG: import { expect } from '@playwright/test' → RIGHT: (no imports — expect is a parameter)
- WRONG: (page: Page, baseUrl: string) → RIGHT: (page, baseUrl, screenshotPath, stepLogger)
- Every statement must end with a semicolon or closing brace
- Every variable declaration must use const or let
- Verify all brackets/parens are balanced before outputting

ASSERTIONS — prefer resilient checks:
- Use toContainText() over exact toHaveText() when possible
- NEVER use toBeTruthy() on textContent() or getAttribute() results — they return null when missing
- WRONG: const t = await el.textContent(); expect(t).toBeTruthy()
- RIGHT: await expect(el).toBeVisible() or await expect(el).toContainText(/expected/)
- Prefer toBeVisible() for element presence checks
- If checking a count, use toHaveCount() with the expected number

EXAMPLE (static route):
\`\`\`javascript
export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log('Navigate');
  await page.goto(\`\${baseUrl}/settings\`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('domcontentloaded');
  await expect(page).toHaveURL(/\\/settings/);
  await expect(page.locator('body')).toBeVisible();
  stepLogger.log('Screenshot');
  await page.screenshot({ path: screenshotPath, fullPage: true });
}
\`\`\`

EXAMPLE (dynamic route — discover real ID from list page):
\`\`\`javascript
export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log('Navigate to list page to find a real item');
  await page.goto(\`\${baseUrl}/tests\`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('domcontentloaded');
  const firstLink = page.locator('a[href*="/tests/"]').first();
  await expect(firstLink).toBeVisible();
  const href = await firstLink.getAttribute('href');
  stepLogger.log('Navigate to detail page');
  await page.goto(\`\${baseUrl}\${href}\`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('body')).toBeVisible();
  stepLogger.log('Screenshot');
  await page.screenshot({ path: screenshotPath, fullPage: true });
}
\`\`\``;

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

    // Add codebase intelligence if available
    if (context.codebaseIntelligence) {
      parts.push(buildCodebaseIntelligenceSection(context.codebaseIntelligence));
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

  // Add codebase intelligence if available
  if (context.codebaseIntelligence) {
    parts.push(buildCodebaseIntelligenceSection(context.codebaseIntelligence));
  }

  if (context.availableRoutes?.length) {
    parts.push(`\n--- Available Routes (ONLY navigate to these) ---`);
    parts.push(context.availableRoutes.map(r => `- ${r}`).join('\n'));
    parts.push(`\nCRITICAL: Do NOT invent or guess URLs. ONLY use routes from the list above.`);
    parts.push(`If the test objective refers to a page not in this list, navigate to the closest matching route.`);
  }

  // Add guidelines and requirements sections
  parts.push(`
--- Requirements ---
- Plain JavaScript only — NO TypeScript annotations, NO imports
- Signature: export async function test(page, baseUrl, screenshotPath, stepLogger)
- Navigate: await page.goto(\`\${baseUrl}/path\`, { waitUntil: 'domcontentloaded' })
- URL checks: ALWAYS regex — await expect(page).toHaveURL(/\\/path/)
- Content checks: await expect(page.locator('body')).toBeVisible()
- Screenshot: await page.screenshot({ path: screenshotPath, fullPage: true })
- Log actions: stepLogger.log('message')

Return ONLY the code block, no explanations.`);

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

function buildCodebaseIntelligenceSection(intel: CodebaseIntelligenceContext): string {
  const lines: string[] = ['\n--- Project Intelligence ---'];

  if (intel.framework) lines.push(`Framework: ${intel.framework}`);
  if (intel.cssFramework) lines.push(`CSS: ${intel.cssFramework}`);
  if (intel.selectorStrategy) lines.push(`Selector strategy: ${intel.selectorStrategy}`);
  if (intel.authMechanism && intel.authMechanism !== 'none detected') {
    lines.push(`Auth: ${intel.authMechanism} — protected routes may redirect to login`);
  }
  if (intel.stateManagement) lines.push(`State management: ${intel.stateManagement}`);
  if (intel.apiLayer) lines.push(`API layer: ${intel.apiLayer}`);
  if (intel.projectDescription) lines.push(`App: ${intel.projectDescription}`);

  if (intel.testingRecommendations && intel.testingRecommendations.length > 0) {
    lines.push('\nTesting recommendations:');
    for (const rec of intel.testingRecommendations.slice(0, 8)) {
      lines.push(`- ${rec}`);
    }
  }

  return lines.join('\n');
}

export function createFixPrompt(context: TestGenerationContext): string {
  const parts: string[] = [`Fix this failing Playwright test.

Original test code:
\`\`\`typescript
${context.existingCode}
\`\`\`

Error message:
${context.errorMessage}`];

  if (context.codebaseIntelligence) {
    parts.push(buildCodebaseIntelligenceSection(context.codebaseIntelligence));
  }

  if (context.availableRoutes?.length) {
    parts.push(`\nAvailable Routes (ONLY use these in page.goto()):`);
    parts.push(context.availableRoutes.map(r => `- ${r}`).join('\n'));
    parts.push(`If the current page.goto() URL is not in this list, change it to the closest matching route.`);
  }

  parts.push(`
ERROR DIAGNOSIS — identify the category FIRST, then apply the matching fix strategy:
- "Unexpected identifier" or "Unexpected token" → SYNTAX ERROR: Look for missing commas, semicolons, or unmatched brackets. Remove any TypeScript annotations (: Type, as Type). Remove any import statements.
- "404" or "not found" → WRONG URL: The page.goto() URL doesn't exist. Change it to a route from the available routes list.
- "timeout" or "waiting for selector" → SELECTOR MISMATCH: The element doesn't exist with that selector. Use broader selectors (getByRole, getByText) or remove the assertion.
- "X is not a function" → INVALID API: Using a non-existent method. Check expect() matcher names and Playwright API.
- "Expected" + "Received" → ASSERTION FAILURE: The page content doesn't match expectations. Loosen the assertion or use a more flexible match (toContain instead of toBe, regex instead of exact string).
- "login" or "redirect" or "sign-in" → AUTH ISSUE: Add auth state check — if (page.url().includes('/login')) return;
- "net::ERR" or "ERR_CONNECTION" → NETWORK ERROR: The server may not be ready. Add waitForLoadState('domcontentloaded').

Instructions:
1. Identify which error category above matches the error message
2. Mentally trace the exact line that caused the error
3. Apply ONLY the minimal fix for that category — do not rewrite the entire test
4. Verify your fix actually changes something (not identical to input)

COMMON FIX PATTERNS:
- "Unexpected identifier" often means a variable is used without declaration (missing const/let) or a line is missing a semicolon before the next statement
- "Expected value to be truthy but got false" means toBeTruthy() was called on a falsy value — replace with toBeVisible() on a locator, or remove the assertion entirely if it's not critical
- If you see \`const x = await el.textContent(); expect(x).toBeTruthy()\` → replace with \`await expect(el).toBeVisible()\` or \`await expect(el).toContainText(/something/)\`

Rules:
- Write plain JavaScript only — NO TypeScript type annotations (no ": Page", no ": string", no ": any")
- Do NOT use \`import\` — expect is provided by the runner
- ALWAYS use regex for URL checks: await expect(page).toHaveURL(/\\/path/); — never exact string URLs
- Never mix regex text and CSS selectors in one locator — use page.getByText(/pattern/i) for regex
- Every statement must end with a semicolon or closing brace
- Every variable declaration must use const or let

DYNAMIC ROUTES: If testing a detail page (e.g., /tests/[id]), navigate to the list page first, find a real link, then follow it. Never hardcode fake IDs.

BEFORE RETURNING — verify your output:
□ All page.goto() URLs match available routes listed above
□ No TypeScript annotations (: Type, as Type, <Type>)
□ No import statements
□ Every variable has const/let declaration
□ All brackets and parentheses are balanced
□ The fix addresses the specific error message above
□ Function signature is: export async function test(page, baseUrl, screenshotPath, stepLogger)

Return ONLY the fixed code, no explanations.`);

  return parts.join('\n');
}

export function createMcpFixPrompt(context: TestGenerationContext): string {
  const routeSection = context.availableRoutes?.length
    ? `\nAvailable Routes (ONLY use these in page.goto()):\n${context.availableRoutes.map(r => `- ${r}`).join('\n')}\n`
    : '';

  return `Fix this failing Playwright test by exploring the live page with MCP tools.

Original test code:
\`\`\`typescript
${context.existingCode}
\`\`\`

Error message:
${context.errorMessage}

Target URL: ${context.targetUrl || 'unknown'}
${routeSection}
ERROR DIAGNOSIS — identify the category FIRST:
- "Unexpected identifier/token" → SYNTAX ERROR: fix missing commas, remove TS annotations
- "404/not found" → WRONG URL: change to a route from available routes
- "timeout/selector" → SELECTOR MISMATCH: use browser_snapshot to find correct selectors
- "Expected value to be truthy" → replace toBeTruthy() with toBeVisible() on locator

Instructions:
- browser_navigate to the target URL, then browser_snapshot to see current page structure
- Compare actual page selectors/content with the failing test to identify what changed
- Fix the test using discovered selectors; maintain the same function signature and intent
- Write plain JavaScript only — NO TypeScript type annotations, NO imports
- ALWAYS use regex for URL checks: await expect(page).toHaveURL(/\\/path/);
- Use only valid matchers (toBe, toEqual, toBeTruthy, toBeFalsy, toContain, toMatch, toHaveURL, toHaveTitle, toBeVisible, toHaveText, toContainText, toHaveAttribute, toHaveCount, etc.)
- Never mix regex text and CSS selectors in one locator — use page.getByText(/pattern/i) for regex
- If the error is "Expected value to be truthy but got false", replace toBeTruthy() with toBeVisible() on a locator or remove the assertion
- Every variable declaration must use const or let
- Every statement must end with a semicolon or closing brace

BEFORE RETURNING — verify your output has no TypeScript, no imports, balanced brackets, and addresses the specific error.

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

export function createRouteScanPrompt(codebaseContext: string, repoFullName?: string, intelligence?: CodebaseIntelligenceContext): string {
  const repoLine = repoFullName ? `\nRepository: ${repoFullName}\n` : '';
  const intelSection = intelligence ? buildCodebaseIntelligenceSection(intelligence) : '';
  return `Analyze this codebase structure and identify all testable routes/pages.
${repoLine}${intelSection}
Codebase context:
${codebaseContext}

Return a JSON object with a flat array of routes:
{
  "routes": [
    {
      "path": "/users",
      "type": "static",
      "functionalArea": "User Management",
      "description": "User listing page",
      "testSuggestions": ["Verify user list loads", "Check pagination"]
    },
    {
      "path": "/users/[id]",
      "type": "dynamic",
      "functionalArea": "User Management",
      "description": "User profile page",
      "testSuggestions": ["Test with valid user ID", "Test error state for invalid ID"]
    },
    {
      "path": "/dashboard",
      "type": "static",
      "functionalArea": "Dashboard",
      "description": "Main dashboard page",
      "testSuggestions": ["Verify dashboard loads", "Check metric widgets"]
    }
  ]
}

Guidelines:
- Include all user-facing pages that benefit from visual regression testing
- Mark routes as "static" or "dynamic" based on URL parameters
- Use "functionalArea" to label the logical group (e.g. "Authentication", "Settings")
- Provide brief test suggestions for each route

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

export function createMCPExploreRoutesPrompt(baseURL: string, existingRoutes: string[], intelligence?: CodebaseIntelligenceContext): string {
  const seedSection = existingRoutes.length > 0
    ? `\nAlready known routes (use as seed starting points to explore deeper):\n${existingRoutes.map(r => `- ${r}`).join('\n')}`
    : '';
  const intelSection = intelligence ? buildCodebaseIntelligenceSection(intelligence) : '';

  return `You are exploring a live web application to discover all available routes/pages.

Base URL: ${baseURL}
${seedSection}${intelSection}

EXPLORATION INSTRUCTIONS:
1. Navigate to ${baseURL} and snapshot to find navigation links, sidebars, menus
2. Click through discovered links and record each unique URL pathname
3. Look for sub-navigation, tabs, or nested links on each page
4. Visit any known routes listed above as additional starting points
5. Note whether each route is static or dynamic (has IDs/slugs in the URL)

IMPORTANT:
- Only record routes belonging to this application (same origin as baseURL)
- Convert dynamic segments to bracket notation (e.g., /users/123 → /users/[id])
- Do NOT include hash fragments, query parameters, or external links

Return a flat JSON array of discovered routes:
\`\`\`json
{
  "routes": [
    {"path": "/dashboard", "type": "static", "functionalArea": "Dashboard", "description": "Main dashboard page", "testSuggestions": ["Verify dashboard loads correctly", "Check navigation elements"]},
    {"path": "/users/[id]", "type": "dynamic", "functionalArea": "User Management", "description": "User profile page", "testSuggestions": ["Test with valid user ID", "Test error state for invalid ID"]}
  ]
}
\`\`\`

Use "functionalArea" to label the logical group for each route (e.g. "Authentication", "Settings").

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
4. Provide a descriptive name for each AC that works as a test name

Format your response as markdown using this exact structure:

### User Story 1: [Functional area name]
**As a** [role]
**I want to** [feature/capability]
**So that** [benefit/value]

**Acceptance Criteria:**
- AC1: [Clear, testable criterion that describes expected behavior]
- AC2: [Another criterion]

### User Story 2: [Next functional area]
...

Guidelines:
- User Story titles should be concise functional area names (e.g., "User Authentication", "Dashboard Analytics")
- Each AC MUST describe a specific, observable user action and expected system response that can be verified in a browser
- Each AC should mention the specific page/route where the behavior occurs (e.g., "On the /settings page, ...")
- DO NOT include: questions, suggestions, meta-commentary, implementation tasks, or vague criteria
- DO NOT include ACs like "Create additional tests...", "Consider...", "Should we...", "Implement...", "Ensure proper..."
- Bad AC: "Ensure proper error handling" (vague, not testable)
- Good AC: "When user submits login form with wrong password, an error message 'Invalid credentials' appears"
- Bad AC: "The system should display data correctly" (vague, no specific elements)
- Good AC: "On the /tests page, a table of tests is visible with columns for name, status, and last run date"
- Each AC should be independently testable in a browser-based visual regression test
- Group ACs that test the SAME page/route under the same User Story
- If a requirement is not testable via browser interaction, skip it
- If the document doesn't follow formal US/AC format, infer them from the requirements`;
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
  codebaseIntelligence?: CodebaseIntelligenceContext;
  availableRoutes?: string[];
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

  if (context.codebaseIntelligence) {
    parts.push(buildCodebaseIntelligenceSection(context.codebaseIntelligence));
  }

  if (context.availableRoutes?.length) {
    parts.push(`\n--- Available Routes (ONLY navigate to these) ---`);
    parts.push(context.availableRoutes.map(r => `- ${r}`).join('\n'));
    parts.push(`\nCRITICAL: Do NOT invent or guess URLs. ONLY use routes from the list above.`);
    parts.push(`If the acceptance criterion refers to a page not in this list, navigate to the closest matching route and test what is available there.`);
  }

  parts.push(`
--- Guidelines ---
- Write the test to verify the acceptance criterion
- Use descriptive stepLogger.log() messages matching the AC steps
- Add assertions that verify the expected behavior
- Capture screenshots at meaningful states
- Handle loading states for stable screenshots

DYNAMIC ROUTES (paths with [id], [slug], etc.):
- First navigate to the parent list page (e.g., for /tests/[id], go to /tests)
- Wait for the page to load, then find a link or row in the list
- Click the first item or extract its href to get a real URL with an actual ID
- Then test the detail page with real data
- NEVER hardcode fake IDs like "123" or "test-id"

SELECTORS (this app uses shadcn/ui + Tailwind CSS):
- Buttons: page.getByRole('button', { name: '...' })
- Inputs: page.getByRole('textbox') or page.getByLabel('...')
- Tabs: page.getByRole('tab', { name: '...' })
- Dialog: page.getByRole('dialog')
- Links: page.getByRole('link', { name: '...' })
- Headings: page.getByRole('heading', { name: '...' })
- Prefer getByRole/getByText/getByLabel over CSS selectors

LOADING STATES:
- After navigation: await page.waitForLoadState('domcontentloaded')
- Before assertions: allow time for dynamic content to render
- For async data: await page.locator('[data-loading]').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})

--- Requirements ---
- Plain JavaScript only — NO TypeScript annotations, NO imports
- Function signature: export async function test(page, baseUrl, screenshotPath, stepLogger)
- Navigate: await page.goto(\`\${baseUrl}/path\`, { waitUntil: 'domcontentloaded' })
- URL checks: ALWAYS regex — await expect(page).toHaveURL(/\\/path/)
- At least one screenshot must be captured
- Use baseUrl parameter for navigation
- ASSERTIONS: prefer toBeVisible() for element checks, toContainText() for text, regex toHaveURL() for URLs
- NEVER use toBeTruthy() on a value that might not exist — use toBeVisible() on the locator instead

Return ONLY the code block, no explanations.`);

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
