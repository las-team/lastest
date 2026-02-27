## in progress
## test
VS Code extension
Gitlab
Teardown
Accept Downloads
Network Interception
## features
/home/ewyct/.claude/plans/dynamic-discovering-dove.md <- but without public image pushing
## ideas
Test coverage assessment and recreation based on existing test set
Tweet about us
Content comparison - compare text in 2 setups
Explore/Cover instead of Areas
Ban AI mode
    Remove all GenAI features from UI if enabled
Component specific testing
Figma plugin
Generate test data with AI
Sitemap -flow
Formal verification of code?
Firecrawl?
Approve reject changes or create ticket -> gh issue
Import from prior tools? 
Determine test coverage based on tests in repo 
### UX
## bugs
some elements are disappearing from test 13b
## marketing
## Excalidraw

  Tier 3 — Needs product improvements first:

  ┌─────┬─────────────────────┬─────────────────────────┬────────────────┐
  │  #  │      Test Name      │       Blocked by        │    Maps to     │
  ├─────┼─────────────────────┼─────────────────────────┼────────────────┤
  ├─────┼─────────────────────┼─────────────────────────┼────────────────┤
  │ 17  │ Export as PNG/SVG   │ Download interception   │ export.test    │
  ├─────┼─────────────────────┼─────────────────────────┼────────────────┤
  │ 18  │ Insert Image        │ File upload support     │ image.test     │
  ├─────┼─────────────────────┼─────────────────────────┼────────────────┤
  │ 19  │ Library Add/Use     │ File upload + clipboard │ library.test   │
  ├─────┼─────────────────────┼─────────────────────────┼────────────────┤
  │ 20  │ Paste CSV as Chart  │ Clipboard support       │ charts.test    │
  └─────┴─────────────────────┴─────────────────────────┴────────────────┘

  ehhez most arrow és arrow binding related teszteket kell felvenni, 1) hogy a hasznosságát fel tudjam mérni 2) hogy személyre szabott sztoriban tudjam megmutatni Davidnek hogy mennyit segített. 3) Alátámasztani mindezt azzal hogy a PR-jaim release utáni bug countja csökken látványosan

a CI workflow cuccod akár nyomhatna egy npx playwright install-t is és bejelentkezhetne runnernek arra az egy futásra
van rá lehetőség hogy cacheld CI futások között a playwright install-t
https://dev.to/ayomiku222/how-to-cache-playwright-browser-on-github-actions-51o6
DEV Community
How To Cache Playwright Browser On Github Actions
Many of us who find ourselves tasked with automating processes, have likely been recommended or...
How To Cache Playwright Browser On Github Actions
és akkor máris nem a mi költségünk lesz a CI run, csak a user által triggereltek

## commands

  please check what kind of measures have been implemented to try to get consistent
  results out of excalidraw tests. With the OS consistency, Font fixing, random
  number fixing, timestamp fixing. Place make sure all that is in place, and works
  well. Check anti-aliasing, sub-pixel rendering and ways to fix that. Try to make
  the testing deterministic.
  You can verify your work by building a new runner, stopping and starting it, then
  running lastest2-runner trigger --repo ewyct/excalidraw_test. The goal is to get
  the same results in two consecutive runs (while keeping testing functionality
  intact).
