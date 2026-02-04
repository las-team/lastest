import type { SetupScript, SetupConfig, SetupContext, SetupResult, ApiScriptDefinition, SetupAuthConfig } from './types';

/**
 * Run an API-based setup script.
 * Executes HTTP requests to seed data in the target application.
 */
export async function runApiSetup(
  config: SetupConfig,
  script: SetupScript,
  context: SetupContext
): Promise<SetupResult> {
  const startTime = Date.now();

  try {
    if (script.type !== 'api') {
      return {
        success: false,
        error: `Expected api script but got ${script.type}`,
        duration: Date.now() - startTime,
      };
    }

    // Parse the API script definition from the code field
    let apiDef: ApiScriptDefinition;
    try {
      apiDef = JSON.parse(script.code);
    } catch {
      return {
        success: false,
        error: 'Invalid API script format - expected JSON',
        duration: Date.now() - startTime,
      };
    }

    // Build the full URL
    const url = `${config.baseUrl}${apiDef.endpoint}`;

    // Build headers with auth
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...apiDef.headers,
    };

    // Apply auth configuration
    applyAuth(headers, config.authType, config.authConfig);

    // Interpolate variables in body
    const body = apiDef.body ? interpolateVariables(apiDef.body, context.variables) : undefined;

    // Make the request
    const response = await fetch(url, {
      method: apiDef.method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `API request failed: ${response.status} ${response.statusText} - ${errorText}`,
        duration: Date.now() - startTime,
      };
    }

    // Parse response
    let responseData: unknown;
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      responseData = await response.json();
    } else {
      responseData = await response.text();
    }

    // Extract variables from response
    const extractedVariables: Record<string, unknown> = {};
    if (apiDef.extractVariables && typeof responseData === 'object' && responseData !== null) {
      for (const [varName, path] of Object.entries(apiDef.extractVariables)) {
        extractedVariables[varName] = getValueByPath(responseData, path);
      }
    }

    return {
      success: true,
      variables: extractedVariables,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Apply authentication headers based on config
 */
function applyAuth(
  headers: Record<string, string>,
  authType: string,
  authConfig: SetupAuthConfig | null
): void {
  if (!authConfig) return;

  switch (authType) {
    case 'bearer':
      if (authConfig.token) {
        headers['Authorization'] = `Bearer ${authConfig.token}`;
      }
      break;
    case 'basic':
      if (authConfig.username && authConfig.password) {
        const credentials = Buffer.from(`${authConfig.username}:${authConfig.password}`).toString('base64');
        headers['Authorization'] = `Basic ${credentials}`;
      }
      break;
    case 'custom':
      if (authConfig.headers) {
        Object.assign(headers, authConfig.headers);
      }
      break;
    // 'none' - no auth needed
  }
}

/**
 * Get a value from an object using dot notation path
 * Supports both dot notation (response.data.id) and array access (response.users.0.id)
 */
function getValueByPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Interpolate variables in an object using {{variableName}} syntax
 * Also supports faker placeholders like {{faker.email}}
 */
function interpolateVariables(
  data: unknown,
  variables: Record<string, unknown>
): unknown {
  if (typeof data === 'string') {
    return data.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
      const trimmedKey = key.trim();

      // Handle faker placeholders
      if (trimmedKey.startsWith('faker.')) {
        return generateFakerValue(trimmedKey.slice(6));
      }

      // Handle context variables
      if (trimmedKey in variables) {
        const value = variables[trimmedKey];
        return typeof value === 'string' ? value : JSON.stringify(value);
      }

      // Return original if not found
      return match;
    });
  }

  if (Array.isArray(data)) {
    return data.map(item => interpolateVariables(item, variables));
  }

  if (typeof data === 'object' && data !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = interpolateVariables(value, variables);
    }
    return result;
  }

  return data;
}

/**
 * Generate simple faker-like values
 * Supports: email, uuid, name, firstName, lastName, number, timestamp
 */
function generateFakerValue(type: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);

  switch (type) {
    case 'email':
      return `test-${random}@example.com`;
    case 'uuid':
      return crypto.randomUUID();
    case 'name':
      return `Test User ${random}`;
    case 'firstName':
      return `Test${random.substring(0, 4)}`;
    case 'lastName':
      return `User${random.substring(0, 4)}`;
    case 'number':
      return Math.floor(Math.random() * 10000).toString();
    case 'timestamp':
      return timestamp.toString();
    case 'isoDate':
      return new Date().toISOString();
    default:
      return random;
  }
}

/**
 * Validate an API script definition
 */
export function validateApiScript(code: string): { valid: boolean; error?: string } {
  try {
    const parsed = JSON.parse(code);

    if (!parsed.method) {
      return { valid: false, error: 'Missing required field: method' };
    }
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(parsed.method)) {
      return { valid: false, error: `Invalid method: ${parsed.method}` };
    }
    if (!parsed.endpoint) {
      return { valid: false, error: 'Missing required field: endpoint' };
    }
    if (typeof parsed.endpoint !== 'string') {
      return { valid: false, error: 'endpoint must be a string' };
    }
    if (!parsed.endpoint.startsWith('/')) {
      return { valid: false, error: 'endpoint must start with /' };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid JSON format' };
  }
}
