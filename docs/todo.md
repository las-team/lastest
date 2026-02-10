## in progress
## test
VS Code extension
Github actions integration
Publish lastest runner to npx npm
Docker
Gitlab
Timestamp fixing
## features
Support https://github.com/excalidraw/excalidraw/tree/master/packages/excalidraw/tests ~/.claude/plans/declarative-kindling-coral.md 55%
    Branch baseline 
    Test chagnes per branch
    PR-ra megy egy push, akkor triggereljen egy comparisont, nem baseline, master - PERSISTENT BRANCH
    Areas changed
    Dev feeback - Baseline, Accepted changes, Test changes, new tests

Teardown - after test scripts

UX
    Test defining
    Test running

AI Optimize playwright settings - select or identify testable app mode

Play gomb - give in url and do everything 
    Runs setup and testing as an agent
    1. Show Timeline of what will happen between user and AI
    2. Settings - highlight areas that need to be set up. GH, AI (if wasnt done)
    3. Select repo to be tested
    4. Run discover on the repo, create areas and tests
    5. Run tests
    6. Fix tests, with MCP or revise if they are failing
    7. Run tests again
    8. Prompt the user to have something to test 
    9. Run tests again, show comparison and AI assessment - areas that changed
    10. Ideal summary: 60 functional areas remain unchanged, 10 changed, out of those 8 new areas added, 1 pre-existing areas changed, 1 minor change in pre-existing function. 
 

Ban AI mode
    Remove all GenAI features from UI if enabled
## ideas
Component specific testing
Electron app ~/.claude/plans/rippling-roaming-snail.md replan
Figma plugin
Generate test data with AI
Sitemap -flow
Firecrawl?
Approve reject changes or create ticket -> gh issue
Issues view
Docker
Tweet
Bugriport
Import from prior tools?
### UX
## bugs
## marketing  

---------------


                                                  GitHub Action: Native PR Comment Posting
Context
The action/ directory already has a fully functional composite GitHub Action that triggers remote builds and polls for results. However, posting PR comments requires a separate actions/github-script@v7 step — extra boilerplate for users. The goal is to make the action a single-step, marketplace-ready experience: trigger build, get results, post PR comment.

Current State
action/action.yml — working composite action (curl + jq, no Docker needed)
action/entrypoint.sh — standalone mirror of the inline script
src/lib/integrations/github-pr.ts — server-side PR comment with deduplication signature *Posted by Lastest Visual Regression*
PR comments, Job Summary, and marketplace polish are missing from the action
Plan
1. Add github-token input to action/action.yml
New optional input github-token (default: '')
Pass as env var alongside GITHUB_EVENT_NAME, GITHUB_REF, GITHUB_REPOSITORY
When empty → skip PR comment (backwards compatible)
2. Add PR comment bash logic to the inline script
After build results are extracted (line ~177), add:

find_existing_comment() — GET comments, filter by signature via jq
post_or_update_pr_comment() — PATCH existing or POST new, with emoji/table matching github-pr.ts format
write_job_summary() — write markdown to $GITHUB_STEP_SUMMARY (always, even without PR context)
Integration logic — extract PR number from GITHUB_REF (refs/pull/{n}/merge), owner/repo from GITHUB_REPOSITORY
Error handling: log failures but don't fail the action
3. Sync action/entrypoint.sh
Mirror all changes from action.yml (env reads, functions, integration logic).

4. Update action/README.md
Remove the separate github-script step from examples
Show single-step usage with github-token: ${{ github.token }}
Add github-token to inputs table
Add "Native PR comments" and "Job summaries" to feature list
5. Update .github/workflows/regression.yml
Uncomment the remote-regression job
Add github-token: ${{ github.token }}
Remove the separate Summary step (now built-in)
Files to Modify
File	Change
action/action.yml	Add input, env vars, PR comment + summary bash functions
action/entrypoint.sh	Mirror action.yml changes
action/README.md	Simplify examples, update inputs table
.github/workflows/regression.yml	Uncomment remote job, add github-token
Reference only (no changes): src/lib/integrations/github-pr.ts — comment format to match

PR Comment Format (matches server-side)

## ✅ Visual Test Results

| Status | Tests | Passed | Changes | Flaky | Failed |
|--------|-------|--------|---------|-------|--------|
| Passed | 10    | 10     | 0       | 0     | 0      |

[View Build](https://your-server/builds/abc123)

---
*Posted by Lastest Visual Regression*
Verification
Push a PR branch → confirm PR comment appears
Push again to same PR → confirm comment is updated (not duplicated)
Run on push event (not PR) → confirm no comment, but Job Summary is written
Run without github-token → confirm no error, comment skipped                                          

Option 1: Remote Mode (recommended — uses your running Lastest2 server + runner)

# .github/workflows/visual-tests.yml
name: Visual Regression Tests

on:
  pull_request:
    branches: [main]

jobs:
  visual-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Run Visual Tests
        run: |
          pnpm test:visual \
            --repo-id ${{ secrets.LASTEST2_REPO_ID }} \
            --server-url ${{ secrets.LASTEST2_SERVER_URL }} \
            --runner-token ${{ secrets.LASTEST2_RUNNER_TOKEN }} \
            --runner-id ${{ secrets.LASTEST2_RUNNER_ID }} \
            --team-id ${{ secrets.LASTEST2_TEAM_ID }}
Required secrets:

LASTEST2_SERVER_URL — your Lastest2 instance URL
LASTEST2_REPO_ID — repository ID from the Lastest2 dashboard
LASTEST2_RUNNER_TOKEN — API token for the remote runner
LASTEST2_RUNNER_ID — runner ID (from lastest2-runner start)
LASTEST2_TEAM_ID — your team ID