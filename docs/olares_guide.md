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

## 16. Plan: package `lastest-dev` as a first-class Olares app (so Backup includes the DB)

Goal: move from "devbox-installed app whose Postgres is invisible to Olares Backup" to "app whose `middleware.postgres` is declared, so an Application-type backup captures the DB alongside the storage hostPath."

### Why this is needed
- Current `OlaresManifest.yaml` (embedded in helm-release secret `sh.helm.release.v1.lastest-dev.v2`) has `middleware: { Argo: null, Elasticsearch: null, MariaDB: null, Minio: null, MySQL: null, Nats: null, RabbitMQ: null }` — **no postgres declared.**
- The app talks to `citus-master-svc.user-system-ewyctorlab:5432/lastest_dev_ewyctorlab_lastest` using a manually-injected `DATABASE_URL` env (role was bootstrapped by hand per §8 of this doc, or inherited from `lastestalt`'s manifest).
- Backup module only auto-includes Postgres data for apps that **declare** `middleware.postgres`. Without the declaration, Olares' Application backup type can't even list the DB. The Directory backup at `/Data/lastest-dev/` misses it (Citus data lives in `os-platform`, not the app's hostPath).

### Current state worth preserving
- `permission.appData: true` ✅
- Entrance `lastest:3000` + custom domain `app.lastest.cloud` ✅
- `provider: ebapi` bypass-authelia paths (`/api/embedded/*`, `/api/ws/runner`) ✅
- `apiTimeout: 0` for SSE streams ✅
- Two-deploy split (`lastest-dev` + `lastest-internal-dev`) per §1 ✅

### Step 1 — Source-control the chart
Today the chart only exists inside the helm release secret. Pull it out and check it in.

```bash
ssh root@ewyctorlab.olares.local 'kubectl get secret sh.helm.release.v1.lastest-dev.v2 -n lastest-dev-ewyctorlab -o jsonpath="{.data.release}" | base64 -d | base64 -d | gunzip' \
  | python3 -c 'import json,sys,base64,os; r=json.load(sys.stdin); root="olares-chart"; os.makedirs(root, exist_ok=True); open(f"{root}/Chart.yaml","wb").write(base64.b64decode([f for f in r["chart"]["files"] if f["name"]=="Chart.yaml" or f["name"]=="Chart.bak"][0]["data"])); open(f"{root}/OlaresManifest.yaml","wb").write(base64.b64decode([f for f in r["chart"]["files"] if f["name"]=="OlaresManifest.yaml"][0]["data"])); [open(f"{root}/{t[\"name\"]}","wb").write(base64.b64decode(t["data"])) for t in r["chart"].get("templates",[]) if not __import__("os").makedirs(os.path.dirname(f"{root}/{t[\"name\"]}"), exist_ok=True)]'
```

Then commit `olares-chart/` to the repo. From this point on, deploys read the chart from the repo, not from the cluster.

### Step 2 — Declare Postgres in `OlaresManifest.yaml`
Following the n8n pattern (`beclab/apps/n8n/OlaresManifest.yaml`):

```yaml
middleware:
  postgres:
    username: lastest          # role name (Olares may prefix with appid)
    password: lastest          # placeholder; Olares replaces with real generated secret
    databases:
      - name: lastest
        distributed: true      # use Citus distributed plug-in
        # extensions: []       # add here if any (e.g. uuid-ossp); none needed today
```

This is the load-bearing change. On install/reinstall, Olares' middleware controller provisions a real role + DB on citus and renders the helm values `.Values.postgres.{host,port,username,password,databases.lastest}`.

### Step 3 — Templatize `DATABASE_URL` (and per §14 `DISABLE_SCHEDULER`)
Replace the hardcoded value in `templates/deployment.yaml` for both `lastest-dev` and `lastest-internal-dev`:

```yaml
- name: DATABASE_URL
  value: "postgresql://{{ .Values.postgres.username }}:{{ .Values.postgres.password }}@{{ .Values.postgres.host }}:{{ .Values.postgres.port }}/{{ .Values.postgres.databases.lastest }}?sslmode=disable"
```

Also templatize:
- `EB_IMAGE: "lastest-embedded-browser:{{ .Chart.AppVersion }}"` (or pin)
- `LASTEST_URL: "http://lastest-internal.{{ .Release.Namespace }}.svc:3000"`
- `NEXT_PUBLIC_APP_URL: "https://{{ index (split "," .Values.domain.lastest) "_0" }}"`

### Step 4 — Switch the storage hostPath to `.Values.userspace.appData`
Today:
```yaml
volumes:
  - name: app-storage
    hostPath:
      path: /olares/rootfs/userspace/pvc-userspace-ewyctorlab-yu0x1nh2ugvljohl/Data/lastest-dev/lastest/lastest2/storage
      type: DirectoryOrCreate
```
Replace with:
```yaml
volumes:
  - name: app-storage
    hostPath:
      path: {{ .Values.userspace.appData }}/storage/
      type: DirectoryOrCreate
```
The physical directory is the same (`/olares/rootfs/userspace/pvc-userspace-<owner>-<hash>/Data/lastest-dev/lastest/...`) — `userspace.appData` resolves to it. After re-install, run `chown -R 1000:1000 /olares/rootfs/userspace/.../Data/lastest-dev/` per §9, otherwise pods crashloop on permission denied.

Drop the `emptyDir`-backed `/app/data` mount — the SQLite leftover (`lastest2.db*`) is from an old build and unused now.

### Step 5 — Secrets management
Pod env today carries `BETTER_AUTH_SECRET`, `SYSTEM_EB_TOKEN`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `TWENTY_API_KEY`, `BUG_REPORT_DISCORD_WEBHOOK_URL` as plain `value:`. Move these to a chart-managed `Secret` (`templates/secret.yaml`) so they're versioned via the chart's `values.yaml` (encrypted with sops/age outside the repo, or bound to Infisical which is already running on the box).

Without this step, a chart reinstall (Step 7) silently zeroes these out and sign-in / EB / integrations break.

### Step 6 — Pre-reinstall DB dump
Before any uninstall/reinstall (Step 7), dump the current DB so we can restore. Run from Olares host:
```bash
kubectl exec -n lastest-dev-ewyctorlab deploy/lastest-dev -c lastest -- \
  sh -c 'apt-get update -q && apt-get install -y -q postgresql-client && pg_dump "$DATABASE_URL" | gzip' \
  > /tmp/lastest-pre-reinstall.sql.gz
scp /tmp/lastest-pre-reinstall.sql.gz ewyct@192.168.1.138:/DATA/.media/V3-SSD/Backups/
```
(Same temporary apt install we'd otherwise do for the ad-hoc backup.)

### Step 7 — Re-install via Devbox
Per §5 + §13, **helm-upgrading** an OlaresManifest that newly declares middleware is not safe — the middleware controller only provisions on app install. Do an uninstall/reinstall instead:

1. LarePass → Apps → `lastest-dev` → Uninstall (this removes the Application CR, helm release, deployments, and the citus role/DB per §8 — **but keeps the hostPath under `/Data/lastest-dev/`**).
2. Package the new chart: `tar czf lastest-dev.tgz olares-chart/` (folder name must match `^[a-z0-9]{1,30}$` per §11 — rename to `lastestdev/` inside the tarball with `--transform`).
3. LarePass → Devbox → Install from local chart → upload tgz.
4. Wait for Olares to provision the new postgres role + DB (visible as a new secret in `user-system-ewyctorlab/lastest-dev-user-system-ewyctorlab-postgres-password`).
5. `chown -R 1000:1000 /olares/rootfs/userspace/.../Data/lastest-dev/` per §9.
6. Restore DB: `gunzip -c /DATA/.media/V3-SSD/Backups/lastest-pre-reinstall.sql.gz | kubectl exec -i -n lastest-dev-ewyctorlab deploy/lastest-dev -c lastest -- psql "$DATABASE_URL"`.
7. Re-bind custom domain `app.lastest.cloud` in LarePass settings (per §6, this is bfl state and gets dropped by Application CR recreation).
8. Verify CF Tunnel `service:` in `/etc/cloudflared/config.yaml` still points at the bfl ClusterIP, not the lastest Service directly (per §4).

### Step 8 — Create the Application-type backup
Once postgres is declared in the manifest:
- LarePass → Settings → Backup → New backup → type: **Application** → select `lastest-dev`. This snapshots: Citus DB rows for `lastest_dev_ewyctorlab_lastest` + appData hostPath + k8s configs/secrets for this app. Schedule weekly, same offsite target `/Files/External/olares/V_5TB_USB/`.
- Keep the existing Directory backup of `/Data/lastest-dev/` as redundancy.

### What's missing / open risks

1. **No source-controlled chart yet.** Step 1 extracts it but commit + repo layout (`olares-chart/` vs `deploy/olares/`) hasn't been decided. Deploy script (`scripts/deploy.sh olares`) currently does image-import + rollout-restart only; needs a new path for `helm upgrade --install` once the chart is in the repo.
2. **Citus distributed-table compatibility.** Drizzle schema (`src/lib/db/schema.ts`, ~1680 lines) hasn't been audited for Citus distributed-table restrictions: no `RETURNING` on distributed inserts with non-distribution-key cols, FK constraints across distributed tables are limited, `SERIAL` PKs interact awkwardly with distribution. We use `cuid()`/text PKs everywhere — likely fine — but worth a dry-run on a staging Citus install before committing to `distributed: true`. Fallback: omit `distributed: true` for a single-node table layout.
3. **DB-name uncertainty.** When you redeclare middleware, Olares may name the new DB `lastest` (per manifest) or prefix-mangle it to `lastest_<owner>_<appid>` like today's `lastest_dev_ewyctorlab_lastest`. Restore command in Step 7.6 needs to match whatever it actually names — verify with `kubectl get secret -n user-system-ewyctorlab -l app=lastest-dev` after reinstall.
4. **EB Job pods reference the namespace + image directly.** `src/lib/eb/provisioner.ts:127-168` writes a Job spec with `namespace: lastest` (or whatever `EB_NAMESPACE` is). If the reinstall changes the namespace (it shouldn't — `lastest-dev-ewyctorlab` stays), this needs no change; if it does, update `.env` / values.
5. **Secrets bootstrap chicken-and-egg.** Step 5's chart-managed Secret needs the actual secret values committed somewhere encrypted. Options: sops+age in repo, an Infisical project (already running in `os-protected`), or a one-time `kubectl create secret` post-install. Pick before Step 7.
6. **Internal-pod connectivity.** `lastest-internal-dev` reaches the envoy-fronted pod via `host.k3d.internal` in dev and via cluster DNS in prod. After reinstall, confirm `LASTEST_URL` resolves correctly inside the cluster — Step 3's templatization should handle this but test EB Job → app POSTs immediately after.
7. **Downtime.** Step 7 is an uninstall/reinstall = full app outage. Schedule a maintenance window; right window is when no active runs are queued. Budget ~30 min including DB restore.
8. **Backup encryption keys.** Olares encrypts backup archives end-to-end. If the restore is ever needed on a fresh Olares install, the encryption key (held in `os-framework`) must also be preserved separately — the backup is useless without it.
9. **Custom domain re-add is manual.** Per §6, there's no kubectl path — re-add via LarePass UI. Documented but a step that can be missed.
10. **No staging environment** to rehearse the reinstall. The two-pod dev split (per §15 of project memory `olares_two_pod_split`) is the prod env. Rehearse on a throwaway `lastestalt-dev` app if you want a dry run before touching `lastest-dev` itself.
