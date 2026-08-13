import { describe, expect, it } from "vitest";

import { validateSchemaNamespace } from "@lastest/core-data";
import { resolveRegistry } from "@lastest/kernel";

import { MANIFESTS } from "@/lib/core/manifests";

/**
 * The boot checks, run in CI instead of at first request.
 *
 * `resolveRegistry` and `core/data`'s namespace validation already refuse to
 * start a bad plugin set — duplicate ids, a `schema` with no `deletion`, a
 * capability nobody provides, a table missing its `<id>_` prefix. But nothing
 * *called* them outside `getPluginRuntime()`, which needs a database. So the
 * whole registry's validity was only ever proven by booting the app.
 *
 * That gap was found while migrating `launch` (RFC §9 phase 4): a plugin
 * declaring seven tables and a deletion hook has several ways to be wrong that
 * a build cannot see. `MANIFESTS` is import-safe by design — that is why it is
 * split out of the `server-only` `runtime.ts` — so it can be checked here.
 */
describe("plugin registry", () => {
  it("resolves — ids, capabilities, job types, check layers, deletion hooks", () => {
    expect(() => resolveRegistry(MANIFESTS)).not.toThrow();
  });

  it("registers every plugin exactly once", () => {
    const ids = MANIFESTS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("namespaces every plugin table to its own plugin id", async () => {
    const problems: string[] = [];
    for (const manifest of MANIFESTS) {
      if (!manifest.schema) continue;
      const schema = await manifest.schema();
      for (const p of validateSchemaNamespace(manifest.id, schema)) {
        problems.push(`${manifest.id}: ${p.table} — ${p.reason}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("gives every plugin with storage a hook that can actually delete it", async () => {
    // `resolveRegistry` asserts a `deletion` object exists. It cannot assert
    // the object has any method on it, and an empty hook is indistinguishable
    // from a missing one at deletion time — `runDeletionHooks` just reports
    // the plugin as `skipped` for every target.
    for (const manifest of MANIFESTS) {
      if (!manifest.schema) continue;
      const hook = manifest.deletion;
      const targets = [
        hook?.onTeamDeleted,
        hook?.onRepoDeleted,
        hook?.onUserDeleted,
      ].filter(Boolean);
      expect(
        targets.length,
        `plugin "${manifest.id}" owns tables but its deletion hook implements no target`,
      ).toBeGreaterThan(0);
    }
  });
});
