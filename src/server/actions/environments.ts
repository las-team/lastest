"use server";

/**
 * Server actions for `environments` — Settings → Environments.
 *
 * The environment is the object a validation lead actually works in: "UAT is on
 * 26R2, PROD is on 26R1, here is what changed". Everything else in this feature
 * hangs off it — connectors, credentials, variables and baselines are all
 * scoped by it.
 *
 * Gated on `repos:settings` for both read and write, same as credentials:
 * environments carry base URLs and own the promotion of approved baselines, so
 * they are not viewer-visible configuration.
 */

import { revalidatePath } from "next/cache";
import * as queries from "@/lib/db/queries";
import { requireRepoCapability } from "@/lib/auth/capabilities";
import type { Environment, EnvironmentVariable } from "@/lib/db/schema";
import type { PromotionOutcome } from "@/lib/db/queries/environments";

/** `environments.key`, which is what lands on every baseline this env owns. */
const KEY_RE = /^[a-z][a-z0-9-]*$/;
/** Variable keys are substituted into test code, so: identifier-shaped. */
const VAR_KEY_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

export interface EnvironmentInput {
  key: string;
  label: string;
  description?: string | null;
  baseUrl?: string | null;
  releaseLabel?: string | null;
  isDefault?: boolean;
}

function validate(input: EnvironmentInput): void {
  if (!input.label.trim()) throw new Error("Label is required");
  if (!KEY_RE.test(input.key)) {
    throw new Error(
      "Key must start with a lowercase letter and contain only lowercase letters, digits and hyphens (e.g. uat, prerelease-26r2)",
    );
  }
  if (input.baseUrl && !/^https?:\/\//i.test(input.baseUrl)) {
    throw new Error("Base URL must start with http:// or https://");
  }
}

async function guardEnvironment(id: string): Promise<Environment> {
  const env = await queries.getEnvironment(id);
  if (!env) throw new Error("Forbidden: Environment not found");
  await requireRepoCapability(env.repositoryId, "repos:settings");
  return env;
}

function refresh() {
  revalidatePath("/settings");
  revalidatePath("/setup");
}

export async function getEnvironments(
  repositoryId: string,
): Promise<Environment[]> {
  await requireRepoCapability(repositoryId, "repos:settings");
  return queries.listEnvironments(repositoryId);
}

export async function createEnvironment(
  repositoryId: string,
  input: EnvironmentInput,
): Promise<{ id: string }> {
  const session = await requireRepoCapability(repositoryId, "repos:settings");
  validate(input);
  const existing = await queries.getEnvironmentByKey(repositoryId, input.key);
  if (existing) {
    throw new Error(`An environment with key "${input.key}" already exists`);
  }
  // The first environment becomes the default whether or not the form asked:
  // a repo with environments but no default would silently run unscoped.
  const current = await queries.listEnvironments(repositoryId);
  const result = await queries.createEnvironment({
    repositoryId,
    key: input.key,
    label: input.label.trim(),
    description: input.description ?? null,
    baseUrl: input.baseUrl?.trim() || null,
    releaseLabel: input.releaseLabel?.trim() || null,
    isDefault: input.isDefault || current.length === 0,
    sortOrder: current.length,
    createdBy: session.user.id,
  });
  refresh();
  return result;
}

export async function updateEnvironment(
  id: string,
  input: Omit<EnvironmentInput, "key" | "isDefault">,
): Promise<{ success: true }> {
  const env = await guardEnvironment(id);
  // `key` is immutable by design — it is stored on every baseline this
  // environment owns, so a rename would orphan every approval.
  validate({ ...input, key: env.key });
  await queries.updateEnvironment(id, {
    label: input.label.trim(),
    description: input.description ?? null,
    baseUrl: input.baseUrl?.trim() || null,
    releaseLabel: input.releaseLabel?.trim() || null,
  });
  refresh();
  return { success: true };
}

export async function setDefaultEnvironment(
  id: string,
): Promise<{ success: true }> {
  const env = await guardEnvironment(id);
  await queries.setDefaultEnvironment(env.repositoryId, id);
  refresh();
  return { success: true };
}

export async function deleteEnvironment(
  id: string,
): Promise<{ success: true }> {
  await guardEnvironment(id);
  await queries.deleteEnvironment(id);
  refresh();
  return { success: true };
}

/**
 * Mark a sandbox as refreshed.
 *
 * Baselines are untouched — see `recordEnvironmentRefresh`. What this buys is a
 * timestamp Review can point at when a refresh produces a wave of diffs, so a
 * reviewer is not left deciding whether the vendor broke something.
 */
export async function recordEnvironmentRefresh(
  id: string,
  note?: string,
): Promise<{ success: true }> {
  await guardEnvironment(id);
  await queries.recordEnvironmentRefresh(id, note?.trim() || null);
  refresh();
  revalidatePath("/review");
  return { success: true };
}

/**
 * Promote one environment's approved baselines onto another.
 *
 * `fromKey` may be null, meaning the repo's unscoped baselines — that is how an
 * existing repo moves its history into its first named environment.
 */
export async function promoteBaselines(
  repositoryId: string,
  fromKey: string | null,
  toKey: string,
): Promise<PromotionOutcome> {
  const session = await requireRepoCapability(repositoryId, "repos:settings");
  const target = await queries.getEnvironmentByKey(repositoryId, toKey);
  if (!target) throw new Error("Target environment not found");
  if (fromKey) {
    const source = await queries.getEnvironmentByKey(repositoryId, fromKey);
    if (!source) throw new Error("Source environment not found");
  }
  const outcome = await queries.promoteBaselines(repositoryId, fromKey, toKey, {
    promotedBy: session.user.id,
  });
  refresh();
  revalidatePath("/review");
  return outcome;
}

// ── Variables ───────────────────────────────────────────────────────────────

export async function getEnvironmentVariables(
  environmentId: string,
): Promise<EnvironmentVariable[]> {
  await guardEnvironment(environmentId);
  return queries.listEnvironmentVariables(environmentId);
}

/**
 * Set a non-secret per-environment value.
 *
 * This is where a Vault document id belongs: a sandbox refresh changes it, and
 * a test that reads `{{env.docId}}` is re-pointed by editing one row instead of
 * every test body. Secrets do not go here — they have no encryption on this
 * table and would not be redacted from EB output.
 */
export async function setEnvironmentVariable(
  environmentId: string,
  key: string,
  value: string,
  description?: string | null,
): Promise<{ success: true }> {
  await guardEnvironment(environmentId);
  if (!VAR_KEY_RE.test(key)) {
    throw new Error(
      `"${key}" is not a valid variable name — use letters, digits and underscores, starting with a letter`,
    );
  }
  await queries.upsertEnvironmentVariable({
    environmentId,
    key,
    value,
    description: description ?? null,
  });
  refresh();
  return { success: true };
}

export async function deleteEnvironmentVariable(
  environmentId: string,
  id: string,
): Promise<{ success: true }> {
  await guardEnvironment(environmentId);
  await queries.deleteEnvironmentVariable(id);
  refresh();
  return { success: true };
}
