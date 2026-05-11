## tasks
Videos explaining use
    video2: claude uses lastest mcp
    record urldiff with archive page
MCP deploy for smithery
Reach out to podcasts, meetups, youtube channels, add them to crm
Build a skill to find startupideas and test them, provide testing feedback
Welcome email, follow-up
https://www.chromatic.com/start comp test?
Legal stuff for Mark
## test
VS Code extension
  disconnects often
   only show repos with tests
  output should be clear
  replace icon from lab in sidebar to lastest singlecolor
Teardown
triage
Create modes
Openrouter agent sdk parity
demo-mode
  without link?
## bugs
## features
Auto-feedback to resolve loop
Google verification for gsheets
**Self-test**
Default ai, openrouter test
mcp-oauth flow
## ideas
check tabs and enters and ctr+enters
Heal on loop/schedule
Migrate to gh app /home/ewyct/.claude/plans/cheeky-sparking-torvalds.md
The premium QA agent
special prompting for ai diff analysis either by user or by branch code change 
if a pr merge happens, update test manifest with new functions - show as new, prompt test generation
Test coverage assessment and recreation based on existing test set  ~/.claude/plans/shimmying-conjuring-sun.md
Component specific testing
Figma plugin
Sitemap -flow
Use DOM diff/verify to fix test as context
## marketing
* gh issue for maintained repos w lastest public link
* test: screenshot diff tool 
* Quote, Sanyi: "Pont erre van szükségünk. Ilyen AI segítség nélkül soha nem lenne elég erőforrásunk user interface tesztelésre"
* Re-fetch search volume, CPC & competition from DataForSEO
* test: AI repurposing engine -> 5 tweets, 3 linkedin, remotion short form, 1 blog, graphics, email sequence
## commands
## ourmotto
why is software not just a play button?

Real constraints: if you dont use GH, this tool is not optimized for you - ping is with your stack and we will accommodate it.
We hate manual testing
Exp testing is kinda ok, at least you learn how your software works
1) hogy a hasznosságát fel tudjam mérni 
2) hogy személyre szabott sztoriban tudjam megmutatni Davidnek hogy mennyit segített. 
3) Alátámasztani mindezt azzal hogy a PR-jaim release utáni bug countja csökken látványosan

testuser1771664821751@example.com
SecurePass123


TranslatorRude4917
•
5h ago
Man, I don't envy your position, I'd seriously reconsider this! Idk your setup, but if your company isbdoing CI/CD there a good chance you'll get all the fire from devs for an unreliable, flaky pipeline while your manager is getting his incentives met.
If you don't want to spend the next quarter maintaining whatever slop the AI spat out I'd truly encourage you to try to get at least decent quality tests (using proper test steps, POM, fixtures)

What I'd recommend doing is creating some "anchor tests" covering your main user flows. Take your time and be rigorous creating these flows, follow PW best practices (mentioned above), do not let a single hardcoded locator show up in your test code!

Having a high-quality test that crosses multiple smaller features you can lay down a proper foundation that can be reused to expand coverage. For example:

Create onboarding flow anchor test, set up proper POM, fixtures etc.

Using those solid foundations use AI to quickly generate edge-cases, variations, negative tests etc.

1 proper anchor test can provide you with enough to generate 10 or maybe even 20 tests using the same foundations. This way you might only have to write 10-20 high-quality flows yourself, and you can use AI to generate they're rest to meet your manager's incentives while also covering your own ass.

The bottleneck is probably creating those high-quality flows the first place. I had pretty good result with what u/lastesthero suggested: using PW codegen to ground the tests in something that actually works, reducing hallucinations and AI spending a shitton of tokens figuring out how to use your app.
I've been working on a tool for this exact workflow that lets your record your user flows using PW codegen and gives you a proper page object model and test steps your agents can build on. It's quite early, but already proven useful at my day job. It's not public yet, but in case you're interested giving it a shot hit me up and we'll figure something out! 😉

--------

Meta descriptions on many of your pages are too short.


Suggested pricing tiers (example)

Plan	Price (USD)	Included	Overage / Add-ons
Free	$0	1 project, 50 runs/mo, 1 concurrent run, community support	$0.10 / extra run
Starter	$29 / mo	3 projects, 500 runs/mo, 2 concurrent runs, email support	$0.08 / extra run
Growth	$99 / mo	10 projects, 3,000 runs/mo, 5 concurrent runs, Slack support, CI integrations	$0.06 / extra run, cross-browser addon $49/mo
Pro	$299 / mo	Unlimited projects (reasonable quotas), 12,000 runs/mo, 15 concurrent, SSO, priority support	Custom cross-browser pricing
Self-host Standard	$3,000 / yr	Self-hosted license for up to 20 developers, CI agents, basic SLA	Paid upgrades for premium support and custom integrations
Enterprise	Custom	Unlimited, dedicated account, on-prem agent, advanced SLAs, professional services	Custom


Invite 50–200 teams (target: solo founders, YC startups, component teams) via outreach to clubs, Slack communities, and test automation forums.
Offer extended free tiers and white-glove onboarding for first 20 paying customers.
