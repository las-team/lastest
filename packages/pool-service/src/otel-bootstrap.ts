/**
 * Preload entry point — bundled to `dist/otel-bootstrap.cjs` and loaded with
 * `node --require dist/otel-bootstrap.cjs dist/main.cjs`.
 *
 * It is a separate bundle, and CommonJS, for one reason: OTel's HTTP
 * instrumentation patches the module registry through require-in-the-middle,
 * which only sees `require()` calls. `main.cjs` must therefore be CJS too (it
 * is — see the `build:main` script), and this file must finish executing
 * before `main.cjs` performs its first `require("https")`. `--require` is the
 * only ordering guarantee that doesn't depend on how esbuild happens to hoist
 * module initialisers.
 *
 * NOT wired through NODE_OPTIONS on purpose: that would leak into the
 * container HEALTHCHECK's `node -e` and into every process-mode EB child this
 * service spawns, starting a throwaway SDK in each.
 */
// The preload runs before main.cjs, so it also runs before main's own
// `import "./env"` — without this the OTEL_* keys in a dev `.env.local` would
// be invisible here and tracing would silently stay off. Loading it twice is
// harmless: the second pass skips every key already present in process.env.
import "./env";
import { startOtel } from "./otel";

startOtel();
