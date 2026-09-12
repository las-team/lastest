import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MemoryStateStore } from "../testkit/memory-store";
import { CONTRACT_VAULT_DNS, stateStoreContract } from "./contract";
import { FileStateStore } from "./file";

stateStoreContract(
  "memory",
  async () => new MemoryStateStore(CONTRACT_VAULT_DNS),
);

const dirs = new Map<FileStateStore, string>();
stateStoreContract(
  "file",
  async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "veeva-store-"));
    const store = await FileStateStore.open({
      dir,
      vaultDns: CONTRACT_VAULT_DNS,
      compactEvery: 7,
    });
    dirs.set(store, dir);
    return store;
  },
  {
    cleanup: async (store) => {
      await store.close();
      const dir = dirs.get(store as FileStateStore);
      if (dir) await rm(dir, { recursive: true, force: true });
    },
  },
);
