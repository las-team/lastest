# Credentials — plan

Status: proposal, 2026-08-27. Next PR in the pharma stack, after
`feat/pharma-onboarding`.

Closes the blocker named in [pharma-restricted-scope.md](pharma-restricted-scope.md)
§2.1: there is no per-repo secret store, so `process.env.VAULT_USER` inside a
test resolves against the embedded browser's own process environment, and the
seeded Vault/Salesforce tests can never run. It is not a pharma-only feature —
every customer with a login wall behind their app needs it.

Scope: a **Credentials** tab under Setup where a user stores the logins their
setup scripts and tests use, one table behind it, and a read-only reflection on
the test Variables tab.

---

## 1. The constraint that shapes everything

**A credential must not travel the variable-substitution path.**

Every other variable in the system is resolved by textual substitution into the
test source before dispatch — `resolveTestCodeForRunner()` in
[executor.ts:166](../src/lib/execution/executor.ts#L166) rewrites `{{sheet:…}}`,
`{{csv:…}}` and `{{var:…}}` into `resolvedCode`. Three things then happen to
that string, and all three are disqualifying for a password:

1. It is sent as `code: resolvedCode` with `codeHash: hashCode(resolvedCode)`
   ([executor.ts:1084](../src/lib/execution/executor.ts#L1084)). A rotated
   password would change the hash, and a credential rotation is not a code
   change — it must not invalidate a baseline.
2. Every resolved assign-mode value is persisted to
   `test_results.assignedVariables`
   ([executor.ts:1173](../src/lib/execution/executor.ts#L1173)) as plaintext
   jsonb, once per run, forever.
3. The Variables tab renders those values back as its "Last run" column
   ([test-vars-tab.tsx:219](../src/components/tests/test-vars-tab.tsx#L219)).

So `{{cred:vault.password}}` is the wrong design, however natural it looks
beside `{{csv:…}}`. Credentials get their own channel.

**The channel already exists in shape.** Test bodies are invoked as
`new AsyncFunction(...names, body)` with a fixed injected parameter list —
`page`, `baseUrl`, `stepLogger`, `expect`, `fixtures`, … — at four sites:

| Site | What it runs |
|---|---|
| [test-executor.ts:2208](../packages/embedded-browser/src/test-executor.ts#L2208) | test bodies |
| [test-executor.ts:3446](../packages/embedded-browser/src/test-executor.ts#L3446) | setup steps of type `test` |
| [setup-executor.ts:461](../packages/embedded-browser/src/setup-executor.ts#L461) | setup scripts |
| [debug-executor.ts:1079](../packages/embedded-browser/src/debug-executor.ts#L1079) | the step debugger |

Adding a `credentials` parameter to that list is the whole injection design.
The EB is the only execution surface — `packages/runner` is a CI-side trigger
client with no browser — so these four sites are the complete set.

Authoring then looks like:

```js
await page.getByLabel(/username/i).fill(credentials.vaultAdmin.username);
await page.getByLabel(/password/i).fill(credentials.vaultAdmin.password);
```

No token grammar to learn, autocompletes in the editor, and nothing to
substitute.

---

## 2. Storage — one table

```
repo_credentials
  id             text pk
  repositoryId   text fk -> repositories.id  on delete cascade
  name           text   -- the handle used in code: 'vaultAdmin'
  label          text   -- display: 'Vault sandbox admin'
  description    text
  fields         jsonb  -- CredentialField[]
  lastUsedAt     timestamp
  createdBy      text fk -> users.id
  createdAt / updatedAt
  unique (repositoryId, name)
```

```ts
interface CredentialField {
  key: string;        // 'username' | 'password' | 'totpSecret' | …
  value: string;      // secret fields hold `enc:v1:…`
  secret: boolean;
}
```

**One row per credential *set*, not per field.** A login is a username and a
password that belong together; a user thinks in terms of "the Vault admin
account", not two unrelated strings. Modelling it as a bag of independent
secrets would make the UI a flat list of 20 rows in which nothing indicates
which password goes with which username.

**Encryption reuses the existing primitive, it does not invent one.** Secret
field values are encrypted individually with `encrypt()` from
[crypto.ts](../src/lib/crypto.ts) (AES-256-GCM, `ENCRYPTION_KEY`), applied on
write and reversed on read in the query layer — exactly the arrangement
[crypto-fields.ts](../src/lib/crypto-fields.ts) already runs for
`setup_configs.authConfig`. Extend that module with
`encryptCredentialFields` / `decryptCredentialFields` rather than adding a
second field-crypto mechanism. Its two existing invariants carry over
unchanged: encrypt-on-write is `ENC_PREFIX`-guarded so it never double-encrypts,
and decrypt-on-read passes plaintext through so legacy rows keep working.

Non-secret fields (`username`, a document id) are stored in the clear, so the
list can show "svc-qa@acme.com / ••••••" without a decrypt on every render.

**Home:** `packages/db/src/schema/settings.ts`, beside `setupScripts` (:470),
`setupConfigs` (:495) and `storageStates` (:633). Same lifecycle, same owner,
same cascade.

---

## 3. Injection

- `RunTestCommand` and the setup-script command in
  [`@lastest/eb-protocol`](../packages/eb-protocol/src/index.ts) gain
  `credentials?: Record<string, Record<string, string>>`.
- The app decrypts **at dispatch**, in the executor, immediately before
  `createMessage(...)` — never earlier, never cached on a request-scoped object
  that something else might serialise.
- The EB freezes the object and passes it as the new `credentials` parameter.
- **Nothing about it is persisted.** Not in `assignedVariables`, not in
  `test_results`, not in the build record.

**Which credentials go to a run?** All of the repo's, keyed by name. Not a
per-test selection: a per-test allowlist is a real hardening step, but it is a
second table and a second UI, and the first version should not ask the user to
maintain a mapping they will get wrong. Revisit when there is a reason to.

---

## 4. UI — Setup → Credentials

[setup-page-client.tsx](<../src/app/(app)/setup/setup-page-client.tsx>) has two
tabs today, `Seed` and `Teardown` (:51). Add a third, **Credentials**.

**List view.** One card per credential:

```
Vault sandbox admin                    vaultAdmin        Last used 2h ago
username  svc-qa@acme.com
password  ••••••••                                       [Edit]  [Delete]
```

**Editor.** A dialog, following `ApiConfigForm`'s shape so it reads like the
rest of Setup:

- **Label** — free text.
- **Name** — the code handle, auto-slugged from the label (`Vault sandbox
  admin` → `vaultAdmin`), editable, validated `^[a-z][A-Za-z0-9]*$` and unique
  per repo. Renaming warns that existing test code referring to the old handle
  will break, and offers the old name for a find-and-replace.
- **Fields** — starts pre-filled with `username` (not secret) and `password`
  (secret), which is what almost every case needs. "Add field" for
  `totpSecret`, `apiKey`, a fixture document id. Each row: key, value, and a
  secret toggle.
- A **copy-the-reference** control on every field, yielding
  `credentials.vaultAdmin.password` on the clipboard. This is the piece that
  makes it easy to use — the user never has to learn or recall a syntax.

**Values are write-only.** Once saved, a secret field renders as `••••••` and
the API never returns its plaintext to the browser. You replace it; you do not
read it back. Editing stays easy — replacing a value is one field — while a
whole class of exfiltration (a read endpoint, a screenshot of the settings
page, a shared session) stops existing.

> **Decision to confirm.** The alternative is an admin-only "reveal" control.
> It is friendlier when someone forgets which account they used, and it is what
> most tools do. I am recommending against it for the first version because
> there is no audit log to record a reveal against (that is P1 in the
> restricted-scope doc, unbuilt), so a reveal would be an untracked read of a
> customer's production-adjacent credential. Easy to add later; hard to walk
> back once shipped.

**Access control.** `requireCapability("repos:settings")` for read and write —
the same gate as baselines and comparison config, and it already excludes
viewers, suspended teams and the demo plan
([capabilities.ts](../src/lib/auth/capabilities.ts)).

---

## 5. UI — the Variables tab reflection

The request is that credentials be *visible* where variables are, without a
second copy of the data. So: the Variables tab
([test-vars-tab.tsx](../src/components/tests/test-vars-tab.tsx)) gains a
read-only **Credentials** section below the variables table, fed by the same
`repo_credentials` rows.

- Columns: **Name**, **Fields** (`username, password ••••••`), **Reference**
  (`credentials.vaultAdmin.username`, with a copy button), **Last used**.
- No add/edit/delete. One link: *Manage in Setup → Credentials*.
- No `TestVariable` rows are created, no mirroring, no sync. One table, two
  readers.

That is the whole of "reflected on the Variables tab, single DB storage": the
Variables tab is a second *view*, never a second *store*.

---

## 6. Redaction

Storing a secret safely and then printing it is not storing it safely. Four
places leak, and each needs closing in the same PR:

1. **Step logs and error messages.** The EB holds the resolved plaintext for
   the duration of a run, so it can scrub its own output: replace any
   occurrence of a secret value in `stepLogger` lines and thrown error messages
   with `••••`. Cheap, and it catches the common case of a test echoing what it
   filled.
2. **`assignedVariables`.** Nothing to do beyond not putting credentials there
   — but worth an explicit test, because the natural "make it work like other
   variables" refactor would reintroduce it.
3. **Public share pages.** [redact-code.ts](../plugins/share/src/redact-code.ts)
   already scrubs secret-shaped literals from rendered test source. Since
   credentials never appear in source, this improves on its own — but add
   `credentials\.\w+\.\w+` to the recognised patterns so a shared page shows
   the reference rather than implying a value.
4. **DOM snapshots and screenshots.** A password input renders as dots, so the
   screenshot case is mostly self-solving; a DOM snapshot capturing a `value`
   attribute is not. Scrub secret values out of captured DOM in
   `multi-layer-capture.ts` on the same pass.

Server-side logging is already covered: `redactSecrets()`
([redact.ts](../src/lib/security/redact.ts)) matches on key name, and
`password` / `secret` / `token` are in its pattern list.

---

## 7. What this deliberately does not do

- **No per-environment credential sets.** PROD vs UAT vs prerelease sandbox is
  the environment model (gap analysis B2) and it changes the key of half a
  dozen tables. `repo_credentials` gets no `environmentId` now; B2 backfills
  one, the same way `environment_key` was pre-placed on the coverage rows.
- **No external secret backend.** No HashiCorp Vault, no AWS Secrets Manager.
  The query layer is the only thing that touches ciphertext, so a future
  provider swaps in behind it — but building the indirection before the first
  customer asks is speculative.
- **No MFA/TOTP execution.** A `totpSecret` field can be stored and read by a
  test that computes its own code; the platform does not generate one. Real
  SAML/MFA session handling is B4.
- **No credential rotation policy, expiry, or usage audit.** `lastUsedAt` is a
  convenience column, not an audit trail. The audit trail is P1.

---

## 8. Work breakdown

| | Work | Notes |
|---|---|---|
| 1 | `repo_credentials` table + `CredentialField` type + `pnpm db:push` | schema/settings.ts |
| 2 | `encryptCredentialFields` / `decryptCredentialFields` in `crypto-fields.ts`; queries in `queries/settings.ts` applying them on write/read | mirrors `setup_configs.authConfig` |
| 3 | Server actions behind `requireCapability("repos:settings")`; list action returns secrets masked, never plaintext | |
| 4 | `credentials` on the EB protocol commands; decrypt-at-dispatch in the executor | protocol + executor |
| 5 | `credentials` parameter at all four `AsyncFunction` sites | the injection |
| 6 | Setup → Credentials tab: list, editor dialog, copy-reference | |
| 7 | Variables-tab read-only section | one link back to Setup |
| 8 | Redaction: step logs, DOM capture, share-page pattern | §6 |
| 9 | Re-point the pharma seed from `process.env.VAULT_USER` to `credentials.vault.username`, drop the "Blocked:" guards, and un-quarantine | closes §2.1 |
| 10 | Tests: crypto round-trip; no secret in `assignedVariables`; no plaintext from the list action; step-log scrub; seed integration | |

Item 9 is the point of the whole thing: it is what turns the two seeded tests
from an illustration into something a Veeva consultant can actually run against
their sandbox.

## 9. Open question for review

**Should `credentials` be available to every test in the repo, or opted into
per test?** §3 argues for repo-wide because a per-test allowlist is a mapping
users maintain badly. The counter-argument is real though: a repo-wide object
means any test — including one an AI agent authored — can read every credential
the repo holds. If that trade lands wrong, the smallest fix is an opt-in list on
the credential (`usableByTests: 'all' | testId[]`) rather than a new table.
