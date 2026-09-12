/**
 * Shared helpers for the extract tests (not a test file).
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ResolvedTarget } from "../preflight/types";
import { buildVaultMetadata, resolveMetadata } from "../testkit";
import type { ObjectKey, SfdcObjectDescribe } from "../types";

export const NOW = new Date("2026-09-09T12:00:00Z");

export async function tmpRunDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "vm-extract-"));
}

export async function cleanup(dir: string | undefined): Promise<void> {
  if (dir) await rm(dir, { recursive: true, force: true });
}

/** Minimal `ResolvedTarget` around an SFDC describe (Vault side is irrelevant for extract). */
export function makeTarget(
  objectKey: ObjectKey,
  describe: SfdcObjectDescribe | undefined,
  opts: {
    replicateable?: boolean;
    columns?: string[];
    targetObject?: string;
  } = {},
): ResolvedTarget {
  const targetObject = opts.targetObject ?? `${objectKey}__v`;
  const raw = buildVaultMetadata(targetObject, []);
  return {
    objectKey,
    targetObject,
    legacyIdField: "legacy_crm_id__v",
    metadata: resolveMetadata(raw),
    rawMetadata: raw,
    objectTypes: [],
    picklists: {},
    describe,
    replicateable: opts.replicateable ?? describe?.replicateable ?? true,
    columns: opts.columns ?? [],
  };
}
