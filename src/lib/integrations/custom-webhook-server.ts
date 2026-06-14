import "server-only";
import {
  assertSafeOutboundUrl,
  SsrfBlockedError,
} from "@/lib/security/outbound-url";
import {
  buildWebhookPayload,
  type CustomWebhookConfig,
  type CustomWebhookNotification,
  type CustomWebhookPayload,
} from "@/lib/integrations/custom-webhook";

/**
 * Send build completion notification to custom webhook
 */
export async function sendCustomWebhookNotification(
  config: CustomWebhookConfig,
  notification: CustomWebhookNotification,
): Promise<{ success: boolean; error?: string }> {
  const payload = buildWebhookPayload(notification);

  try {
    // SSRF guard: a user-configured webhook URL must not target internal hosts.
    await assertSafeOutboundUrl(config.url);
    const response = await fetch(config.url, {
      method: config.method,
      // Do not chase redirects to a (possibly internal) Location.
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        ...config.headers,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        success: false,
        error: `Webhook failed: ${response.status} ${text.slice(0, 500)}`,
      };
    }

    return { success: true };
  } catch (error) {
    if (error instanceof SsrfBlockedError) {
      return {
        success: false,
        error:
          "Webhook URL points to a private or internal address and was blocked.",
      };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error sending webhook",
    };
  }
}

/**
 * Test custom webhook with a test payload
 */
export async function testCustomWebhook(
  config: CustomWebhookConfig,
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const testPayload: CustomWebhookPayload = {
    event: "build.completed",
    buildId: "test-webhook-verification",
    status: "safe",
    totalTests: 1,
    passedCount: 1,
    failedCount: 0,
    changesDetected: 0,
    flakyCount: 0,
    gitBranch: "test",
    gitCommit: "test123",
    buildUrl: "https://example.com/test",
    timestamp: new Date().toISOString(),
  };

  try {
    // SSRF guard: block test requests aimed at internal/metadata hosts. Without
    // this, the reflected status + body below is a near-full SSRF read oracle.
    await assertSafeOutboundUrl(config.url);
    const response = await fetch(config.url, {
      method: config.method,
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        ...config.headers,
      },
      body: JSON.stringify(testPayload),
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        success: false,
        statusCode: response.status,
        error: text.slice(0, 500),
      };
    }

    return { success: true, statusCode: response.status };
  } catch (error) {
    if (error instanceof SsrfBlockedError) {
      return {
        success: false,
        error:
          "Webhook URL points to a private or internal address and was blocked.",
      };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error testing webhook",
    };
  }
}
