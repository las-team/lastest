intent /home/ewyct/dev/lastest2/docs/targeted-ui-spec.md
dash /home/ewyct/.claude/plans/proud-yawning-noodle.md
repo /home/ewyct/.claude/plans/replicated-forging-fountain.md
compare /home/ewyct/.claude/plans/partitioned-bouncing-metcalfe.md
playwright settings /home/ewyct/.claude/plans/replicated-tinkering-papert.md
Determining test coverage /home/ewyct/.claude/plans/zazzy-tinkering-backus.md
AI enablement /home/ewyct/.claude/plans/moonlit-fluttering-origami.md
Excalidraw tests: ~/.claude/plans/recursive-wondering-dongarra.md

--------
## in progress
## test
VS Code extension
Github actions integration
Publish lastest runner to npx npm
Docker
Gitlab
Timestamp fixing
Teardown
Test - which pr it was added in, updated?
AI review
Clipboard Access
Accept Downloads
Network Interception
## features
Support https://github.com/excalidraw/excalidraw/tree/master/packages/excalidraw/tests ~/.claude/plans/declarative-kindling-coral.md 70%
Explore and implement:
  Playwright trace replay:
  Component specific testing
Linting
## ideas
Test coverage assessment and recreation based on existing test set
Tweet about us
Content comparison - compare text in 2 setups
Explore/Cover instead of Areas
Ban AI mode
    Remove all GenAI features from UI if enabled
Revise labels (e.g. new change, main 2.5%) on build page
Component specific testing
Electron app ~/.claude/plans/rippling-roaming-snail.md replan
Figma plugin
Generate test data with AI
Sitemap -flow
Formal verification of code?
Firecrawl?
Approve reject changes or create ticket -> gh issue
Issues view
CI/CD integration
Docker
Tweet
Bugriport
Import from prior tools?
### UX
## bugs
some elements are disappearing from test 13b
## marketing
## Excalidraw

  Tier 3 — Needs product improvements first:

  ┌─────┬─────────────────────┬─────────────────────────┬────────────────┐
  │  #  │      Test Name      │       Blocked by        │    Maps to     │
  ├─────┼─────────────────────┼─────────────────────────┼────────────────┤
  │ 16  │ Copy/Paste Elements │ Clipboard support       │ clipboard.test │
  ├─────┼─────────────────────┼─────────────────────────┼────────────────┤
  │ 17  │ Export as PNG/SVG   │ Download interception   │ export.test    │
  ├─────┼─────────────────────┼─────────────────────────┼────────────────┤
  │ 18  │ Insert Image        │ File upload support     │ image.test     │
  ├─────┼─────────────────────┼─────────────────────────┼────────────────┤
  │ 19  │ Library Add/Use     │ File upload + clipboard │ library.test   │
  ├─────┼─────────────────────┼─────────────────────────┼────────────────┤
  │ 20  │ Paste CSV as Chart  │ Clipboard support       │ charts.test    │
  └─────┴─────────────────────┴─────────────────────────┴────────────────┘


  please check what kind of measures have been implemented to try to get consistent
  results out of excalidraw tests. With the OS consistency, Font fixing, random
  number fixing, timestamp fixing. Place make sure all that is in place, and works
  well. Check anti-aliasing, sub-pixel rendering and ways to fix that. Try to make
  the testing deterministic.
  You can verify your work by building a new runner, stopping and starting it, then
  running lastest2-runner trigger --repo ewyct/excalidraw_test. The goal is to get
  the same results in two consecutive runs (while keeping testing functionality
  intact).

 1. Integration > Awareness
  2. Distribution = Existing Audience
  Per https://www.indiehackers.com, you need distribution from day one. Without an existing audience, posting is
  shouting into void.
  Options if you don't have audience:
  - Borrow someone else's: Get featured by https://youtube.com/fireship, Theo, or smaller YouTubers (5-20k subs)
  who review dev tools
  - Piggyback platforms: Cursor Discord, Claude Discord, Vercel Discord - be helpful first, mention tool when
  relevant
  - Create a "list": Publish "Best free alternatives to Percy/Chromatic" article, include yourself

    1. The "Build in Public" Flywheel
  Per https://thebootstrappedfounder.com/indie-hacking-isnt-dead-its-just-less-hacky/:

  Share progress → Attract followers → They try tool →
  Some convert → They share → Repeat
  This takes 3-6 months of consistent posting before compounding.
