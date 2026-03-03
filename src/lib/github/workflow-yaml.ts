import type { GithubActionMode, GithubActionTriggerEvent } from '@/lib/db/schema';

export interface WorkflowConfig {
  mode: GithubActionMode;
  repositoryOwner: string;
  repositoryName: string;
  triggerEvents: GithubActionTriggerEvent[];
  branchFilter: string[];
  cronSchedule?: string | null;
  targetUrl?: string | null;
  timeout: number;
  failOnChanges: boolean;
}

function buildOnBlock(config: WorkflowConfig): string {
  const lines: string[] = ['on:'];

  for (const event of config.triggerEvents) {
    if (event === 'schedule') {
      if (config.cronSchedule) {
        lines.push(`  schedule:`);
        lines.push(`    - cron: '${config.cronSchedule}'`);
      }
      continue;
    }
    if (event === 'workflow_dispatch') {
      lines.push(`  workflow_dispatch:`);
      continue;
    }
    // push / pull_request
    lines.push(`  ${event}:`);
    if (config.branchFilter.length > 0) {
      lines.push(`    branches: [${config.branchFilter.join(', ')}]`);
    }
  }

  return lines.join('\n');
}

function buildPersistentSteps(config: WorkflowConfig): string {
  const repo = `${config.repositoryOwner}/${config.repositoryName}`;
  const flags: string[] = [];
  flags.push(`--repo "${repo}"`);
  flags.push(`--branch "$\{{ github.head_ref || github.ref_name }}"`);
  flags.push(`--commit "$\{{ github.sha }}"`);
  if (config.failOnChanges) flags.push('--fail-on-changes');
  flags.push(`--timeout ${config.timeout}`);
  if (config.targetUrl) flags.push(`--target-url "${config.targetUrl}"`);

  const runCmd = flags.map((f, i) => i === 0 ? `npx @lastest/runner trigger \\\n            ${f}` : `            ${f}`).join(' \\\n');

  return `      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Run visual tests
        env:
          LASTEST2_TOKEN: \${{ secrets.LASTEST2_TOKEN }}
          LASTEST2_URL: \${{ secrets.LASTEST2_URL }}
        run: |
          ${runCmd}`;
}

function buildEphemeralSteps(config: WorkflowConfig): string {
  const repo = `${config.repositoryOwner}/${config.repositoryName}`;
  const flags: string[] = [];
  flags.push(`--repo "${repo}"`);
  flags.push(`--branch "$\{{ github.head_ref || github.ref_name }}"`);
  flags.push(`--commit "$\{{ github.sha }}"`);
  if (config.failOnChanges) flags.push('--fail-on-changes');
  flags.push(`--timeout ${config.timeout}`);
  if (config.targetUrl) flags.push(`--target-url "${config.targetUrl}"`);

  const triggerFlags = flags.map((f, i) => i === 0 ? `npx @lastest/runner trigger \\\n            ${f}` : `            ${f}`).join(' \\\n');

  return `      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Get Playwright version
        id: playwright-version
        run: echo "version=$(npx @lastest/runner playwright-version)" >> $GITHUB_OUTPUT

      - name: Cache Playwright browsers
        uses: actions/cache@v4
        id: playwright-cache
        with:
          path: ~/.cache/ms-playwright
          key: \${{ runner.os }}-playwright-\${{ steps.playwright-version.outputs.version }}

      - name: Install Playwright browsers
        if: steps.playwright-cache.outputs.cache-hit != 'true'
        run: npx playwright install chromium --with-deps

      - name: Install Playwright OS deps (cached)
        if: steps.playwright-cache.outputs.cache-hit == 'true'
        run: npx playwright install-deps chromium

      - name: Run visual tests
        env:
          LASTEST2_TOKEN: \${{ secrets.LASTEST2_TOKEN }}
          LASTEST2_URL: \${{ secrets.LASTEST2_URL }}
        run: |
          npx @lastest/runner run \\
            -t "$LASTEST2_TOKEN" \\
            -s "$LASTEST2_URL" &
          RUNNER_PID=$!
          sleep 3

          ${triggerFlags}

          kill $RUNNER_PID || true`;
}

export function generateWorkflowYaml(config: WorkflowConfig): string {
  const timeoutMinutes = Math.ceil(config.timeout / 60000) + (config.mode === 'ephemeral' ? 5 : 0);
  const onBlock = buildOnBlock(config);
  const steps = config.mode === 'persistent'
    ? buildPersistentSteps(config)
    : buildEphemeralSteps(config);

  return `name: Lastest2 Visual Tests
${onBlock}
jobs:
  visual-tests:
    runs-on: ubuntu-latest
    timeout-minutes: ${timeoutMinutes}
    steps:
${steps}
`;
}
