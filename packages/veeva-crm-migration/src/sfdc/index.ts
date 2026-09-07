/**
 * Salesforce (Veeva CRM) extraction: client + extractor + query builders.
 */
export {
  createSfdcClient,
  SfdcApiError,
  buildJwtAssertion,
  parseLimitInfo,
  normalizeApiVersion,
  DEFAULT_API_VERSION,
  type SfdcAuth,
  type SfdcClient,
  type SfdcClientOptions,
  type FetchLike,
  type ApiUsage,
} from "./client";
export {
  extractOrgSnapshot,
  decideObjectSet,
  buildFieldConfig,
  decodeDescribeLayout,
  decodeLayoutMetadata,
  decodeProfileMetadata,
  splitLayoutFullName,
  normalizeTabVisibility,
  resolveUserCountry,
  dropSelectColumn,
  isStandardProfileName,
  type ExtractOptions,
} from "./extract";
export * from "./queries";
export * from "./countries";
export type * from "./api-types";
