# HackerNews "Show HN" Post

## Title (80 char limit)
```
Show HN: Lastest2 – Free visual regression testing with AI-generated tests
```

## Body

I'm a solo founder who ships fast with AI tools. Last month I broke my checkout page and didn't notice for 3 days. Users did.

Visual testing tools like Percy ($399/mo) and Chromatic ($149/mo) exist, but they cost more than my entire hosting stack. BackstopJS is free but requires manually writing tests.

So I built Lastest2:

- Point-and-click test recording (Playwright under the hood)
- AI generates robust test code with fallback selectors
- Pixel-perfect visual diffing with approval workflow
- 100% self-hosted, SQLite database, your data stays local
- Free forever (MIT license)

The workflow: Record a user flow → AI writes the test → Run it → See exactly what pixels changed → Approve or reject.

Tech: Next.js 16, Playwright, pixelmatch, Drizzle ORM, Claude for test generation.

GitHub: [LINK]
Demo: [LINK]

I'd love feedback on the UX and what features would make this useful for your workflow.

---

## Submission Notes

**Best time to post**: Tuesday-Thursday, 8-9 AM EST (HN peak hours)

**Engagement strategy**:
1. Reply to every comment within first 2 hours
2. Be humble about limitations
3. Ask genuine questions back
4. Avoid being defensive
5. Thank people for feedback even if critical

**Common HN questions to prepare for**:
- "How does this compare to [X]?" → Have comparison ready
- "Why not use existing tool Y?" → Focus on cost and self-hosting
- "What's the business model?" → MIT license, free forever, maybe paid cloud version later
- "AI-generated tests sound unreliable" → Multi-selector fallback, OCR backup, human review step
