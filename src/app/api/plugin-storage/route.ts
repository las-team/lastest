import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

import { STORAGE_ROOT } from "@/lib/storage/paths";
import { verifyStorageGrant } from "@/lib/core/storage-grant";

/**
 * Serves a `core/storage` blob against a signed grant — no session, no
 * cookies. `signedUrl()` mints the grant; this route is the only thing that
 * accepts it. Mirrors the EB stream proxy's shape: the URL carries a
 * capability for one object that expires with it, not a credential.
 *
 * The grant's `k` field is already the fully namespaced
 * `<teamId>/<pluginId>/<key>` path — nothing here re-derives or trusts a
 * caller-supplied path, which is what keeps this from becoming a directory
 * traversal endpoint with extra steps.
 */
export async function GET(request: NextRequest) {
  const grant = request.nextUrl.searchParams.get("grant");
  if (!grant) {
    return NextResponse.json({ error: "Missing grant" }, { status: 400 });
  }

  const payload = verifyStorageGrant(grant);
  if (!payload) {
    return NextResponse.json(
      { error: "Invalid or expired grant" },
      { status: 403 },
    );
  }

  const target = path.join(STORAGE_ROOT, "plugin-data", payload.k);
  const metaTarget = `${target}.meta.json`;

  let contentType = "application/octet-stream";
  try {
    const meta = JSON.parse(await fs.readFile(metaTarget, "utf8")) as {
      contentType?: string;
    };
    contentType = meta.contentType ?? contentType;
  } catch {
    // No metadata — serve as an opaque octet-stream rather than failing.
  }

  let bytes: Buffer;
  try {
    bytes = await fs.readFile(target);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const headers: Record<string, string> = { "Content-Type": contentType };
  if (payload.f) {
    headers["Content-Disposition"] =
      `attachment; filename="${payload.f.replace(/"/g, "")}"`;
  }

  return new NextResponse(new Uint8Array(bytes), { headers });
}
