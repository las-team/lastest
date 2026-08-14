import { describe, it, expect } from "vitest";
import { generateCiYaml, type CiYamlConfig } from "./ci-yaml";

/**
 * GitLab pipeline config validation — the "test what's testable" fallback
 * from §3 of the test plan: this dev environment has no GitLab org/token
 * configured (`GITLAB_WEBHOOK_SECRET` unset, no connected GitLab account),
 * so a live pipeline-trigger smoke test isn't reachable here. `generateCiYaml`
 * is the pure, exported piece of the pipelines feature — it turns a saved
 * `GitlabPipelineConfig` into the `.gitlab-ci.yml` that actually gets pushed
 * to a customer's repo (`deployPipelineToGitlab` → `upsertCiFile`), so a
 * malformed rule/branch-filter/flag here would silently break every
 * customer's pipeline. Untouched by this refactor (§3: "pipelines no"), but
 * had zero test coverage before this file.
 */

const base: CiYamlConfig = {
  mode: "persistent",
  projectPath: "acme/widgets",
  triggerEvents: ["push"],
  branchFilter: [],
  timeout: 600_000,
  failOnChanges: false,
};

describe("generateCiYaml", () => {
  it("emits a push rule with no branch filter when none is configured", () => {
    const yaml = generateCiYaml(base);
    expect(yaml).toContain(`- if: '$CI_PIPELINE_SOURCE == "push"'`);
    expect(yaml).not.toContain("CI_COMMIT_REF_NAME =~");
  });

  it("scopes the push rule to a branch filter, with regex metacharacters escaped", () => {
    const yaml = generateCiYaml({ ...base, branchFilter: ["main", "beta.2"] });
    expect(yaml).toContain(`$CI_COMMIT_REF_NAME =~ /^(main|beta\\.2)$/`);
  });

  // Incidental finding (not a refactor regression — this file is
  // byte-identical to `main`; `escapeRegexBranch` predates this branch and
  // "pipelines" are explicitly untouched by it per §3 of the test plan):
  // `escapeRegexBranch`'s character class (`.*+?^${}()|[]\\`) does not
  // include `/`, so a branch name containing a slash (e.g. a release or
  // feature branch — an extremely common naming convention) is emitted
  // unescaped inside the `/^(...)$/` GitLab regex-rule literal, which uses
  // `/` as its own delimiter. This documents the current (likely buggy)
  // behavior rather than asserting what it should be — worth a follow-up
  // outside this test plan's scope.
  it("[known gap, pre-existing] does not escape `/` in a branch name, even though `/` is the regex-rule delimiter", () => {
    const yaml = generateCiYaml({
      ...base,
      branchFilter: ["release/1.0"],
    });
    expect(yaml).toContain(`release/1\\.0`); // "/" left bare, "." escaped
    expect(yaml).not.toContain(`release\\/1\\.0`); // the fix this gap needs
  });

  it("emits one rule per configured trigger event", () => {
    const yaml = generateCiYaml({
      ...base,
      triggerEvents: ["push", "merge_request", "schedule", "manual"],
    });
    expect(yaml).toContain(`$CI_PIPELINE_SOURCE == "merge_request_event"`);
    expect(yaml).toContain(`$CI_PIPELINE_SOURCE == "schedule"`);
    expect(yaml).toContain(`$CI_PIPELINE_SOURCE == "web"`);
    expect(yaml).toContain(`$CI_PIPELINE_SOURCE == "push"`);
    // One `- if:` line per event, not fewer (a dropped event = silently
    // disabled pipeline trigger for that event type).
    expect(yaml.match(/- if:/g)?.length).toBe(4);
  });

  it("falls back to a plain push rule when triggerEvents is empty", () => {
    const yaml = generateCiYaml({ ...base, triggerEvents: [] });
    expect(yaml.match(/- if:/g)?.length).toBe(1);
    expect(yaml).toContain(`$CI_PIPELINE_SOURCE == "push"`);
  });

  it("threads --fail-on-changes only when the config enables it", () => {
    expect(generateCiYaml({ ...base, failOnChanges: false })).not.toContain(
      "--fail-on-changes",
    );
    expect(generateCiYaml({ ...base, failOnChanges: true })).toContain(
      "--fail-on-changes",
    );
  });

  it("threads projectPath, timeout, and pinned runner version into the trigger command", () => {
    const yaml = generateCiYaml({
      ...base,
      projectPath: "team/app",
      timeout: 120_000,
    });
    expect(yaml).toContain(`--repo "team/app"`);
    expect(yaml).toContain("--timeout 120000");
    expect(yaml).toMatch(/npx @lastest\/runner@\d+\.\d+\.\d+ trigger/);
  });

  it("produces a well-formed top-level structure (stages, job, rules present and balanced)", () => {
    const yaml = generateCiYaml(base);
    expect(yaml).toContain("stages:\n  - test");
    expect(yaml).toContain("lastest-visual-tests:\n  stage: test");
    expect(yaml).toContain("rules:");
    // No tab characters — a YAML validity foot-gun the string-templating
    // approach could silently introduce.
    expect(yaml).not.toContain("\t");
  });
});
