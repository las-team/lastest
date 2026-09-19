/**
 * Vault REST client (§2.5, §8.1, §8.3). `createVaultClient(config)` returns
 * the `VaultClient` contract from `./types`; the endpoint modules are also
 * exported for callers that need the helpers (VQL literals, MDL builders,
 * write headers, CSV, error classes).
 */
export * from "./types";
export * from "./errors";
export * from "./retry";
export * from "./http";
export * from "./auth";
export * from "./vql";
export * from "./metadata";
export * from "./records";
export * from "./mdl";
export * from "./users";
export * from "./client";
