import { NextRequest, NextResponse } from "next/server";
import {
  verifyVercelSignature,
  isVercelWebhookEnvelope,
} from "@/lib/vercel/webhooks";
import {
  handleDeploymentCreated,
  handleDeploymentReady,
  handleCheckRerequested,
  handleConfigurationRemoved,
} from "@/lib/vercel/service";
import { markWebhookSeen } from "@/lib/integrations/webhook-guard";

export async function POST(request: NextRequest) {
  const signature = request.headers.get("x-vercel-signature");
  const rawBody = await request.text();

  // Signature is verified against the integration client secret (mandatory).
  const secret = process.env.VERCEL_INTEGRATION_CLIENT_SECRET;
  if (!secret) {
    console.error("[vercel-webhook] VERCEL_INTEGRATION_CLIENT_SECRET not set");
    return NextResponse.json(
      { error: "Webhook not configured" },
      { status: 500 },
    );
  }
  if (!verifyVercelSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let envelope: unknown;
  try {
    envelope = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!isVercelWebhookEnvelope(envelope)) {
    return NextResponse.json({ message: "Not a Vercel webhook" });
  }

  // Replay protection: Vercel sends a unique envelope id per delivery.
  if (envelope.id && !markWebhookSeen(`vercel:${envelope.id}`)) {
    return NextResponse.json({ message: "Duplicate delivery, ignored" });
  }

  const { type, payload } = envelope;

  // Never 500 on unmapped projects or unknown events — return 200 and ignore
  // so Vercel does not retry. Only signature/config problems above are errors.
  try {
    switch (type) {
      case "deployment.created": {
        const reason = await handleDeploymentCreated(payload);
        return NextResponse.json({ message: `deployment.created: ${reason}` });
      }
      case "deployment.ready": {
        const reason = await handleDeploymentReady(payload);
        return NextResponse.json({ message: `deployment.ready: ${reason}` });
      }
      case "deployment.check-rerequested": {
        const reason = await handleCheckRerequested(payload);
        return NextResponse.json({
          message: `deployment.check-rerequested: ${reason}`,
        });
      }
      case "integration-configuration.removed": {
        const reason = await handleConfigurationRemoved(payload);
        return NextResponse.json({
          message: `integration-configuration.removed: ${reason}`,
        });
      }
      default:
        return NextResponse.json({ message: `Event ignored: ${type}` });
    }
  } catch (error) {
    // Log but still 200 so a transient handler bug doesn't trigger endless
    // Vercel retries for an event we've already partially processed.
    console.error(`[vercel-webhook] handler error for ${type}:`, error);
    return NextResponse.json({ message: "Handler error, ignored" });
  }
}
