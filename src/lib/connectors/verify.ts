import "server-only";

import type { SutConnector, VaultConnectorConfig } from "@/lib/db/schema";
import type { SalesforceConnectorConfig } from "@/lib/db/schema";
import { getAuthMethod } from "./definitions";
import { verifyVaultOAuth, verifyVaultPassword } from "./vault-client";
import type { VerifyResult } from "./vault-client";
import {
  verifySalesforceClientCredentials,
  verifySalesforceJwtBearer,
} from "./salesforce-client";

export interface ConnectorVerifyResult extends VerifyResult {
  /** Config the exchange discovered and that should be written back. */
  configPatch?: Record<string, string>;
}

/**
 * Run the live check for one connector.
 *
 * Never throws: a verification failure is a value the card renders, not an
 * exception the settings page has to survive. And never returns a green result
 * for a method with nothing to check — `sf-ui-login` has no API, and a fake
 * tick on a credential nobody has exercised is worse than no tick at all.
 */
export async function verifyConnectorConnection(
  connector: SutConnector,
  secrets: Record<string, string>,
): Promise<ConnectorVerifyResult> {
  const def = getAuthMethod(connector.type, connector.authMethod);
  if (!def.verifiable) {
    return {
      ok: false,
      error:
        "This connector is used by browser tests only — there is no API to check. Run a test to confirm the login works.",
    };
  }

  switch (connector.authMethod) {
    case "vault-password":
      return verifyVaultPassword(
        connector.config as VaultConnectorConfig,
        secrets,
      );
    case "vault-oauth":
      return verifyVaultOAuth(
        connector.config as VaultConnectorConfig,
        secrets,
      );
    case "sf-client-credentials": {
      const res = await verifySalesforceClientCredentials(
        connector.config as SalesforceConnectorConfig,
        secrets,
      );
      return withInstanceUrl(res);
    }
    case "sf-jwt-bearer": {
      const res = await verifySalesforceJwtBearer(
        connector.config as SalesforceConnectorConfig,
        secrets,
      );
      return withInstanceUrl(res);
    }
    default:
      return { ok: false, error: "This connector cannot be verified" };
  }
}

/** Salesforce reports the org's API host at token time — persist it. */
function withInstanceUrl(res: {
  ok: boolean;
  error?: string;
  detail?: string;
  instanceUrl?: string;
}): ConnectorVerifyResult {
  return {
    ok: res.ok,
    error: res.error,
    detail: res.detail,
    configPatch: res.instanceUrl ? { instanceUrl: res.instanceUrl } : undefined,
  };
}
