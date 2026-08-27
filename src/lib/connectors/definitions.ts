/**
 * What each connector type and auth method needs from a user.
 *
 * ONE source of truth, deliberately pure and DB-free: the form renders from it,
 * the server action validates against it, and the credential row is built from
 * it. Adding a third SUT type should mean editing this file and writing a
 * client — not editing five files and discovering the mismatch in production.
 *
 * The split between the two field lists is the security boundary of the whole
 * feature:
 *
 *   configFields     → `sut_connectors.config`, plaintext jsonb. URLs, API
 *                      versions, public client ids. Things that appear in a
 *                      support screenshot without consequence.
 *   credentialFields → `repo_credentials.fields`, `enc:v1:…` when `secret`.
 *                      Everything that grants access.
 *
 * Nothing that authenticates may be listed as a config field. The encryption,
 * masking, run-time injection and EB redaction paths all key off the credential
 * store, so a secret placed in `config` would quietly opt out of all four.
 *
 * One constraint on naming a new credential field: EB redaction is driven by
 * the field KEY, not by the `secret` flag — `defaultIsSecretKey` in
 * `packages/embedded-browser/src/credential-redaction.ts` substring-matches a
 * hint list. `consumerSecret`, `privateKey` and `idpToken` are covered by
 * "secret" / "key" / "token" respectively. A future field named something like
 * `passphrase` would NOT be, and would leak into EB output despite being
 * encrypted at rest. Check the hint list before inventing a key.
 */

import type { SutConnectorAuthMethod, SutConnectorType } from "@/lib/db/schema";

export interface ConnectorConfigField {
  key: string;
  label: string;
  placeholder?: string;
  help?: string;
  required: boolean;
  /** Rendered as a URL input and validated as one. */
  kind?: "text" | "url" | "host";
  default?: string;
}

export interface ConnectorCredentialField {
  key: string;
  label: string;
  secret: boolean;
  /** Rendered as a textarea — PEM keys are not one-liners. */
  multiline?: boolean;
  placeholder?: string;
}

export interface ConnectorAuthMethodDefinition {
  method: SutConnectorAuthMethod;
  label: string;
  description: string;
  configFields: ConnectorConfigField[];
  credentialFields: ConnectorCredentialField[];
  /** False when there is no API to call — see `sf-ui-login`. */
  verifiable: boolean;
}

export interface ConnectorTypeDefinition {
  type: SutConnectorType;
  label: string;
  description: string;
  /** Anchor id on the Integrations tab. */
  anchor: string;
  methods: ConnectorAuthMethodDefinition[];
}

/** Vault versions its API in the URL path, so this is a stored value. */
export const DEFAULT_VAULT_API_VERSION = "v25.1";
export const DEFAULT_SALESFORCE_API_VERSION = "v62.0";

/** Where a Vault OAuth/OIDC token is exchanged for a Vault session id. */
export const VAULT_OAUTH_SESSION_HOST = "https://login.veevavault.com";

const VAULT_DNS_FIELD: ConnectorConfigField = {
  key: "vaultDns",
  label: "Vault DNS",
  placeholder: "my-vault.veevavault.com",
  help: "Host only — the API base is https://{host}/api/{version}.",
  required: true,
  kind: "host",
};

const VAULT_API_VERSION_FIELD: ConnectorConfigField = {
  key: "apiVersion",
  label: "API version",
  placeholder: DEFAULT_VAULT_API_VERSION,
  help: "Vault puts the version in the path. Match the release this environment runs.",
  required: true,
  default: DEFAULT_VAULT_API_VERSION,
};

const SF_LOGIN_URL_FIELD: ConnectorConfigField = {
  key: "loginUrl",
  label: "Login URL",
  placeholder: "https://test.salesforce.com",
  help: "https://login.salesforce.com for production, https://test.salesforce.com for a sandbox, or your My Domain URL.",
  required: true,
  kind: "url",
};

const SF_API_VERSION_FIELD: ConnectorConfigField = {
  key: "apiVersion",
  label: "API version",
  placeholder: DEFAULT_SALESFORCE_API_VERSION,
  required: true,
  default: DEFAULT_SALESFORCE_API_VERSION,
};

const SF_CONSUMER_KEY_FIELD: ConnectorConfigField = {
  key: "consumerKey",
  label: "Consumer key",
  help: "The public half of the pair. The consumer secret is stored separately, encrypted.",
  required: true,
};

export const CONNECTOR_TYPES: ConnectorTypeDefinition[] = [
  {
    type: "vault",
    label: "Veeva Vault",
    description:
      "Connect a Vault org so tests can log in and coverage can profile real record volume over VQL.",
    anchor: "veeva-vault",
    methods: [
      {
        method: "vault-password",
        label: "User name and password",
        description:
          "POST /api/{version}/auth returns a session id used as the Authorization header. Sessions expire on inactivity, so each operation re-authenticates rather than caching one.",
        verifiable: true,
        configFields: [VAULT_DNS_FIELD, VAULT_API_VERSION_FIELD],
        credentialFields: [
          { key: "username", label: "User name", secret: false },
          { key: "password", label: "Password", secret: true },
        ],
      },
      {
        method: "vault-oauth",
        label: "OAuth 2.0 / OpenID Connect",
        description:
          "For SSO-only Vaults. A bearer token from your IdP is exchanged at login.veevavault.com/auth/oauth/session/{profile} for a Vault session id.",
        verifiable: true,
        configFields: [
          VAULT_DNS_FIELD,
          VAULT_API_VERSION_FIELD,
          {
            key: "oauthProfileId",
            label: "OAuth/OIDC profile id",
            help: "Configured Vault-side under Settings → OAuth 2.0 / OpenID Connect Profiles.",
            required: true,
          },
          {
            key: "oauthClientId",
            label: "Client application id",
            help: "Vault presents this to your authorization server's introspection endpoint.",
            required: false,
          },
        ],
        credentialFields: [
          {
            key: "idpToken",
            label: "IdP access token",
            secret: true,
            multiline: true,
          },
        ],
      },
    ],
  },
  {
    type: "salesforce",
    label: "Salesforce",
    description:
      "Connect a Salesforce org for release regression against Lightning, or for API-side profiling.",
    anchor: "salesforce",
    methods: [
      {
        method: "sf-ui-login",
        label: "Browser login (user name and password)",
        description:
          "What a regression test drives: the login form itself. Not an OAuth grant — External Client Apps dropped username-password entirely, so this exists for the UI path and has no API to verify against.",
        verifiable: false,
        configFields: [SF_LOGIN_URL_FIELD],
        credentialFields: [
          { key: "username", label: "User name", secret: false },
          { key: "password", label: "Password", secret: true },
        ],
      },
      {
        method: "sf-client-credentials",
        label: "OAuth client credentials",
        description:
          "Server-to-server, no user session. Exchanges the consumer key and secret at /services/oauth2/token for an access token and the org's instance URL.",
        verifiable: true,
        configFields: [
          SF_LOGIN_URL_FIELD,
          SF_API_VERSION_FIELD,
          SF_CONSUMER_KEY_FIELD,
        ],
        credentialFields: [
          { key: "consumerSecret", label: "Consumer secret", secret: true },
        ],
      },
      {
        method: "sf-jwt-bearer",
        label: "OAuth JWT bearer",
        description:
          "Signed assertion instead of a shared secret. The assertion's exp must be within 5 minutes of Salesforce server time — clock skew is the usual failure.",
        verifiable: true,
        configFields: [
          SF_LOGIN_URL_FIELD,
          SF_API_VERSION_FIELD,
          SF_CONSUMER_KEY_FIELD,
          {
            key: "jwtSubject",
            label: "Run-as user name",
            placeholder: "integration.user@example.com",
            help: "The Salesforce user the assertion acts as.",
            required: true,
          },
        ],
        credentialFields: [
          {
            key: "privateKey",
            label: "Private key (PEM)",
            secret: true,
            multiline: true,
            placeholder: "-----BEGIN PRIVATE KEY-----",
          },
        ],
      },
    ],
  },
];

export function getConnectorType(
  type: SutConnectorType,
): ConnectorTypeDefinition {
  const def = CONNECTOR_TYPES.find((t) => t.type === type);
  if (!def) throw new Error(`Unknown connector type: ${type}`);
  return def;
}

export function getAuthMethod(
  type: SutConnectorType,
  method: SutConnectorAuthMethod,
): ConnectorAuthMethodDefinition {
  const def = getConnectorType(type).methods.find((m) => m.method === method);
  if (!def) {
    throw new Error(`Auth method ${method} is not valid for ${type}`);
  }
  return def;
}

/**
 * Validate a submitted config against its method and return only the fields
 * that method declares.
 *
 * Filtering rather than passing the object through is the point: a client that
 * posts an extra `password` key must not get it written into plaintext jsonb.
 */
export function normalizeConnectorConfig(
  type: SutConnectorType,
  method: SutConnectorAuthMethod,
  input: Record<string, unknown>,
): Record<string, string> {
  const def = getAuthMethod(type, method);
  const out: Record<string, string> = {};
  for (const field of def.configFields) {
    const raw = input[field.key];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) {
      if (field.required && !field.default) {
        throw new Error(`${field.label} is required`);
      }
      if (field.default) out[field.key] = field.default;
      continue;
    }
    if (field.kind === "url" && !/^https:\/\//i.test(value)) {
      throw new Error(`${field.label} must be an https URL`);
    }
    if (field.kind === "host" && /[/:\s]/.test(value)) {
      throw new Error(
        `${field.label} must be a host name only, with no scheme or path`,
      );
    }
    out[field.key] = value;
  }
  return out;
}
