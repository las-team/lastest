# Runner TS-stripper hardening plan

## Context

The remote runner (`packages/runner/src/runner.ts`) and the embedded-browser
executor (`packages/embedded-browser/src/test-executor.ts`) each carry a
hand-rolled `stripTypeAnnotations` that removes TS syntax so the test body can
be evaluated as plain JS via `new AsyncFunction(...)`.

Both functions share the same five regex passes (verified by
`src/lib/execution/runner-parity.test.ts`):

```ts
function stripTypeAnnotations(code: string): string {
  let result = code;
  result = result.replace(/\b(const|let|var)\s+(\w+)\s*:\s*[^=\n;]+(\s*=)/g, '$1 $2$3');
  result = result.replace(/\b(const|let|var)\s+(\{[^}]+\}|\[[^\]]+\])\s*:\s*[^=\n;]+(\s*=)/g, '$1 $2$3');
  result = result.replace(/\)\s+as\s+\w[\w<>\[\],\s|]*/g, ')');
  result = result.replace(/(\w)\s+as\s+\w[\w<>\[\],\s|]*/g, '$1');
  result = result.replace(/<\w[\w<>\[\],\s|]*>\s*(?=\(|[\w])/g, '');
  return result;
}
```

The stripper demonstrably fails on certain tests — e.g. `tests/mwhospital/35-invalid-appointments.spec.ts`
and `36-sent-notifications.spec.ts` fail in a Lastest build with
`"await is only valid in async functions and the top level bodies of modules"`,
which is the symptom of a body that didn't compile cleanly into an
`AsyncFunction`. Those tests contain `(i as HTMLElement).click()` inside a
`page.evaluate(() => { … })` callback.

**Semantic note on `as HTMLElement`.** TS cast expressions (`x as T`, `<T>x`)
and non-null assertions (`x!`) are **purely compile-time** — the TS compiler
(and all popular TS-strippers) emit *nothing* at runtime for them. Allowing
them in test code has zero safety or correctness impact — the only question
is whether the transpilation step produces valid JS.

## Observed / potential failure modes of the current regex

| Pattern | Current behavior | Risk |
| --- | --- | --- |
| `(x as HTMLElement).foo` | regex on line 4 matches `x as HTMLElement`, → `(x).foo` | ✅ handled in isolation |
| `x as unknown as HTMLElement` | `\s` is inside the `[\w<>\[\],\s\|]` char class, so the greedy type body can eat `unknown as HTMLElement` as one "type" → `x` | ⚠️ works, but by accident (multi-step casts) |
| `x!` (non-null assertion) | not handled | ❌ survives → runtime `SyntaxError` |
| `satisfies Foo` | not handled | ❌ survives → `SyntaxError` |
| Type-only `import type { X }` | not handled | ❌ survives → `ReferenceError`/`SyntaxError` when body has stray `type` keyword |
| Generic call `fn<T>(x)` | line 5 removes `<T>` only when followed by `(` or `\w`; comma-separated generics work, but multi-arg generics with `extends` clauses don't: `<T extends Foo, U>` contains ` extends ` which is in the class (letters) but only if surrounded by allowed chars | ⚠️ brittle |
| Type-annotated parameter in a nested arrow: `(i: HTMLElement) => i.click()` | not handled (parameter annotations) | ❌ survives → `SyntaxError` |
| Type-annotated return: `(): Promise<void> => {}` | partial via line 5 if `<void>` happens to match, otherwise fails | ❌ brittle |
| `as const` | matches `x as const` → `x` | ✅ handled |
| `as typeof foo` | `typeof` starts with `t`, a word char → treated as type name → replaced | ✅ handled |
| Comment containing `as HTMLElement` (e.g., `// cast as HTMLElement for foo`) | regex runs inside comments too | ⚠️ may mangle preceding word in comments |
| String literal `'x as HTMLElement'` | regex runs inside strings too | ⚠️ may mangle string contents |

The root cause is that regex-based stripping cannot distinguish code from
strings/comments and cannot represent TS grammar. It was fine when the only
inputs came from the AI code generator (which emits a constrained dialect),
but it breaks whenever humans paste real-world TS (Playwright specs, snippets,
etc.).

## Goal

Replace the five regex passes with a principled, bounded, well-tested
transform that:

1. handles every TS-only construct the AI generator and human-authored tests
   can reasonably emit,
2. is safe inside strings / template literals / comments,
3. keeps the body 1:1 line-compatible with the source (needed so stack traces
   in `stepLogger` reference the user-visible test text).

## Proposed approach — two options

### Option A — replace regex with a real TS→JS transpile (recommended)

Use `sucrase` or `esbuild`-transform in-process:

```ts
import { transform } from 'sucrase';
const { code } = transform(body, { transforms: ['typescript'], disableESTransforms: true });
```

`sucrase` is a tiny (~500KB) TypeScript-to-JavaScript transpiler already used
by the harness in dev. `disableESTransforms: true` preserves ES2020+ syntax
verbatim (async/await, optional chaining, spread) and only removes TS-specific
nodes. That gives us:

- correct handling of casts (`as`, `<T>`), non-null (`!`), satisfies, type
  params, parameter annotations, return-type annotations, `import type`, type
  declarations, enums (compiled), decorators, and anything else TS-only;
- no confusion with strings/comments — sucrase uses a real tokenizer;
- 1:1 line mapping (sucrase preserves line numbers by default).

**Cost:** ~1ms per test body; bundle size +400KB in the runner package (the
remote runner is already ~6MB). For the embedded-browser executor, which runs
inside the runtime image, either bundle sucrase or load at startup.

**Falls back to current regex** if the transpile throws, so tests that used
to work keep working while we roll out.

### Option B — expand the regex set with careful boundary rules

Keep the hand-rolled stripper but expand coverage and add safeguards:

1. **Skip strings / template literals / line & block comments.** Walk the
   source once and emit "protected" regions, apply regex only on the
   remainder. The `parseStatementBoundaries` function in
   `packages/shared/src/step-tracking.ts` already implements this scanner —
   reuse that code.
2. **Add missing passes:**
   - Non-null assertion: `\w!` where `!` is followed by `.`, `(`, `[`, `,`,
     `)`, `;`, `}`, or whitespace → strip the `!`.
   - `satisfies Foo` (same shape as `as Foo`).
   - Parameter annotations in arrow/function signatures: `\b(\w+)\s*:\s*([^=,)]+?)(?=[,)])` within argument lists only.
   - Return-type annotations: `\)\s*:\s*[^=>{;]+(?=\s*(=>|\{))` → `)`.
   - `import type …` lines and inline `type`/`interface` declarations (strip whole statement).
3. **Keep the `as` regex** but constrain the type body to avoid swallowing
   across `as` keywords: `(\w)\s+as\s+(\w+(?:<[^>]+>)?(?:\[\])*)` — stops at
   first whitespace boundary, handles generic parameters in one level.
4. **Idempotent multi-pass loop:** run the stripper until a fixed point (or
   max 3 iterations) to handle `x as A as B`.

**Cost:** no new dependency, but more regex bookkeeping and more pitfalls.

## Recommendation

Ship Option A. Rationale: it is *strictly* more correct, smaller code
surface, and removes an ongoing maintenance tax. The bundle-size increase is
lost in the noise of bundling Playwright itself.

## Implementation plan

1. **Add `sucrase` as a runtime dep to `packages/runner` and `packages/embedded-browser`.**
2. **Refactor `stripTypeAnnotations` in both locations** to:
   ```ts
   function stripTypeAnnotations(code: string): string {
     try {
       const { code: js } = transform(code, {
         transforms: ['typescript'],
         disableESTransforms: true,
         preserveDynamicImport: true,
         production: true,
       });
       return js;
     } catch {
       // Fall back to legacy regex path for backwards compatibility
       return legacyStripTypeAnnotations(code);
     }
   }
   ```
3. **Keep `runner-parity.test.ts`** and extend it with a new suite
   (`runner-parity-ts.test.ts`) covering at least these fixtures:
   - `(i as HTMLElement).click()` inside `page.evaluate`
   - `x!.foo()` non-null
   - `(el: HTMLElement) => el.click()` parameter annotation
   - `const x = <string>getRaw()` generic cast
   - `import type { Page } from 'playwright'` (must disappear)
   - `function foo(): Promise<void> {}` return-type annotation
   - `x as unknown as HTMLElement` double cast
   - `x satisfies Foo`
   - A comment containing `// cast x as HTMLElement` (must not mangle)
   - A string literal `"x as HTMLElement"` (must not mangle)
4. **Update `src/lib/execution/runner-parity.test.ts`** to assert that both
   runners agree on every fixture (the two stripper copies stay byte-identical).
5. **Roll out:**
   - Publish new `@lastest/runner` and rebuild `packages/embedded-browser`.
   - Bump the embedded image tag.
   - Re-run the mwhospital suite (tests 17–36) to confirm parity.
6. **Clean up:** once confidence is high (after one or two release cycles),
   delete the legacy regex fallback entirely.

## Rollback plan

Sucrase's `transform` is synchronous and deterministic; any failure throws
immediately. The `try/catch` keeps the old regex path reachable, so the worst
case on a bad input is "same behavior as today". A one-line revert removes
sucrase and restores the pure regex path.

## Out of scope

- Source-map support: not needed because we match line numbers via
  `disableESTransforms: true`.
- Full transpile of ESM `import` statements: the runner already handles
  `import …` by relying on the caller to pre-resolve names; test bodies import
  only `playwright` types, which sucrase strips.
- Support for decorators / enums — nobody writes those in test specs, but
  sucrase handles them for free.

## Work estimate

- ~2 hours to wire sucrase into both packages and add the fixture suite.
- ~30 min to re-import the two broken mwhospital tests once the runner ships.
