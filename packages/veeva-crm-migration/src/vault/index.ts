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
  type VaultRequest,
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
  selectCustomerMessages,
  customerMessageReason,
  settingsMessagePointers,
  type VaultPlanOptions,
  type CustomerMessages,
} from "./plan";
export {
  applyVaultPlan,
  precheckStep,
  resolvePlaceholders,
  extractRecordId,
  mdlFailureMessage,
  recordFailureMessage,
  mdlTarget,
  isNotFoundError,
  vqlString,
  renderApplyReport,
  type ApplyOptions,
  type Precheck,
  type MdlTarget,
} from "./apply";
export {
  writePlan,
  renderMdlGroup,
  renderManualChecklist,
  renderUnmapped,
  renderPlanSummary,
  renderTranslationsCsv,
  translationFileName,
  MDL_FILE_HEADER,
  TRANSLATION_CSV_COLUMNS,
} from "./write";
