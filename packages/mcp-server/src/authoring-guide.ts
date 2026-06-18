import type { LastestClient } from "./client.js";

/**
 * The durable "authoring contract" the calling agent must follow to produce a
 * test that Lastest's runner will accept. Distilled from the in-product
 * generation prompts (src/lib/ai/prompts.ts) so an external agent gets the same
 * brief the in-product AI used to get — this is the core of the MCP-first model:
 * the user's own agent writes the code, Lastest provides the contract + context.
 */
export const AUTHORING_CONTRACT = `# Lastest test authoring contract

A Lastest test is a single exported function. The runner injects everything —
DO NOT import anything.

## Signature (exact)
\`\`\`js
export async function test(page, baseUrl, screenshotPath, stepLogger) {
  // page         — a Playwright Page, already created
  // baseUrl       — the repo's base URL; build URLs as \`\${baseUrl}/path\`
  // screenshotPath — pass to page.screenshot({ path: screenshotPath })
  // stepLogger     — stepLogger.log('message') for human-readable steps
}
\`\`\`

## Hard rules
- **Plain JavaScript only.** No TypeScript annotations, no \`import\`/\`require\`.
- \`page\`, \`baseUrl\`, \`screenshotPath\`, \`stepLogger\`, and \`expect\` are all
  provided by the runner — never import or redeclare them.
- Navigate with \`await page.goto(\\\`\${baseUrl}/path\\\`, { waitUntil: 'domcontentloaded' })\`.
  Never hardcode an origin; always derive from \`baseUrl\`.
- Capture at least one screenshot: \`await page.screenshot({ path: screenshotPath, fullPage: true })\`.
- URL assertions must use a regex: \`await expect(page).toHaveURL(/\\/path/)\`.
- Prefer web-first assertions: \`await expect(locator).toBeVisible()\`,
  \`await expect(locator).toContainText(/.../)\` — do NOT read textContent()/count()
  into a variable and assert on it.

## Selector robustness (most important for stability)
- Prefer role/label/text/test-id selectors:
  \`page.getByRole('button', { name: /submit/i })\`, \`page.getByTestId('cart')\`,
  \`page.getByLabel('Email')\`. Avoid brittle CSS/nth-child chains.
- Scope to a meaningful container before asserting when the page is dynamic.

## Resilience (avoid false failures)
- After \`page.goto\`, if the app redirected to an auth wall you didn't set up,
  screenshot and return early rather than failing on missing elements.
- Optionally guard on response status:
  \`const r = await page.goto(...); if (!r || r.status() >= 400) { stepLogger.log('HTTP ' + (r?.status())); await page.screenshot({ path: screenshotPath }); return; }\`

## How to discover accurate selectors (do this BEFORE writing code)
1. **Preferred — Playwright MCP.** If you have @playwright/mcp configured, open
   the target URL in it, snapshot the page, and read the real roles/labels/text
   to choose selectors. This is the most reliable path.
2. **Live, watchable — \`lastest_ranger\`.** No browser of your own? Start a
   ranger: it drives a Lastest Embedded Browser to the URL and returns a
   *rendered* (SPA-aware) page map, watchable live in the activity feed. It's
   async — poll \`lastest_ranger_status\` for the page map.
3. **Static, instant — \`lastest_scout_url\`.** For a quick, no-browser map of an
   SSR/MPA page (title, headings, forms, inputs, links, candidate selectors).
   JS-rendered content won't appear — verify dynamic pages with the options above.

## Authentication & setup
- If the flow needs a logged-in session, do NOT script login inside the test.
  Discover reusable setup with \`lastest_list_setup_scripts\` and
  \`lastest_list_storage_states\`, then wire them via \`lastest_update_test\`
  using \`setupTestId\` / \`setupScriptId\` / \`setupOverrides\` (a storage_state
  extra step), so auth is applied before the body runs.

## After creating
- Call \`lastest_run_tests\` to execute, then \`lastest_get_build_status\`. If it
  fails, read the error, fix selectors/assertions, and \`lastest_update_test\`.`;

type RepoLike = { name?: string; baseUrl?: string | null } & Record<
  string,
  unknown
>;
type Named = {
  id?: string;
  name?: string;
  description?: string | null;
} & Record<string, unknown>;

function bullets(items: Named[], max = 25): string {
  if (!items.length) return "  (none)";
  return items
    .slice(0, max)
    .map((it) => {
      const id = it.id ? ` — id: ${it.id}` : "";
      const desc = it.description ? `: ${it.description}` : "";
      return `  - ${it.name ?? "(unnamed)"}${desc}${id}`;
    })
    .join("\n");
}

/**
 * The full authoring guide for a specific repo: the durable contract plus this
 * repo's live context (base URL, functional areas, reusable setup scripts, and
 * saved auth storage states) so the agent can target the right origin and wire
 * up auth without guessing.
 */
export async function buildRepoAuthoringGuide(
  client: LastestClient,
  repositoryId: string,
): Promise<string> {
  const [repoRaw, areasRaw, scriptsRaw, statesRaw] = await Promise.all([
    client.getRepo(repositoryId).catch(() => null),
    client.listAreas(repositoryId).catch(() => []),
    client.listSetupScripts(repositoryId).catch(() => []),
    client.listStorageStates(repositoryId).catch(() => []),
  ]);
  const repo = (repoRaw ?? {}) as RepoLike;
  const baseUrl = repo.baseUrl || "http://localhost:3000";

  return `${AUTHORING_CONTRACT}

---

# This repository's context (id: ${repositoryId})

- **Repo:** ${repo.name ?? "(unknown)"}
- **Base URL** (the \`baseUrl\` arg): ${baseUrl}

## Functional areas (assign new tests to one via \`functionalAreaId\`)
${bullets(areasRaw as Named[])}

## Reusable setup scripts (wire via \`setupScriptId\`)
${bullets(scriptsRaw as Named[])}

## Saved auth storage states (wire via \`setupOverrides\` storage_state step)
${bullets(statesRaw as Named[])}

When you have selectors and any needed setup, call \`lastest_create_test\` in
direct mode with { repositoryId, name, code } and an optional functionalAreaId.`;
}
