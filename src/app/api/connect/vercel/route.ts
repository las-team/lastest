import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentSession } from "@/lib/auth";
import {
  getVercelAuthUrl,
  isVercelIntegrationConfigured,
} from "@/lib/vercel/oauth";

const VERCEL_OAUTH_STATE_COOKIE = "vercel_oauth_state";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.redirect(
      new URL(
        "/login",
        process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      ),
    );
  }

  if (!isVercelIntegrationConfigured()) {
    return NextResponse.redirect(
      new URL(
        "/settings?error=vercel_not_configured",
        process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      ),
    );
  }

  // Fresh CSRF state, persisted as an HttpOnly cookie scoped to the connect
  // path. The callback verifies it with crypto.timingSafeEqual (see callback).
  const state = crypto.randomUUID();
  const payload = JSON.stringify({ state, userId: session.user.id });
  const cookieStore = await cookies();
  cookieStore.set(VERCEL_OAUTH_STATE_COOKIE, payload, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/api/connect/vercel",
  });

  return NextResponse.redirect(getVercelAuthUrl(state));
}
