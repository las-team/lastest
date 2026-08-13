"use server";

import { revalidatePath } from "next/cache";

import { generateApiTest, type GenerateApiTestResult } from "./generator";
import type { ApiTestDefinition } from "@lastest/eb-protocol";
import { apiTestPlugin } from "./index";
import { apiTestWiring } from "./wiring";

/**
 * API tests' server actions.
 *
 * A `"use server"` module inside a `transpilePackages` workspace package
 * produces real, dispatchable action ids (spike S1), so these live in the
 * package with no codegen and no shim. Note the trap S1 also found: an
 * `export { x } from "…"` re-export inside a `"use server"` file compiles to a
 * module with *no exports at all* — every action here is declared locally for
 * that reason.
 *
 * ### Where the authorization went
 *
 * Nowhere, is the answer, and that is the interesting part. The old actions
 * opened with `requireRepoCapability(repositoryId, "tests:write")` /
 * `requireTestOwnership(id)`; those same calls now run inside
 * `src/lib/core/api-test-host.ts`, immediately before the write they guard.
 * The plugin has no way to reach `tests` except through those two methods, so
 * it cannot perform an unauthorized write by forgetting a guard — which is
 * exactly the property the old shape did *not* have. RBAC capabilities are not
 * on `PluginContext` at all, so this is also the only place they could live.
 *
 * Only `generateApiTestDefinitionAction` builds a `ctx`, because only it needs
 * `ctx.ai`. `contextFor({ repositoryId })` runs the app's `requireRepoAccess`
 * inside `resolveScope`, so an id belonging to another team is rejected before
 * a model call can be billed to it.
 */

function validateDefinition(def: ApiTestDefinition): string | null {
  if (!def || typeof def !== "object") return "API definition is required.";
  if (!def.method || !def.url) return "Method and URL are required.";
  if (!Array.isArray(def.assertions) || def.assertions.length === 0)
    return "Add at least one assertion (a status check is recommended).";
  return null;
}

/**
 * Create a headless API test (E1) from the UI. Mirrors the v1 `POST /tests`
 * branch but is callable from React via a server action. Credentials are kept
 * in the live `apiDefinition` jsonb but never written to the display `code` —
 * the host renders that column through `renderApiDefinitionForCode`, so a
 * caller cannot choose to skip the redaction.
 */
export async function createApiTest(input: {
  repositoryId: string;
  name: string;
  apiDefinition: ApiTestDefinition;
  functionalAreaId?: string | null;
}): Promise<{ id: string }> {
  const err = validateDefinition(input.apiDefinition);
  if (err) throw new Error(err);

  const { host } = apiTestWiring();
  const created = await host.createTest({
    repositoryId: input.repositoryId,
    name:
      input.name.trim() ||
      `${input.apiDefinition.method} ${input.apiDefinition.url}`,
    definition: input.apiDefinition,
    functionalAreaId: input.functionalAreaId ?? null,
  });
  revalidatePath("/tests");
  return { id: created.id };
}

/** Update an existing API test's definition from the UI. */
export async function updateApiTest(
  id: string,
  input: {
    name?: string;
    apiDefinition: ApiTestDefinition;
  },
): Promise<void> {
  const err = validateDefinition(input.apiDefinition);
  if (err) throw new Error(err);

  const { host } = apiTestWiring();
  await host.updateTest(id, {
    name: input.name,
    definition: input.apiDefinition,
  });
  revalidatePath("/tests");
  revalidatePath(`/tests/${id}`);
}

/**
 * Generate an API test definition from a natural-language prompt / OpenAPI /
 * GraphQL (E1) without persisting it — returns the definition so the dialog can
 * prefill its form for the user to review before saving.
 */
export async function generateApiTestDefinitionAction(input: {
  repositoryId: string;
  prompt?: string;
  endpoint?: string;
  openapiSpec?: string;
  graphqlSchema?: string;
}): Promise<GenerateApiTestResult> {
  const { runtime, host } = apiTestWiring();
  const ctx = await runtime.contextFor(apiTestPlugin, {
    repositoryId: input.repositoryId,
  });
  return generateApiTest({ ai: ctx.ai, host }, input);
}
