import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getUserCount } from "@/lib/db/queries/auth";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function validateApiKey(request: Request): boolean {
  const key = process.env.STATS_API_KEY;
  if (!key) return false;

  // Header only — a `?key=` query string would land the secret in proxy/access
  // logs. Compared in constant time to avoid a byte-by-byte timing oracle.
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  return safeEqual(authHeader.slice(7), key);
}

export async function GET(request: Request) {
  if (!validateApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const userCount = await getUserCount();

    return NextResponse.json(
      {
        users: userCount,
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 },
    );
  }
}
