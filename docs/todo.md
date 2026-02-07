intent /home/ewyct/dev/lastest2/docs/targeted-ui-spec.md
dash /home/ewyct/.claude/plans/proud-yawning-noodle.md
repo /home/ewyct/.claude/plans/replicated-forging-fountain.md
compare /home/ewyct/.claude/plans/partitioned-bouncing-metcalfe.md
playwright settings /home/ewyct/.claude/plans/replicated-tinkering-papert.md
Determining test coverage /home/ewyct/.claude/plans/zazzy-tinkering-backus.md
AI enablement /home/ewyct/.claude/plans/moonlit-fluttering-origami.md
Excalidraw tests: ~/.claude/plans/recursive-wondering-dongarra.md

--------
## reuse
check the recorder and the runner so that they are compatible and identify the root cause of the issue
## in progress

## test
Figma plugin
Reference database for test data
Snapshot Stabilization Engine
VS Code extension
Github actions integration
Publish lastest runner to npx npm
Docker
Gitlab
CROSS_OS_CHROMIUM_ARGS & FONTS
## features
Select build as baseline

 NEW: Page Shift Detection -- excludes vertical content shifts
  from diffs

Playwright trace replay:
Component specific testing
Accessability re-check

Tier 3 — Perceptual diffing engines
  (replace/augment pixelmatch)
  - Swap pixelmatch for SSIM or
  Butteraugli in
  src/lib/diff/generator.ts
  - These algorithms ignore
  sub-pixel anti-aliasing
  differences that humans can't
  see
  - Argos calls this
  "stabilization engine" —
  Lastest2 could leapfrog with
  structural similarity

  Tier 4 — Text-region-aware
  diffing
  - Detect text regions (OCR
  infrastructure already exists in
   src/lib/playwright/ocr.ts)
  - Apply higher tolerance to text
   areas (where OS rendering
  differs most) while keeping
  strict pixel comparison for
  images/layout

UI & UX
    Use the frontend design skill and subagent for this
    Revise frontend and make sure you havent steered far and try to use standard shadcn css where possible
    make sure every page has a clear primary action if there are more than one. If you cant decide ask me a question about it
Move to background what's possible
Linting
Test file errors

Electron app ~/.claude/plans/rippling-roaming-snail.md replan
## ideas
Generate test data with AI
Sitemap -flow
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
Timestamp fixing
## marketing
Support https://github.com/excalidraw/excalidraw/tree/master/packages/excalidraw/tests

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

    4. The "Build in Public" Flywheel                                                                                               
  Per https://thebootstrappedfounder.com/indie-hacking-isnt-dead-its-just-less-hacky/:                            
                                 
  Share progress → Attract followers → They try tool →                                                            
  Some convert → They share → Repeat                                                                                                                                             
  This takes 3-6 months of consistent posting before compounding.          
                                                                                                        