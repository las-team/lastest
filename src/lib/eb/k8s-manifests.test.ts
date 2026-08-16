import { readFileSync, readdirSync } from "fs";
import path from "path";

// js-yaml v5 is ESM-only with named exports — it has no default export.
import { loadAll } from "js-yaml";
import { describe, expect, it } from "vitest";

/**
 * Guards the "EB token denial" invariant documented in CLAUDE.md: no pod in
 * the `lastest` namespace holds a Kubernetes ServiceAccount token unless it
 * explicitly names a scoped SA.
 *
 * `k8s/namespace.yaml` denies automount on the namespace's `default` SA, but
 * that is a deployment-time step — it only protects clusters where someone
 * applied it. These assertions cover the other half: every pod spec in the
 * repo must state its own position, so a manifest applied to a namespace that
 * never got the patch still comes up tokenless.
 *
 * The EB Job spec is built programmatically, not from these files — see the
 * `jobSpec pod hardening` test in packages/pool-service/src/provisioner.test.ts.
 */

const K8S_DIR = path.resolve(__dirname, "../../../k8s");

/** ServiceAccounts that are allowed to hold a token, and why. */
const TOKEN_HOLDERS = new Set([
  // Creates/deletes EB Jobs and reads their pod logs. Bound to the
  // namespace-local lastest-pool-eb-provisioner Role only.
  "lastest-pool",
  // Same rights for the single-container topology, where the app process runs
  // the pool service in-process (k8s/embedded-browser-rbac.yaml).
  "lastest-app",
]);

type PodSpec = {
  serviceAccountName?: string;
  automountServiceAccountToken?: boolean;
};

type Manifest = {
  kind?: string;
  metadata?: { name?: string };
  spec?: {
    template?: { spec?: PodSpec };
    jobTemplate?: { spec?: { template?: { spec?: PodSpec } } };
  };
};

/** Every pod template across every manifest, labelled by file and object. */
function podSpecs(): Array<{ where: string; pod: PodSpec }> {
  const found: Array<{ where: string; pod: PodSpec }> = [];
  for (const file of readdirSync(K8S_DIR).filter((f) => f.endsWith(".yaml"))) {
    const docs = loadAll(
      readFileSync(path.join(K8S_DIR, file), "utf8"),
    ) as Manifest[];
    for (const doc of docs) {
      if (!doc) continue;
      // Deployment/Job/StatefulSet nest the pod one level down; CronJob two.
      const pod =
        doc.spec?.template?.spec ?? doc.spec?.jobTemplate?.spec?.template?.spec;
      if (!pod) continue;
      found.push({
        where: `${file} ${doc.kind}/${doc.metadata?.name}`,
        pod,
      });
    }
  }
  return found;
}

describe("k8s manifests — ServiceAccount token exposure", () => {
  it("finds pod specs to check (guards against a broken glob silently passing)", () => {
    expect(podSpecs().length).toBeGreaterThanOrEqual(5);
  });

  it("no pod mounts a token unless it names a scoped ServiceAccount", () => {
    const offenders = podSpecs()
      .filter(({ pod }) => {
        const sa = pod.serviceAccountName;
        const usesDefaultSA = !sa || sa === "default";
        return usesDefaultSA && pod.automountServiceAccountToken !== false;
      })
      .map(({ where }) => where);

    // A pod on the `default` SA must opt out at the pod level. Anything that
    // genuinely needs the API gets its own SA + Role instead — never the
    // namespace default, which every workload shares.
    expect(offenders).toEqual([]);
  });

  it("only known-scoped ServiceAccounts are referenced", () => {
    const unexpected = podSpecs()
      .filter(({ pod }) => {
        const sa = pod.serviceAccountName;
        return sa && sa !== "default" && !TOKEN_HOLDERS.has(sa);
      })
      .map(({ where, pod }) => `${where} → ${pod.serviceAccountName}`);

    // A new named SA means new cluster credentials — it needs a scoped Role
    // and an entry in TOKEN_HOLDERS above, so the grant is a deliberate act.
    expect(unexpected).toEqual([]);
  });
});
