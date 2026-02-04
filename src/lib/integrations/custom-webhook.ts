import type { BuildStatus } from '@/lib/db/schema';

export interface CustomWebhookConfig {
  url: string;
  method: 'POST' | 'PUT';
  headers?: Record<string, string>;
}

export interface CustomWebhookNotification {
  buildId: string;
  status: BuildStatus;
  totalTests: number;
  passedCount: number;
  changesDetected: number;
  flakyCount: number;
  failedCount: number;
  gitBranch: string;
  gitCommit: string;
  buildUrl: string;
}

export interface CustomWebhookPayload {
  event: 'build.completed';
  buildId: string;
  status: 'safe' | 'needs_review' | 'blocked';
  totalTests: number;
  passedCount: number;
  failedCount: number;
  changesDetected: number;
  flakyCount: number;
  gitBranch: string;
  gitCommit: string;
  buildUrl: string;
  timestamp: string;
}

function mapStatusToPayload(status: BuildStatus): 'safe' | 'needs_review' | 'blocked' {
  switch (status) {
    case 'safe_to_merge':
      return 'safe';
    case 'review_required':
      return 'needs_review';
    case 'blocked':
      return 'blocked';
    default:
      return 'needs_review';
  }
}

/**
 * Build the payload for custom webhook
 */
export function buildWebhookPayload(notification: CustomWebhookNotification): CustomWebhookPayload {
  return {
    event: 'build.completed',
    buildId: notification.buildId,
    status: mapStatusToPayload(notification.status),
    totalTests: notification.totalTests,
    passedCount: notification.passedCount,
    failedCount: notification.failedCount,
    changesDetected: notification.changesDetected,
    flakyCount: notification.flakyCount,
    gitBranch: notification.gitBranch,
    gitCommit: notification.gitCommit,
    buildUrl: notification.buildUrl,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get a sample payload for UI preview
 */
export function getPayloadPreview(): CustomWebhookPayload {
  return {
    event: 'build.completed',
    buildId: 'abc123-def456',
    status: 'safe',
    totalTests: 10,
    passedCount: 8,
    failedCount: 1,
    changesDetected: 1,
    flakyCount: 0,
    gitBranch: 'main',
    gitCommit: 'abc123',
    buildUrl: 'https://example.com/builds/abc123-def456',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Send build completion notification to custom webhook
 */
export async function sendCustomWebhookNotification(
  config: CustomWebhookConfig,
  notification: CustomWebhookNotification
): Promise<{ success: boolean; error?: string }> {
  const payload = buildWebhookPayload(notification);

  try {
    const response = await fetch(config.url, {
      method: config.method,
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `Webhook failed: ${response.status} ${text}` };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error sending webhook',
    };
  }
}

/**
 * Test custom webhook with a test payload
 */
export async function testCustomWebhook(
  config: CustomWebhookConfig
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const testPayload: CustomWebhookPayload = {
    event: 'build.completed',
    buildId: 'test-webhook-verification',
    status: 'safe',
    totalTests: 1,
    passedCount: 1,
    failedCount: 0,
    changesDetected: 0,
    flakyCount: 0,
    gitBranch: 'test',
    gitCommit: 'test123',
    buildUrl: 'https://example.com/test',
    timestamp: new Date().toISOString(),
  };

  try {
    const response = await fetch(config.url, {
      method: config.method,
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
      },
      body: JSON.stringify(testPayload),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, statusCode: response.status, error: text };
    }

    return { success: true, statusCode: response.status };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error testing webhook',
    };
  }
}
