/**
 * Run an auth-setup test in a sandboxed Embedded Browser pod, then capture the
 * resulting storageState and persist it via createStorageState so the QuickStart
 * walkthrough test can re-use it via setupOverrides.extraSteps.
 *
 * SECURITY: the auth-setup code is AI/user-derived arbitrary Playwright code.
 * It is executed in a disposable runner/EB pod via executeSetupViaRunner — never
 * eval'd in the host process (which holds DATABASE_URL / STRIPE_* / SYSTEM_EB_TOKEN).
 */

import * as queries from "@/lib/db/queries";
import { executeSetupViaRunner } from "@/lib/execution/executor";
import {
  claimOrProvisionPoolEB,
  releasePoolEB,
} from "@/server/actions/embedded-sessions";

export interface CaptureStorageStateInput {
  repositoryId: string;
  baseUrl: string;
  /** Rendered auth-setup test code (output of renderAuthSetupCode). */
  testCode: string;
  /** Display name for the persisted storage state. */
  name: string;
  /** Hard cap so a stuck signup can't burn the agent. Default 90s. */
  timeoutMs?: number;
}

export interface CaptureStorageStateResult {
  captured: boolean;
  storageStateId?: string;
  failureReason?: string;
  durationMs: number;
}

export async function captureStorageState(
  input: CaptureStorageStateInput,
): Promise<CaptureStorageStateResult> {
  const start = Date.now();

  let runnerId: string | null = null;
  try {
    const poolEB = await claimOrProvisionPoolEB({ purpose: "interactive" });
    runnerId = poolEB?.runnerId ?? null;
  } catch {
    runnerId = null;
  }

  if (!runnerId) {
    return {
      captured: false,
      failureReason: "All browsers are busy. Please try again later.",
      durationMs: Date.now() - start,
    };
  }

  try {
    const result = await executeSetupViaRunner(
      input.testCode,
      `quickstart-auth-${input.repositoryId}`,
      runnerId,
      input.baseUrl,
      undefined,
      input.timeoutMs ?? 90_000,
      null,
    );

    const storageStateJson = result.storageStateJson;
    if (!storageStateJson) {
      return {
        captured: false,
        failureReason:
          "Auth-setup completed but no storage state was returned from the browser.",
        durationMs: Date.now() - start,
      };
    }

    let cookieCount = 0;
    try {
      const parsed = JSON.parse(storageStateJson);
      cookieCount = Array.isArray(parsed.cookies) ? parsed.cookies.length : 0;
    } catch {
      /* ignore parse failures — persisted as-is */
    }

    if (cookieCount === 0) {
      return {
        captured: false,
        failureReason:
          "Auth-setup completed but captured 0 cookies — storage state would not authenticate the walkthrough. Likely the script navigated off the auth URL without actually signing in.",
        durationMs: Date.now() - start,
      };
    }

    const persisted = await queries.createStorageState({
      repositoryId: input.repositoryId,
      name: input.name,
      storageStateJson,
    });

    return {
      captured: true,
      storageStateId: persisted.id,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      captured: false,
      failureReason: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  } finally {
    await releasePoolEB(runnerId).catch(() => {});
  }
}
