/**
 * Static type-check pass for AI-generated test code.
 *
 * Wraps the test body in a synthetic module that declares it as `TestFn`
 * (see runner-api.d.ts) and runs the TypeScript compiler. Diagnostics that
 * indicate the AI used an API the runner does not expose are surfaced; noise
 * (unused-locals, missing-imports for env-provided vars, JSX, etc.) is filtered.
 *
 * Catches: typoed methods (page.fooBar), unsupported matchers (toHaveFakeMatcher),
 * wrong arg arity, calling a method on the wrong type (e.g. Page methods on a
 * Locator), referring to a name not in the runner's injected variable bag.
 *
 * Does NOT catch: whether a selector resolves on the live page — that is the
 * job of mcp-validator.validateSelectorsOnPage, called after this passes.
 */

import * as ts from "typescript";
import * as fs from "node:fs";
import * as path from "node:path";
import { extractTestBody } from "@lastest/shared";

export interface ValidationDiagnostic {
  message: string;
  line: number;
  column: number;
  code: number;
}

export type ValidationResult =
  | { valid: true }
  | { valid: false; errors: ValidationDiagnostic[] };

// TypeScript error codes we want to report. Anything not in this set is
// considered noise and dropped. Each entry maps a TS diagnostic code → why we
// care about it for AI test validation.
const REPORTED_TS_CODES = new Set<number>([
  2304, // Cannot find name 'X'                (AI used a variable the runner doesn't inject)
  2305, // Module has no exported member       (rare with our wrap, but possible)
  2322, // Type 'X' is not assignable to type 'Y'
  2339, // Property 'X' does not exist on type (AI called a method we don't support)
  2345, // Argument of type 'X' is not assignable to parameter of type 'Y'
  2349, // Cannot invoke an expression whose type lacks a call signature
  2552, // Cannot find name 'X'. Did you mean 'Y'? — same intent as 2304 with a suggestion
  2554, // Expected N arguments, but got M    (wrong arity on matcher)
  2555, // Expected at least N arguments
  2580, // Cannot find name. Do you need to install type defs for X?
  2769, // No overload matches this call
  18046, // Property 'X' does not exist on type 'unknown' (defensive)
]);

const RUNNER_API_VIRTUAL_NAME = "__runner_api__.d.ts";
const TEST_VIRTUAL_NAME = "__ai_generated_test__.ts";

let cachedRunnerApiSource: string | null = null;

function getRunnerApiSource(): string {
  if (cachedRunnerApiSource !== null) return cachedRunnerApiSource;
  const apiPath = path.join(process.cwd(), "src/lib/ai/runner-api.d.ts");
  cachedRunnerApiSource = fs.readFileSync(apiPath, "utf8");
  return cachedRunnerApiSource;
}

function buildWrappedSource(body: string): string {
  return `// @ts-nocheck-suppress
import type { TestFn } from './__runner_api__';

declare const __test: TestFn;

const __runTest: TestFn = async (
  page,
  baseUrl,
  screenshotPath,
  stepLogger,
  expect,
  appState,
  locateWithFallback,
  fileUpload,
  clipboard,
  downloads,
  network,
  replayCursorPath,
  fixtures,
  __stepReached,
  __assertion,
) => {
${body}
};

// Suppress "declared but never used" noise on the bound names above.
void __runTest;
void __test;
`;
}

function makeHost(
  virtualFiles: Map<string, string>,
  compilerOptions: ts.CompilerOptions,
): ts.CompilerHost {
  const real = ts.createCompilerHost(compilerOptions, true);
  return {
    ...real,
    getSourceFile: (
      fileName,
      languageVersion,
      onError,
      shouldCreateNewSourceFile,
    ) => {
      const virtual =
        virtualFiles.get(fileName) ?? virtualFiles.get(path.basename(fileName));
      if (virtual !== undefined) {
        return ts.createSourceFile(fileName, virtual, languageVersion, true);
      }
      return real.getSourceFile(
        fileName,
        languageVersion,
        onError,
        shouldCreateNewSourceFile,
      );
    },
    fileExists: (fileName) => {
      if (
        virtualFiles.has(fileName) ||
        virtualFiles.has(path.basename(fileName))
      )
        return true;
      return real.fileExists(fileName);
    },
    readFile: (fileName) => {
      const virtual =
        virtualFiles.get(fileName) ?? virtualFiles.get(path.basename(fileName));
      if (virtual !== undefined) return virtual;
      return real.readFile(fileName);
    },
    writeFile: () => {
      // No-op — we only need diagnostics, not emitted JS.
    },
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
  };
}

/**
 * Run the static type check. Returns `{ valid: true }` when no reportable
 * diagnostic fires, or a list of `ValidationDiagnostic`s otherwise.
 */
export function validateTestAgainstRunnerAPI(code: string): ValidationResult {
  let body: string;
  try {
    body = extractTestBody(code).body;
  } catch {
    // If extraction fails outright, fall back to using the whole code as the
    // body — the TS compiler will then surface any syntax issues itself.
    body = code;
  }

  const wrapped = buildWrappedSource(body);
  const virtualFiles = new Map<string, string>([
    [TEST_VIRTUAL_NAME, wrapped],
    [RUNNER_API_VIRTUAL_NAME, getRunnerApiSource()],
  ]);

  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: false,
    noEmit: true,
    skipLibCheck: true,
    allowJs: true,
    esModuleInterop: true,
    types: [],
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  };

  const host = makeHost(virtualFiles, compilerOptions);
  const program = ts.createProgram({
    rootNames: [TEST_VIRTUAL_NAME],
    options: compilerOptions,
    host,
  });

  const diagnostics = [
    ...program.getSemanticDiagnostics(),
    ...program.getSyntacticDiagnostics(),
  ];

  const errors: ValidationDiagnostic[] = [];
  for (const diag of diagnostics) {
    if (!REPORTED_TS_CODES.has(diag.code)) continue;
    if (!diag.file || diag.file.fileName !== TEST_VIRTUAL_NAME) continue;
    const { line, character } = diag.file.getLineAndCharacterOfPosition(
      diag.start ?? 0,
    );
    errors.push({
      message: ts.flattenDiagnosticMessageText(diag.messageText, "\n"),
      line: line + 1,
      column: character + 1,
      code: diag.code,
    });
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/**
 * Format diagnostics as a message the LLM can read on its next retry turn.
 */
export function formatTSDiagnostics(errors: ValidationDiagnostic[]): string {
  if (errors.length === 0) return "";
  const lines = errors.map(
    (e) => `  - line ${e.line}, col ${e.column} [TS${e.code}]: ${e.message}`,
  );
  return [
    "The generated test code failed static API validation against the Lastest runner surface.",
    "Each error below means the test calls something the runner does not expose:",
    ...lines,
    "",
    "Only use methods and matchers documented for Playwright Page/Locator and the matcher list in the system prompt. Do NOT invent new ones.",
  ].join("\n");
}
