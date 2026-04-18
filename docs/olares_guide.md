# Olares platform learnings — gotchas & routing

Hard-won notes from deploying `lastest` / `lastestalt` to Olares-on-k3s. Each section is a gotcha that caused a real outage during rollout. Intended audience: the next person who touches the Helm chart or cluster networking.

---

## 1. Envoy sidecar injection is driven by pod labels matching entrance names, not admission webhook namespace

- `olares-envoy-sidecar` + `render-envoy-config` + `olares-sidecar-init` containers are injected by Olares's studio-server mutating webhook, conditional on pod labels.
- The webhook matches `io.kompose.service: <label>` against the OlaresManifest entrance `name`. **If they match, envoy is injected.**
- Pods that use a *different* `io.kompose.service` label skip envoy injection entirely. Use this to create companion envoy-less Deployments in the same namespace (e.g., `io.kompose.service: lastest-internal`) — useful for internal APIs that external Jobs need to reach without authelia.
- The devcontainer webhook (`studioserver-shared.ns`) separately rejects raw kubectl-created Deployments in namespaces labeled `dev.bytetrade.io/dev-owner=true` that lack `meta.helm.sh/release-name` annotations. Use Helm release annotations to bypass.

## 2. `authLevel: public` in OlaresManifest does NOT disable per-pod authelia

- `authLevel: private|internal|public` affects Olares's external routing policy, NOT the in-pod envoy's `ext_authz` filter.
- Regardless of `authLevel`, the envoy sidecar always runs with `ext_authz` pointing at `authelia-backend:9091/api/verify/`. Requests without an Olares session cookie get `400 "cannot get user name from header"`.
- Confirmed by in-cluster probes at all `authLevel` values — behavior identical.
- Users access apps externally via a path that either (a) bypasses envoy by targeting the `bfl` proxy (which injects `X-BFL-User` after validating the session), or (b) doesn't go through envoy at all (companion deployment pattern).

## 3. `cannot get user name from header` = authelia rejecting without a session

- This is the signature of a request that reached authelia via envoy but lacked the headers authelia needs to identify a user.
- Authelia's `allowed_headers` whitelist (forwarded from envoy's auth request): `cookie`, `proxy-authorization`, `x-unauth-*`, `x-authorization`, `x-real-ip`, `x-bfl-user`, `terminus-nonce`, `user-agent`.
- `X-BFL-User: <valid-olares-user>` header alone gets past user-existence but still returns 401 without a session. There's no "API token" header that bypasses authelia — only a live session cookie.

## 4. Cloudflare Tunnel lives on the node as a systemd service, not in-cluster

- `cloudflared.service` runs on the olares node, config at `/etc/cloudflared/config.yaml`.
- Its `service` origin points at a ClusterIP inside the k8s cluster.
- **Olares auto-rewrites this config when apps change** (we saw it modified at `11:44:29Z` after an unrelated app reinstall). The original target was `https://10.233.36.201:443` (bfl). The auto-rewrite changed it to the lastest Service directly, which bypasses bfl and hits envoy raw → 400.
- **Correct target for CF Tunnel on Olares:** `https://<bfl-cluster-ip>:443` with `originRequest: { noTLSVerify: true }`. bfl handles per-hostname routing + injects `X-BFL-User` before forwarding upstream.
- After fixing, persist via backup: `cp /etc/cloudflared/config.yaml /etc/cloudflared/config.yaml.bak`

## 5. Chart Deployment name MUST equal app name (Olares lint)

- Olares lint rejects charts where the Deployment/StatefulSet resource name ≠ `metadata.name` from OlaresManifest:
  ```
  must have a deployment/sts name equal app name lastest-dev
  ```
- The original older chart (pre-lint) sometimes had `name: lastest` (template) while the app was `lastest-dev` — Olares's webhook renamed at apply time. That era is over; current lint enforces name-match at chart-upload time.
- **Helm-upgrade conflict anti-pattern (historical)**: when template said `Deployment/lastest` and cluster had webhook-renamed `Deployment/lastest-dev`, Helm upgrade tried to CREATE `lastest` (not in cluster), webhook renamed to `lastest-dev`, collided → `deployments.apps "lastest-dev" already exists`. Fixed by using `lastest-dev` in template directly.
- **If you inherit this mismatch**: delete the failed Helm release secret (`sh.helm.release.v1.<app>.<rev>`); Helm re-uses the last successful revision. Live Deployment stays running; `upgradeFailed` ApplicationManager state eventually reconciles.
- `Service` resource name can differ from Deployment name (we use `lastest` for the Service, `lastest-dev` for the Deployment — selectors must match the Deployment's `io.kompose.service` label).

## 6. Custom domain binding is bfl state, not chart config

- Custom domains like `app.lastest.cloud` are managed via bfl's API (`/bfl/settings/v1alpha1/applications/<app>/setup/domain`).
- The binding is NOT part of the app's Helm chart or OlaresManifest. It's separate Olares user-space state.
- `Helm upgrade` doesn't touch custom domains, but recreating the `Application` CR can — bfl reconciles on Application change, and the binding can drop out of the FRP `CustomDomains` list and never get re-added (we saw this happen).
- bfl logs show `customdomain-status-check queue request` periodically; `action: 2` = status check, `action: 1` = add, `action: 3` = remove.
- If `kubectl -n user-space-ewyctorlab get cm reverse-proxy-config -o yaml` shows `CustomDomains: null`, the binding is gone — re-add via the LarePass settings UI (no kubectl-only path found).

## 7. NetworkPolicy `user-system-np` blocks cross-namespace calls by label

- The `user-system-ewyctorlab` namespace (which hosts Citus, authelia) has a NetworkPolicy that allows ingress only from namespaces carrying one of:
  - `bytetrade.io/ns-owner=<owner>`
  - `bytetrade.io/ns-type=system`
  - `bytetrade.io/ns-shared=true`
  - `kubernetes.io/metadata.name=user-system-<owner>`
- **Custom labels applied to arbitrary namespaces get stripped by an Olares controller** (verified: kubectl label + 3s wait = gone). Olares namespaces pre-provisioned by app-service come with the right labels; ad-hoc namespaces don't.
- **If you create a namespace outside the app-service flow, cross-namespace calls to Citus will `CONNECT_TIMEOUT`.** Put your deployment inside an existing app-service-managed namespace (e.g., `<app>-dev-<owner>`) to inherit the right labels.

## 8. Citus per-user DB is provisioned lazily; role + DB can be wiped by reinstall

- Citus runs in `os-platform` (superuser role `olares`, password via `POSTGRES_PASSWORD` env on the pod).
- Per-user DB role secret lives in `user-system-<owner>/lastest-dev-user-system-<owner>-postgres-password`.
- A Helm reinstall of an app can wipe the role/database, causing the new pod to crash with `password authentication failed`. Re-create:
  ```sql
  CREATE ROLE <role> WITH LOGIN PASSWORD '<from-secret>';
  CREATE DATABASE <db> OWNER <role>;
  ```
  (DROP DATABASE cannot run inside a transaction block — run drop + create as separate commands.)

## 9. hostPath volumes need UID 1000 ownership, not root

- Olares mounts `/olares/rootfs/userspace/.../Data/<app>/...` as hostPath for app data.
- Created as `root:root 0755` on first use → pods running as `PUID=1000` get `Permission denied` on `/app/storage/screenshots`, crashlooping.
- Prod's prod directories are `1000:1000` because they were first populated under that UID. Fresh hostPath dirs are root-owned.
- Fix either with `chown -R 1000:1000 <path>` on the node, or use `emptyDir` for ephemeral test data.

## 10. Sum of container resource limits must be < `OlaresManifest.spec.limitedCpu/Memory`

- Olares lint rejects charts where the sum of limits/requests exceeds the manifest `spec.limitedCpu`, `spec.limitedMemory`, `spec.requiredCpu`, `spec.requiredMemory`.
- Multi-container pods (e.g., app + N EB sidecars) need headroom. Add up every container and set `spec.limitedCpu` / `spec.limitedMemory` above the total.
- For `lastest-dev` with app (2 CPU / 2 Gi limit) + 10 EBs (1 CPU / 1 Gi limit each) = 12 CPU / 12 Gi → manifest needs at least `limitedCpu: 14000m`, `limitedMemory: 14336Mi`.

## 11. Chart folder name must match `^[a-z0-9]{1,30}$`

- Hyphens disallowed. The `.tgz` top-level directory must be lowercase alphanumeric only.
- Chart `name`, OlaresManifest `metadata.appid`, `metadata.name` can contain hyphens — but the unpacked folder can't.
- Package with `tar czf chart.tgz --transform 's|actual-dir|lastestalt|' actual-dir/` if your working dir has hyphens.

## 12. `app.lastest.cloud` routing path

Full traffic flow that works:

```
browser → DNS (Cloudflare) → CF Tunnel (systemd cloudflared on node)
       → https://<bfl-clusterIP>:443 (noTLSVerify)
       → bfl nginx (handles routing by Host header + injects X-BFL-User)
       → upstream Service (lastest)
       → pod's envoy sidecar (sees valid X-BFL-User → authelia OK)
       → app container on :3000
```

The critical middleman is **bfl**. Without it in the path, any request from outside Olares's auth flow gets authelia 400. If something rewrites `cloudflared`'s `service:` to bypass bfl, routing breaks.

## 13. ApplicationManager vs Application CR state ≠ actual pod state

- `Application` CR state: derived from pod health + entrance status → reflects live app.
- `ApplicationManager` CR state: derived from last Helm op result → shows `upgradeFailed` even when the app is running fine.
- LarePass UI shows `ApplicationManager` state. A failed Helm op leaves a red badge until next successful op, regardless of live health.
- To clear `upgradeFailed` without a full reinstall: delete the failed Helm release secret, let Helm reconcile the ApplicationManager to the previous successful revision's state. Doesn't touch pods.

## 14. scheduler double-fire if multiple replicas share a DB

- `src/lib/scheduling/scheduler.ts` starts an interval on every Next.js instance. Multiple replicas (e.g., dual-deploy pattern with a companion `-internal` pod) sharing one DB will double-tick schedules.
- Respect `DISABLE_SCHEDULER=true` env on companion replicas (code change already landed).

## 15. Operational rules of thumb on Olares

- Never trust `helm upgrade` to be idempotent in Olares — the webhook-rename collision bites on every non-trivial chart change.
- Prefer kubectl patches for hotfixes, but ONLY kubectl-patch things that values.yaml can also set. Otherwise the next Helm op wipes your patches.
- Keep the chart source-of-truth synced with the kubectl-patched state. If you `kubectl set env` something, update `values.yaml` immediately.
- Before touching `/etc/cloudflared/config.yaml`, back it up: `cp config.yaml config.yaml.bak-$(date +%s)`. Olares reconcilers may rewrite it.
- External routing (CF Tunnel + bfl + authelia) lives outside the chart. Changes to app config don't reach this layer; you fix it via `/etc/cloudflared/config.yaml`, LarePass domain UI, or bfl API directly.
