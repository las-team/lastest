/**
 * `@lastest/veeva-crm-migration/vault` — Vault CRM client, mapping tables,
 * MDL generators, planner, applier and plan writer.
 */
export {
  createVaultClient,
  VaultApiError,
  normalizeVaultApiVersion,
  normalizeVaultDns,
  isMdlJobPending,
  DEFAULT_VAULT_API_VERSION,
  type VaultAuth,
  type VaultClient,
  type VaultClientOptions,
  type VaultResponse,
  type VaultError,
  type MdlResult,
  type MdlStatementExecution,
  type VaultObjectMetadata,
  type VaultObjectField,
  type VaultObjectType,
  type VaultObjectSummary,
  type VaultPageLayoutSummary,
  type FetchLike as VaultFetchLike,
} from "./client";
export * from "./mapping";
export * from "./mdl";
export {
  buildVaultPlan,
  orderSteps,
  recordIdPlaceholder,
  parsePlaceholder,
  stepGroup,
  type VaultPlanOptions,
} from "./plan";
export {
  applyVaultPlan,
  precheckStep,
  resolvePlaceholders,
  extractRecordId,
  mdlFailureMessage,
  renderApplyReport,
  type ApplyOptions,
  type Precheck,
} from "./apply";
export {
  writePlan,
  renderMdlGroup,
  renderManualChecklist,
  renderUnmapped,
  renderPlanSummary,
} from "./write";
