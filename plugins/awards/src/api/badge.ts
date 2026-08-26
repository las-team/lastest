import { NextRequest, NextResponse } from "next/server";

import { getRepoAwardBySlug } from "../reads";
import {
  renderA11yBadge,
  renderAllPassingBadge,
  renderPendingBadge,
  renderTierBadge,
  renderZeroDriftBadge,
  type Size,
} from "../svg";
import { awardsWiring } from "../wiring";

/**
 * `GET /api/badge/[slug]/[type]` — the embeddable badge SVG endpoint.
 *
 * `src/app/api/badge/[slug]/[type]/route.ts` is a bare re-export of `GET`,
 * the same shape as `src/app/api/v1/launch/[...path]/route.ts` (recipe §6.2):
 * every line of this handler is the feature's own except the one core call
 * (`host.getBuildTotalTests`, for the all-passing badge's "N / N" total),
 * which the host port already covers — so nothing was left for the app to
 * compose.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type BadgeType = "tier" | "a11y" | "all-passing" | "zero-drift";

const VALID_TYPES: BadgeType[] = ["tier", "a11y", "all-passing", "zero-drift"];
const VALID_SIZES: Size[] = ["sm", "md", "lg"];

function parseType(raw: string): BadgeType | null {
  const stripped = raw.replace(/\.svg$/i, "").toLowerCase();
  return VALID_TYPES.includes(stripped as BadgeType)
    ? (stripped as BadgeType)
    : null;
}

function parseSize(raw: string | null): Size {
  if (raw && VALID_SIZES.includes(raw as Size)) return raw as Size;
  return "md";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; type: string }> },
) {
  const { slug, type: rawType } = await params;
  const url = new URL(request.url);
  const size = parseSize(url.searchParams.get("size"));
  const dark = url.searchParams.get("theme") === "dark";

  const headers = {
    "Content-Type": "image/svg+xml; charset=utf-8",
    // Live-but-cheap: 5min CDN cache, browsers may revalidate sooner.
    "Cache-Control":
      "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
  };

  const badgeType = parseType(rawType);
  if (!badgeType) {
    return new NextResponse(renderPendingBadge(size, dark), {
      headers,
      status: 200,
    });
  }

  const ctx = await getRepoAwardBySlug(slug);
  if (!ctx || !ctx.award) {
    return new NextResponse(renderPendingBadge(size, dark), {
      headers,
      status: 200,
    });
  }

  const { award } = ctx;
  const cats = award.categories;

  let svg: string;
  switch (badgeType) {
    case "tier":
      svg = renderTierBadge(award.currentTier, size, dark);
      break;
    case "a11y":
      svg = renderA11yBadge(cats.a11y, size, dark);
      break;
    case "all-passing": {
      let total = 0;
      if (award.lastBuildId) {
        const { host } = awardsWiring();
        total = (await host.getBuildTotalTests(award.lastBuildId)) ?? 0;
      }
      svg = renderAllPassingBadge(cats.allPassing, total, size, dark);
      break;
    }
    case "zero-drift":
      svg = renderZeroDriftBadge(cats.zeroDrift, size, dark);
      break;
  }

  return new NextResponse(svg, { headers, status: 200 });
}
