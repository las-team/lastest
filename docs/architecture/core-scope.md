# What is core — revised boundary

**Status:** supersedes §6 of [`core-plugin-refactor.md`](./core-plugin-refactor.md).
**Why:** the RFC's core sprawled. This narrows it and adds the tier the RFC was
missing.

## 1. The RFC used the wrong bar

§6 said a module is core if:

> more than one plugin needs it, *or* it is a security/correctness boundary, *or*
> it is the product's definition (record → run → diff → review).

The first and third clauses are why core ended up with nine modules including SSE
fan-out and a screenshot store.

- **"More than one plugin needs it"** is an argument for a *library*, not for a
  protected, CODEOWNERS-gated module. Shared code and gate-kept code are
  different things, and conflating them means every useful utility eventually
  drifts into core and every core change needs your review.
- **"The product's definition"** has no edge. Everything in a product is the
  product.

The tell is `core/artifacts`. It was specified as "screenshots, evidence,
quota" — three things at completely different altitudes. *Quota* is a real
boundary: a feature that ignores it can fill the disk for every tenant.
*Evidence* is a Verify-phase concept that most features never touch. Bundling
them made core know what an "evidence bundle" is, which is a feature's business.

## 2. The revised bar

**A module is core only if a feature getting it wrong would break things for
everyone else.** Concretely, one of:

1. **Tenancy** — could expose one team's data to another.
2. **Capacity** — could exhaust a shared finite resource (EB pool, DB
   connections, disk).
3. **Money** — could bypass metering or entitlement gates.
4. **Credentials** — holds secrets: provider API keys, storage state, tokens.
5. **The registry itself** — the kernel, because something has to be.

Being *useful to many features* is explicitly **not** on this list. That is the
definition of a library.

## 3. Three tiers, not two

The RFC had `core/` and `plugins/`. The missing tier is why reusable things had
nowhere to go but core.

| Tier | Protected? | Rule |
| --- | --- | --- |
| `core/` | **Yes** — CODEOWNERS, own PR | Only §2's five reasons. Small and boring. |
| `libs/` | No | Shared, importable by anything. Useful ≠ core. No gate, no ceremony. |
| `plugins/` | No | Features. May also **provide** a capability to other plugins. |

**Provider plugins** are the direct answer to *"ha több pluginnek is kell egy
ilyen fan-out logika, ez is lehet plugin ami etethet más plugin feature-öket"*.
A plugin declares `provides: ["events"]`; the kernel wires it into the `ctx` of
plugins that declare `capabilities: ["events"]`. The consumer never imports the
provider, so the "no plugin → plugin import" rule holds unchanged. Composition
happens through the kernel, exactly as it does for core-provided capabilities.

The difference between a core capability and a plugin-provided one is only
*who reviews changes to it* — which is the whole point of the exercise.

## 4. Re-classification

| RFC §6 | Now | Reasoning |
| --- | --- | --- |
| `core/events` — activity events, SSE fan-out | **`events` provider plugin** | Fan-out is a delivery mechanism. It holds no secret, gates no spend, and cannot exhaust anything shared. If two plugins need it, that makes it a shared *provider*, not a boundary. |
| `core/artifacts` — screenshots, evidence, quota | **split.** `core/storage` = tenant-scoped bytes + quota, nothing else. Screenshot/baseline/evidence semantics → the features that own them | Quota and tenant isolation are capacity + tenancy. "Evidence" is Verify's vocabulary and does not belong in core's. |
| `core/ai` — provider abstraction | **`core/ai-gateway`** = credential custody + spend metering only. Prompt/retry/JSON-parse helpers → `libs/ai-kit` | Provider API keys are credentials; AI spend is money. Neither of those is `parseAiJson`. |
| `core/browser` | **EB lifecycle only** — see §5 | |
| `core/data` | **Plugin-owned storage only.** Core tables are not reachable, not even read-only | Your rule. See §6. |
| `core/identity` | **stays core** | Tenancy + money, unambiguously. |
| `core/jobs` | **stays core** | Shared queue; a runaway plugin starves every tenant. Capacity. |
| `core/exec`, `core/diff`, `core/verify` | **open** | These are "the product's definition" — the clause I just deleted. They are not obviously boundaries under §2. Deciding them needs a separate conversation; leaving them where they are costs nothing today. |

Net: core goes from nine modules to **five and a half** — kernel, contracts,
identity, storage, jobs, ai-gateway, browser — with three deferred.

## 5. `core/browser`, resized

> *"A core miért nem tud csak egy manage / create / teardown EB interfész lenni
> és orchestrálja a feature ahogy akarja?"*

It can, and it should. Core owns the parts that are boundaries under §2:

- **claim / release / teardown-on-throw** — a leaked EB is capacity.
- **pool cap and priority class** — capacity, and it is plan-derived, so money.
- **storage-state and credential injection** — credentials. The plugin passes an
  id; core resolves the secret. The plugin never holds it.
- **run-minute metering** — money.
- **deadline enforcement** — capacity. A plugin cannot hold an EB forever.
- **stream-URL grants** — tenancy. The plugin gets a signed, expiring grant, and
  never a pod address.

Everything else — `goto`, `act`, `snapshotDom`, evidence accumulation — is
orchestration, and the feature does it however it likes. Spike S3 showed those
helpers are highly repetitive across features, which makes them a good
**`libs/browser-kit`**: reusable, but with no reason to be gate-kept.

The page object core hands over is **re-exported by core**, so plugins still do
not depend on the `playwright` package directly and core keeps control of the
driver version. R4's honest claim becomes precise:

> No plugin can leak, outlive, over-allocate, or escape the tenancy of an EB.

Not "no plugin can do anything unexpected in a browser" — `evaluate` alone makes
that false, and pretending otherwise would be theatre.

## 6. Data: plugins never touch core tables

> *"ez ne exposálja a pluginek felé a core database-t […] a pluginek soha nem
> használhatják a core tábláit (olvasásra sem! - tessék a core-t hívni), a core
> meg leszarja hogy a pluginek mit tárolnak hol."*

Adopted, and it is stricter than the RFC — §5 allowed a plugin to declare an FK
to a core table. That is now out. `ctx.data` gives a plugin **only its own
storage**. To learn anything about a core entity it calls a core function.

**This has a cost that has to be paid explicitly, not discovered later.** No FK
to a core table means no database-level cascade. Delete a team, and its plugin
rows survive as orphans — which the RFC already flagged as a GDPR risk and which
this rule makes *certain* rather than merely possible.

The mitigation has to ship with the rule: plugins register a deletion hook, and
core's team/repo deletion path drives every registered hook. A test asserts that
every plugin with storage has one. Without that, this rule quietly breaks
deletion.

Precedent that this is workable: the schema already has **104 `*_id` columns
with no FK constraint** (§7). Convention-only references are the existing norm
here, not a novelty.

## 7. Breaking up the mega-schema

> *"ne egy darab mega drizzle séma legyen egy darab schema.ts-el, mert már
> kezelhetetlen […] nem tudom megmondani hogy van-e kereszthivatkozás táblák
> között."*

`pnpm schema:graph` now answers that question mechanically. Current state:

```
98 tables, 120 foreign keys, 104 convention-only *_id columns
```

### The three findings

**1. Extraction is unblocked — the dependency direction is already clean.**

```
Core → feature FKs (these BLOCK extraction): 0
```

No core table references a feature table. Every feature→core FK points the
allowed way. This is the single most important number here: it means the schema
can be split without first untangling a cycle.

**2. Four hub tables carry the coupling.**

```
36 inbound  repositories
24 inbound  tests
14 inbound  users
10 inbound  teams
```

74 of 120 FKs point at four tables. A split must keep these four in core and
must not try to move them.

**3. The real coupling is bigger than the FK graph — 104 columns look like
references but have no constraint.** Drizzle cannot see these, `db:push` will
never complain about them, and they are invisible to any tooling that reads FKs
only. This is the actual reason the schema feels unknowable: a third of the
relationships are not written down anywhere the machine can check.

That is worth fixing independently of this refactor — either promote them to
real FKs or document them as deliberate soft references. Right now nobody can
tell which is which, and that is the same problem in a different costume.

### Proposed decomposition

`pnpm schema:graph` groups the 98 tables into 8 modules plus 17 unassigned:

| Module | Tables | Destination |
| --- | --- | --- |
| `identity` | 9 | core |
| `repos` | 8 | core |
| `tests` | 10 | core |
| `runs` | 9 | core |
| `visual` | 12 | core |
| `settings` | 11 | core |
| `agents` | 7 | plugins (qa-agent, explorer, app-map, rca) |
| `growth` | 15 | plugins (gamification, launch, share, playground, analytics) |
| unassigned | 17 | **needs a decision** — listed by the tool |

The 22 feature tables leaving core is where *"a core leszarja hogy a pluginek mit
tárolnak"* becomes literally true. The remaining ~59 core tables still want
splitting into per-domain files, but that is a core-internal tidy-up with no
plugin consequences — worth doing for readability, not urgent for this refactor.

**Sequencing note.** Splitting the file and extracting plugin tables are two
different changes. Do the file split first as a pure move (no table changes, no
migration — `db:push` should be a no-op), verify the diff is zero-SQL, and only
then start moving tables to plugins. Combining them makes it impossible to tell a
refactor bug from a migration bug.

## 8. What this changes in the enforcement layer

The phase-0 machinery already landed and mostly still applies, with three edits
when the tiers exist:

- `libs/**` needs a zone: importable by core and plugins, and it must not import
  plugins. Without this it would fall through as "unclassified".
- The plugin import ban on `@lastest/db` becomes total — the S2 carve-out for
  `@lastest/db/schema` (needed for FKs) is no longer required, because plugins no
  longer declare FKs to core tables. That is a *simplification* the strict rule
  buys us.
- The kernel needs `provides` alongside `capabilities` so provider plugins can be
  wired without a direct import.
