# Lastest MCP Server — Distribution Guide

Package: **`@lastest/mcp-server`** (npm, currently `0.2.0`)
Bin: `lastest-mcp`
Transport: `stdio`
Repo: https://github.com/las-team/lastest (subdir `packages/mcp-server`)

## Install snippet (reuse everywhere)

```bash
npx -y @lastest/mcp-server@latest --url https://your-lastest-instance --api-key YOUR_API_KEY
```

### Claude Code
```bash
claude mcp add lastest -- npx -y @lastest/mcp-server@latest --url https://your-lastest-instance --api-key YOUR_API_KEY
```

### Claude Desktop / generic JSON
```json
{
  "mcpServers": {
    "lastest": {
      "command": "npx",
      "args": ["-y", "@lastest/mcp-server@latest", "--url", "https://your-lastest-instance", "--api-key", "YOUR_API_KEY"]
    }
  }
}
```

---

## 1. Official MCP Servers list (`modelcontextprotocol/servers`)

The canonical, most-trafficked list. Linked from the MCP spec docs.

**How to submit:**
1. Fork https://github.com/modelcontextprotocol/servers
2. Edit `README.md` → "🌎 Community Servers" section, alphabetical
3. Add a one-line entry:
   ```md
   - [Lastest](https://github.com/las-team/lastest/tree/main/packages/mcp-server) - Run visual regression tests, review diffs, and manage baselines on a Lastest instance.
   ```
4. Open PR. Maintainers usually merge within a week if the description is concise and the repo has a working install.

**Requirements:** public repo, working README with install instructions, MCP-compliant.

---

## 2. Official MCP Registry (`registry.modelcontextprotocol.io`)

The new programmatic registry that downstream clients (Claude, Cursor, etc.) are starting to consume. This is the highest-leverage submission for 2026+.

**How to submit:**
1. Read https://github.com/modelcontextprotocol/registry
2. Create a `server.json` at the repo root of `packages/mcp-server` (or top-level):
   ```json
   {
     "$schema": "https://static.modelcontextprotocol.io/schemas/2025-09-29/server.schema.json",
     "name": "io.github.las-team/lastest",
     "description": "MCP server for Lastest — run visual regression tests, review diffs, manage baselines.",
     "repository": {
       "url": "https://github.com/las-team/lastest",
       "source": "github",
       "subfolder": "packages/mcp-server"
     },
     "version": "0.2.0",
     "packages": [
       {
         "registry_type": "npm",
         "identifier": "@lastest/mcp-server",
         "version": "0.2.0",
         "transport": { "type": "stdio" },
         "runtime_arguments": [
           { "type": "named", "name": "--url", "description": "Lastest instance URL", "is_required": true, "format": "string" },
           { "type": "named", "name": "--api-key", "description": "API key", "is_required": true, "is_secret": true, "format": "string" }
         ]
       }
     ]
   }
   ```
3. Install the publisher CLI: `npx @modelcontextprotocol/registry publish` (or follow current docs — schema/CLI evolves).
4. Authenticate via GitHub OAuth (namespace `io.github.<org>` is reserved to that GitHub org).
5. Re-publish on every version bump (add to `prepublishOnly` script).

---

## 3. Smithery.ai

Largest third-party MCP marketplace, one-click install for many clients, ~tens of thousands of MAU.

**How to submit:**
1. Go to https://smithery.ai/new
2. Sign in with GitHub, select `las-team/lastest`
3. Add a `smithery.yaml` at `packages/mcp-server/`:
   ```yaml
   startCommand:
     type: stdio
     configSchema:
       type: object
       required: [url, apiKey]
       properties:
         url:
           type: string
           description: Lastest instance URL
         apiKey:
           type: string
           description: API key
     commandFunction: |-
       (config) => ({
         command: 'npx',
         args: ['-y', '@lastest/mcp-server@latest', '--url', config.url, '--api-key', config.apiKey]
       })
   ```
4. Click Deploy. Smithery will scan tools and generate the listing automatically.

---

## 4. Glama.ai MCP directory

Auto-indexes public MCP servers; popular discovery surface, decent SEO.

**How to submit:**
1. Add GitHub topics to `las-team/lastest`: `mcp`, `model-context-protocol`, `mcp-server`
2. Submit via https://glama.ai/mcp/servers (there is a "Submit a server" link at the bottom) — paste the GitHub URL.
3. Glama auto-pulls README and bin info. Listing usually appears within 24h.

---

## 5. PulseMCP

Curated discovery site, manual submission, fast review.

**How to submit:**
1. Go to https://www.pulsemcp.com/submit
2. Fill the form: name `Lastest`, package `@lastest/mcp-server`, repo URL, short description, tools list, install snippet.
3. Categories: pick **Testing / QA / Developer Tools**.

---

## Bonus / lower priority

- **mcp.so** — `https://mcp.so/submit`, similar to Glama, fast.
- **Cline marketplace** — `cline/mcp-marketplace` GitHub repo, PR an entry.
- **Cursor Directory** — `cursor.directory` accepts MCP submissions.
- **Awesome-MCP-Servers** lists on GitHub (search `awesome-mcp-servers`) — PRs to a few of the top-starred lists.

---

## Pre-submission checklist

- [ ] `README.md` in `packages/mcp-server` with: install command, required env/args, list of tools, example Claude Desktop / Claude Code JSON.
- [ ] LICENSE present (currently FSL-1.1-ALv2).
- [ ] `npm view @lastest/mcp-server` returns latest version.
- [ ] `npx -y @lastest/mcp-server@latest --help` works on a clean machine.
- [ ] GitHub topics: `mcp`, `model-context-protocol`, `mcp-server`, `visual-regression`.
- [ ] Tag a GitHub release matching npm version (registries often link to it).
- [ ] Short tagline (≤120 chars) and 3–5 bullet feature list ready to paste.

## Suggested tagline

> Lastest MCP — let AI agents run visual regression tests, diff screenshots, and approve baselines on your Lastest instance.
