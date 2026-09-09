/**
 * Production wiring: clients, store and extractor from a `MigrationConfig`
 * (§2.1.1, §2.5.1, §2.4). Tests build `EngineDeps` from the testkit fakes
 * instead. Per-country `target.vaultDns` overrides get their own client
 * (§1.2 — the id map is bound to one vault, so a second DNS needs its own
 * store; v1 shares the configured store and reports the mismatch).
 */
import { resolveCountry } from "../config/resolve";
import type { MigrationConfig } from "../config/schema";
import { createExtractor } from "../extract/index";
import { getLogger } from "../logger";
import { createSfdcClient, type SfdcClientHandle } from "../sfdc/client";
import { createStateStore, type CreateStateStoreOverrides } from "../store/index";
import type { StateStore } from "../store/types";
import { createVaultClient, vaultClientConfigFrom } from "../vault/client";
import type { VaultClient } from "../vault/types";
import { GLOBAL_COUNTRY } from "../types";
import type { EngineDeps } from "./engine";

export interface WiringOptions {
  countries?: string[];
  store?: CreateStateStoreOverrides;
  runDir?: string;
  /** Skip the SFDC login (report mode). */
  offline?: boolean;
}

export interface WiredDeps extends EngineDeps {
  close(): Promise<void>;
}

export async function createEngineDeps(config: MigrationConfig, opts: WiringOptions = {}): Promise<WiredDeps> {
  const log = getLogger("Cli");
  const store: StateStore = await createStateStore(config, opts.store);
  const vaults = new Map<string, VaultClient>();
  const mainDns = config.target.vaultDns;
  vaults.set(mainDns, createVaultClient(vaultClientConfigFrom(config)));
  for (const iso of opts.countries ?? Object.keys(config.countries)) {
    if (iso === GLOBAL_COUNTRY) continue;
    const cc = resolveCountry(config, iso);
    const dns = cc.target.vaultDns ?? mainDns;
    if (vaults.has(dns)) continue;
    log.warn({ country: iso, vault_dns: dns }, "country targets another vault; the shared state store is bound to the main vault (§2.4)");
    vaults.set(dns, createVaultClient(vaultClientConfigFrom({ target: { ...config.target, ...cc.target, vaultDns: dns, auth: cc.target.auth ?? config.target.auth }, performance: config.performance })));
  }
  let sfdc: SfdcClientHandle | undefined;
  if (!opts.offline) sfdc = await createSfdcClient({ source: config.source, performance: config.performance, extract: config.extract });
  const sfdcClient = sfdc ?? offlineSfdc();
  const extractor = createExtractor({ sfdc: sfdcClient, store }, { sortChunkRows: config.performance.sortChunkRows });
  return {
    sfdc: sfdcClient,
    vaults,
    store,
    extractor,
    runDir: opts.runDir ?? config.staging?.runDir,
    async close() {
      await sfdc?.close().catch(() => undefined);
      await store.close().catch(() => undefined);
    },
  };
}

/** Placeholder client for `report` (never called). */
function offlineSfdc(): SfdcClientHandle {
  const fail = () => {
    throw new Error("SFDC client not available in offline mode");
  };
  return new Proxy({} as SfdcClientHandle, {
    get: (_t, prop) => (prop === "orgId" || prop === "apiVersion" ? "" : fail),
  });
}
