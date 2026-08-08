import { pgTable, text } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { tablePrefix, tablesOf, validateSchemaNamespace } from "./namespace";

// Stand-ins for the real thing: `explorer_sessions` is what a plugin is allowed
// to own, `repositories` is the core table it must not be able to smuggle in.
const explorerSessions = pgTable("explorer_sessions", {
  id: text("id").primaryKey(),
});
const repositories = pgTable("repositories", { id: text("id").primaryKey() });

describe("tablePrefix", () => {
  it("converts a kebab-case plugin id to a snake_case table prefix", () => {
    expect(tablePrefix("qa-agent")).toBe("qa_agent_");
    expect(tablePrefix("explorer")).toBe("explorer_");
  });
});

describe("tablesOf", () => {
  it("picks out drizzle tables and ignores everything else in the module", () => {
    const found = tablesOf({
      explorerSessions,
      SOME_CONSTANT: 4,
      helper: () => {},
      aType: undefined,
    });
    expect([...found.keys()]).toEqual(["explorer_sessions"]);
  });

  it("tolerates a schema module that is not an object", () => {
    expect(tablesOf(undefined).size).toBe(0);
    expect(tablesOf(null).size).toBe(0);
  });
});

describe("validateSchemaNamespace", () => {
  it("accepts tables inside the plugin's own namespace", () => {
    expect(validateSchemaNamespace("explorer", { explorerSessions })).toEqual(
      [],
    );
  });

  it("rejects a core table re-exported through the plugin's schema", () => {
    // This is the hole the import ban cannot close: a plugin cannot *import*
    // @lastest/db, but nothing stops it re-exporting a table object it got some
    // other way and querying it through the handle core hands over. The prefix
    // rule is what closes it.
    const problems = validateSchemaNamespace("explorer", {
      explorerSessions,
      repositories,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].table).toBe("repositories");
    expect(problems[0].reason).toContain('not prefixed "explorer_"');
  });

  it("rejects a table belonging to a different plugin's namespace", () => {
    const problems = validateSchemaNamespace("explorer", {
      t: pgTable("qa_agent_findings", { id: text("id").primaryKey() }),
    });
    expect(problems[0].reason).toContain('not prefixed "explorer_"');
  });

  it("reports every offending table at once", () => {
    // Boot failures that surface one problem per deploy turn a five-minute fix
    // into five deploys.
    const problems = validateSchemaNamespace("explorer", {
      repositories,
      teams: pgTable("teams", { id: text("id").primaryKey() }),
    });
    expect(problems.map((p) => p.table).sort()).toEqual([
      "repositories",
      "teams",
    ]);
  });

  it("does not let a prefix match across a plugin-id boundary", () => {
    // "explorer-pro" must not be able to claim "explorer_sessions".
    const problems = validateSchemaNamespace("explorer-pro", {
      explorerSessions,
    });
    expect(problems).toHaveLength(1);
  });
});
