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

Phase 5: Areas Changed Grouping (planned, not implemented now)

 - Group diffs by functionalAreaName in build detail
 - Collapsible sections per area with summary counts
 - Area-level status rollup

 Phase 6: Branch-Specific Tests (planned, not implemented now)

 - New branchTestOverrides table
 - Test code resolution: check override before main test code
 - Auto-merge test changes on PR close

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


# Action testing

 Local Lastest2 Config (Step by Step)

  1. Expose your server to the internet

  Your local server (localhost:3000) needs to be reachable from
  GitHub Actions. Pick one:

  # Option A: Cloudflare Tunnel (recommended, persistent)
  cloudflared tunnel --url http://localhost:3000

  # Option B: ngrok (quick testing)
  ngrok http 3000

  Save the public URL (e.g., https://xyz.trycloudflare.com).

  2. Create a runner in Lastest2 UI

  - Go to Settings > Runners > Create Runner
  - Copy the generated token (shown once)
  - Note the Runner ID from the runners list

  3. Start the runner locally

  npm i -g lastest2-runner
  lastest2-runner start -t <token> -s http://localhost:3000

  4. Get your IDs

  From the Lastest2 dashboard, note:
  - Repo ID — from the repository page URL
  - Team ID — from Settings or URL
  - Runner ID — from Settings > Runners

  5. Configure GitHub secrets/variables

  In dexilion-team/lastest2 repo settings (Settings > Secrets and
  variables > Actions):

  Secrets:
  Name: LASTEST_SERVER_URL
  Value: Your tunnel URL (e.g., https://xyz.trycloudflare.com)
  ────────────────────────────────────────
  Name: LASTEST_RUNNER_TOKEN
  Value: Runner token from step 2
  Variables:
  ┌───────────────────┬──────────────────────┐
  │       Name        │        Value         │
  ├───────────────────┼──────────────────────┤
  │ LASTEST_REPO_ID   │ Your repository UUID │
  ├───────────────────┼──────────────────────┤
  │ LASTEST_TEAM_ID   │ Your team UUID       │
  ├───────────────────┼──────────────────────┤
  │ LASTEST_RUNNER_ID │ Your runner UUID     │
  └───────────────────┴──────────────────────┘
  6. Test it

  Create a PR against main — the workflow will trigger, call your
  local server via the tunnel, dispatch tests to your runner, and
  report results in the PR's job summary.