/**
 * AI generator for API tests (E1). Produces an ApiTestDefinition from a natural
 * language prompt and/or an OpenAPI spec, grounded in the repo's detected API
 * layer (REST/GraphQL/tRPC) via codebase intelligence when available.
 *
 * ### What the migration changed here
 *
 * The model call is `ctx.ai.generate()` — a capability, so the provider API key
 * and the spend attribution stay in core and never enter this package
 * (`core-scope.md` §4). What used to be four app imports
 * (`generateWithAI` + `aiConfigFromSettings` + `queries.getAISettings` +
 * `parseAiJson`) is now one capability call plus `@lastest/ai-kit`, which is
 * where the JSON-repair half of the old `@/lib/ai` went precisely because it
 * carries no secret.
 *
 * Two questions the capability cannot answer stayed as host methods, and both
 * are reads rather than boundaries: whether the configured provider can be held
 * to JSON at all, and what the repo's API layer looks like. See `host.ts`.
 */

import { parseAiJson } from "@lastest/ai-kit";
import type { ApiTestDefinition, ApiAssertion } from "@lastest/eb-protocol";

import type { ApiTestHost } from "./host";

/** The slice of `ctx.ai` this module needs. */
export interface GeneratorAi {
  generate(
    prompt: string,
    opts: {
      actionType: string;
      repositoryId?: string;
      systemPrompt?: string;
      json?: boolean;
    },
  ): Promise<{ text: string }>;
}

export interface GenerateApiTestInput {
  repositoryId: string;
  prompt?: string;
  /** Raw OpenAPI / Swagger JSON (already fetched), included as context. */
  openapiSpec?: string;
  /** Raw GraphQL SDL, included as context. */
  graphqlSchema?: string;
  /** A specific endpoint to focus on, e.g. "POST /api/users". */
  endpoint?: string;
}

export interface GenerateApiTestResult {
  status: "generated" | "ai_unavailable" | "no_definition";
  summary: string;
  definition?: ApiTestDefinition;
}

const SYSTEM_PROMPT = `You author backend API tests. Given a description (and optionally an OpenAPI/GraphQL schema), produce ONE runnable HTTP request plus response assertions.

Respond with ONLY a JSON object (no markdown fencing) matching this shape:
{
  "method": "GET|POST|PUT|PATCH|DELETE",
  "url": "/api/path or absolute https URL",
  "headers": { "<name>": "<value>" },
  "query": { "<name>": "<value>" },
  "body": <json body or omit>,
  "assertions": [
    { "kind": "status", "in": [200, 201] },
    { "kind": "jsonPath", "path": "data.id", "description": "id present" },
    { "kind": "jsonSchema", "schema": { "type": "object" } },
    { "kind": "header", "header": "content-type", "value": "application/json" },
    { "kind": "bodyContains", "value": "ok" },
    { "kind": "latencyMs", "maxMs": 2000 }
  ]
}
Prefer relative urls (the runner prepends the repo baseUrl). Always include at least a status assertion.`;

const VALID_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export async function generateApiTest(
  deps: { ai: GeneratorAi; host: ApiTestHost },
  input: GenerateApiTestInput,
): Promise<GenerateApiTestResult> {
  const { repositoryId } = input;
  const { ai, host } = deps;

  if (!(await host.aiSupportsJson(repositoryId))) {
    return {
      status: "ai_unavailable",
      summary:
        "API test generation requires a JSON-capable AI provider (not claude-cli).",
    };
  }

  // Best-effort repo context: detected API layer for GitHub-connected repos.
  // The host swallows its own failures — a missing hint degrades the prompt,
  // it does not fail the request.
  const apiLayerHint = (await host.apiLayerHint(repositoryId)) ?? "";

  const contextParts = [
    apiLayerHint,
    input.endpoint ? `Focus endpoint: ${input.endpoint}` : "",
    input.openapiSpec
      ? `OpenAPI spec:\n${input.openapiSpec.slice(0, 6000)}`
      : "",
    input.graphqlSchema
      ? `GraphQL schema:\n${input.graphqlSchema.slice(0, 6000)}`
      : "",
  ].filter(Boolean);

  const prompt = `Generate an API test.

${input.prompt ?? "Write a sensible happy-path test for the endpoint described in the context."}

${contextParts.join("\n\n")}`;

  let response: string;
  try {
    const result = await ai.generate(prompt, {
      actionType: "create_test",
      repositoryId,
      systemPrompt: SYSTEM_PROMPT,
      json: true,
    });
    response = result.text;
  } catch (e) {
    return {
      status: "ai_unavailable",
      summary: `AI call failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const isShape = (
    v: unknown,
  ): v is { method?: unknown; url?: unknown; assertions?: unknown } =>
    typeof v === "object" && v !== null;
  const parsed = parseAiJson(response, isShape, {
    source: "generate_api_test",
  });
  if (
    !parsed ||
    typeof parsed.method !== "string" ||
    typeof parsed.url !== "string"
  ) {
    return {
      status: "no_definition",
      summary: "The model did not return a valid API test definition.",
    };
  }
  const method = parsed.method.toUpperCase();
  if (!VALID_METHODS.includes(method)) {
    return {
      status: "no_definition",
      summary: `Invalid HTTP method: ${parsed.method}`,
    };
  }

  const rawAssertions = Array.isArray(parsed.assertions)
    ? parsed.assertions
    : [];
  const assertions = rawAssertions.filter(
    (a): a is ApiAssertion =>
      typeof a === "object" &&
      a !== null &&
      typeof (a as { kind?: unknown }).kind === "string",
  );
  if (assertions.length === 0) {
    assertions.push({ kind: "status", in: [200, 201, 204] });
  }

  const p = parsed as Record<string, unknown>;
  const definition: ApiTestDefinition = {
    method: method as ApiTestDefinition["method"],
    url: parsed.url,
    headers:
      typeof p.headers === "object" && p.headers !== null
        ? (p.headers as Record<string, string>)
        : undefined,
    query:
      typeof p.query === "object" && p.query !== null
        ? (p.query as Record<string, string>)
        : undefined,
    body: p.body,
    assertions,
  };

  return {
    status: "generated",
    summary: `Generated ${definition.method} ${definition.url} with ${assertions.length} assertion(s).`,
    definition,
  };
}
