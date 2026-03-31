# Twitter Launch Thread

## Thread (Copy-paste ready)

---

**Tweet 1 (Hook)**

I broke my checkout page and didn't notice for 3 days.

My users noticed though.

So I built a free visual testing tool that catches UI regressions before they ship.

Here's how it works: 🧵

---

**Tweet 2 (The Problem)**

Visual testing tools exist but:

→ Percy costs $399/mo
→ Chromatic costs $149/mo
→ BackstopJS requires manually writing tests

I'm a solo founder. I spend $20/mo on hosting.

Paying 10x my hosting cost for visual testing? No thanks.

---

**Tweet 3 (The Solution)**

So I built Lastest2:

✅ Point-and-click test recording
✅ AI writes the test code for you
✅ Pixel-perfect visual diffing
✅ Self-hosted (your data stays local)
✅ $0 forever (MIT license)

---

**Tweet 4 (How It Works)**

The workflow is dead simple:

1. Record a user flow (click around your app)
2. AI generates Playwright test code
3. Run it → screenshots captured
4. Compare against baselines
5. Approve or reject changes

No manual test writing. No cloud uploads.

---

**Tweet 5 (The Tech)**

Built with:

• Next.js 16 (App Router)
• Playwright for browser automation
• pixelmatch for visual diffing
• PostgreSQL + Drizzle ORM
• Claude for AI test generation
• Tesseract.js for OCR fallback selectors

---

**Tweet 6 (Who It's For)**

Built for vibe-coding solo founders who:

→ Ship MVPs fast with AI tools
→ Can't justify $150+/mo for testing
→ Want to own their data
→ Need visual testing that "just works"

If that's you, give it a try.

---

**Tweet 7 (CTA)**

Lastest2 is free and open source.

GitHub: [LINK]
Demo: [LINK]

Star it if you find it useful ⭐

And let me know what features you'd want next!

---

## Alt Thread Hooks (A/B Test These)

**Hook A** (Fear):
"I broke my checkout page and didn't notice for 3 days."

**Hook B** (Cost):
"Percy: $399/mo. Chromatic: $149/mo. My hosting: $20/mo. Visual testing shouldn't cost 10x your infrastructure."

**Hook C** (Speed):
"Recording a visual test: 30 seconds. Writing one manually: 30 minutes. The gap is AI."

**Hook D** (Pain):
"Every solo founder has shipped a broken UI to production. Here's how to stop."

---

## Engagement Replies (Pre-written)

**On "How is this different from X?"**
"Main differences: 1) AI writes tests from recordings (no manual code), 2) 100% self-hosted (no cloud), 3) Free forever. Happy to dive deeper on any of these!"

**On "Does AI test generation actually work?"**
"It uses multi-selector fallback: data-testid → id → role → aria-label → text → css → OCR. If one breaks, others still work. Plus human review catches anything weird."

**On "What's the catch?"**
"No catch. MIT license, self-hosted, free forever. I might add a paid cloud version later for teams who don't want to self-host, but the core will always be free."

**On "Can I contribute?"**
"Absolutely! PRs welcome. Check the issues tab for good first issues, or open one with your idea."
