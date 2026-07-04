import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";

const SECRET = "test-vercel-client-secret";

beforeAll(() => {
  process.env.VERCEL_INTEGRATION_CLIENT_SECRET = SECRET;
});

import {
  verifyVercelSignature,
  normalizeDeploymentPayload,
  deploymentTargetUrl,
} from "./webhooks";
import { conclusionForBuildStatus } from "./checks";

function sign(body: string): string {
  return crypto.createHmac("sha1", SECRET).update(body, "utf8").digest("hex");
}

describe("verifyVercelSignature", () => {
  it("accepts a correct HMAC-SHA1 signature of the raw body", () => {
    const body = JSON.stringify({ type: "deployment.created", id: "evt_1" });
    expect(verifyVercelSignature(body, sign(body))).toBe(true);
  });

  it("accepts a signature carrying a sha1= prefix", () => {
    const body = "{}";
    expect(verifyVercelSignature(body, `sha1=${sign(body)}`)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = JSON.stringify({ type: "deployment.created", id: "evt_1" });
    const sig = sign(body);
    expect(verifyVercelSignature(body + " ", sig)).toBe(false);
  });

  it("rejects a missing signature", () => {
    expect(verifyVercelSignature("{}", null)).toBe(false);
  });

  it("rejects a wrong-length signature without throwing", () => {
    expect(verifyVercelSignature("{}", "deadbeef")).toBe(false);
  });
});

describe("normalizeDeploymentPayload", () => {
  it("reads nested-object payloads (canonical Vercel shape)", () => {
    const norm = normalizeDeploymentPayload({
      deployment: {
        id: "dpl_1",
        url: "my-app-abc123.vercel.app",
        meta: {
          githubCommitRef: "feature/x",
          githubCommitSha: "abc123",
          githubOrg: "acme",
          githubRepo: "web",
        },
      },
      project: { id: "prj_1" },
      team: { id: "team_1" },
      target: null,
      links: {
        deployment: "https://vercel.com/d",
        project: "https://vercel.com/p",
      },
    });
    expect(norm.deploymentId).toBe("dpl_1");
    expect(norm.deploymentUrl).toBe("my-app-abc123.vercel.app");
    expect(norm.projectId).toBe("prj_1");
    expect(norm.teamId).toBe("team_1");
    expect(norm.target).toBeNull(); // null = preview
    expect(norm.meta.githubCommitRef).toBe("feature/x");
    expect(norm.meta.githubCommitSha).toBe("abc123");
  });

  it("falls back to flat dotted keys", () => {
    const norm = normalizeDeploymentPayload({
      "deployment.id": "dpl_2",
      "deployment.url": "flat-xyz.vercel.app",
      "project.id": "prj_2",
      "deployment.meta.githubCommitRef": "main",
      target: "production",
    });
    expect(norm.deploymentId).toBe("dpl_2");
    expect(norm.deploymentUrl).toBe("flat-xyz.vercel.app");
    expect(norm.projectId).toBe("prj_2");
    expect(norm.meta.githubCommitRef).toBe("main");
    expect(norm.target).toBe("production");
  });

  it("extracts the rerequested check id", () => {
    const norm = normalizeDeploymentPayload({
      deployment: { id: "dpl_3" },
      check: { id: "check_9" },
    });
    expect(norm.checkId).toBe("check_9");
    expect(norm.deploymentId).toBe("dpl_3");
  });
});

describe("deploymentTargetUrl", () => {
  it("prefixes https:// on a scheme-less deployment url", () => {
    expect(deploymentTargetUrl("my-app.vercel.app")).toBe(
      "https://my-app.vercel.app",
    );
  });
  it("leaves an already-absolute url untouched", () => {
    expect(deploymentTargetUrl("https://x.vercel.app")).toBe(
      "https://x.vercel.app",
    );
  });
});

describe("conclusionForBuildStatus", () => {
  it("maps each BuildStatus per the spec table", () => {
    expect(conclusionForBuildStatus("safe_to_merge")).toBe("succeeded");
    expect(conclusionForBuildStatus("review_required")).toBe("failed");
    expect(conclusionForBuildStatus("blocked")).toBe("failed");
    expect(conclusionForBuildStatus("has_todos")).toBe("neutral");
    expect(conclusionForBuildStatus("executor_failed")).toBe("neutral");
  });
});
