"use server";

import { revalidatePath } from "next/cache";
import * as queries from "@/lib/db/queries";
import { requireRepoCapability, requireRepoAccess } from "@/lib/auth";
import { requireTestOwnership } from "@/lib/auth/ownership";
import { renderApiDefinitionForCode } from "@/lib/api-test/redact";
import type { ApiTestDefinition } from "@/lib/db/schema";

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
 * in the live `apiDefinition` jsonb but never written to the display `code`.
 */
export async function createApiTest(input: {
  repositoryId: string;
  name: string;
  apiDefinition: ApiTestDefinition;
  functionalAreaId?: string | null;
}): Promise<{ id: string }> {
  await requireRepoCapability(input.repositoryId, "tests:write");
  const err = validateDefinition(input.apiDefinition);
  if (err) throw new Error(err);

  const created = await queries.createTest({
    repositoryId: input.repositoryId,
    name:
      input.name.trim() ||
      `${input.apiDefinition.method} ${input.apiDefinition.url}`,
    code: renderApiDefinitionForCode(input.apiDefinition),
    testType: "api",
    apiDefinition: input.apiDefinition,
    targetUrl: input.apiDefinition.url,
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
  await requireTestOwnership(id);
  const err = validateDefinition(input.apiDefinition);
  if (err) throw new Error(err);

  await queries.updateTestWithVersion(
    id,
    {
      ...(input.name ? { name: input.name.trim() } : {}),
      code: renderApiDefinitionForCode(input.apiDefinition),
      testType: "api",
      apiDefinition: input.apiDefinition,
      targetUrl: input.apiDefinition.url,
    },
    "manual_edit",
  );
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
}): Promise<import("@/lib/api-test/generator").GenerateApiTestResult> {
  await requireRepoCapability(input.repositoryId, "tests:write");
  const { generateApiTest } = await import("@/lib/api-test/generator");
  return generateApiTest(input);
}

/**
 * Run a diff-scoped validation (E6) from the UI — map a pasted diff to affected
 * tests, run just those, return the verdict.
 */
export async function validateDiffAction(input: {
  repositoryId: string;
  diff?: string;
  baseBranch?: string;
  headBranch?: string;
  wait?: boolean;
  maxWaitMs?: number;
}): Promise<import("@/server/actions/validate-diff").ValidateDiffResult> {
  await requireRepoAccess(input.repositoryId);
  const { validateDiffCore } = await import("@/server/actions/validate-diff");
  return validateDiffCore(input);
}
