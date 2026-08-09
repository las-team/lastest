import "server-only";

import type {
  ExplorerExistingAuth,
  ExplorerHost,
  ExplorerSettings,
} from "@lastest/plugin-explorer";

import * as queries from "@/lib/db/queries";
import { decryptField, encrypt, ENC_PREFIX } from "@/lib/crypto";
import {
  assertSafeOutboundUrl,
  SsrfBlockedError,
} from "@/lib/security/outbound-url";
import { findExistingAuthSetup } from "@/lib/qa-agent/auth";

/**
 * The app's fill for `ExplorerHost` — the four core APIs that do not exist
 * yet, plus one config value that should be plugin-owned and is not.
 *
 * Read `plugins/explorer/src/host.ts` for the full history. Three methods
 * that used to live here — `resolveTargetUrl`, `listCoverage` and
 * `createQuarantinedTest` — moved to real capabilities (`ctx.repos`,
 * `ctx.tests`); `emitActivity` moved to `ctx.events`, a provider plugin. What
 * remains is genuinely either a core PR still to be written, or a table that
 * should have moved and did not.
 */

export const appExplorerHost: ExplorerHost = {
  async getSettings(repositoryId: string): Promise<ExplorerSettings> {
    const settings = await queries.getAISettings(repositoryId);
    return {
      maxIterations: settings.explorerMaxIterations ?? 4,
      styleRotation: settings.explorerStyleRotation ?? null,
    };
  },

  async resolveExistingAuth(
    repositoryId: string,
  ): Promise<ExplorerExistingAuth> {
    const existing = await findExistingAuthSetup(repositoryId);
    // Only the id crosses the boundary. `storage_states.storageStateJson` never
    // leaves this process — `BrowserHost.applyAuth` resolves and injects it.
    return {
      storageStateId: existing.storageStateId,
      setupTestId: existing.setupTestId,
      defaultSetupInUse: existing.defaultSetupInUse,
    };
  },

  async assertSafeOutboundUrl(url: string): Promise<void> {
    try {
      await assertSafeOutboundUrl(url);
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        throw new Error(`URL rejected: ${err.message}`);
      }
      throw err;
    }
  },

  /**
   * AES-256-GCM, with the same two invariants the rest of the app's field
   * crypto holds: the prefix check makes encrypt-on-write idempotent, and
   * decrypt passes unrecognised plaintext straight through so rows written
   * before encryption existed still read.
   */
  encryptField(plaintext: string): string {
    return plaintext.startsWith(ENC_PREFIX) ? plaintext : encrypt(plaintext);
  },

  decryptField(stored: string): string {
    return decryptField(stored);
  },
};
