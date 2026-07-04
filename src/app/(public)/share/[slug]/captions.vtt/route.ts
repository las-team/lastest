import { NextRequest } from "next/server";
import { getPublicShareContext } from "@/lib/db/queries/public-shares";
import { getBuildDemoNotes } from "@/lib/db/queries/demo-notes";
import { isValidShareSlug } from "@/lib/share/slug";
import { captionsToVtt } from "@/lib/share/vtt";

// Serve the share recording's subtitle track as a real WebVTT file so the
// <video> on /r/<slug> can attach it via <track src=".../captions.vtt">.
//
// A literal `captions.vtt` segment out-ranks the sibling `[...path]` catch-all
// in Next's route matching, so this never collides with the media route — and
// because captions are generated text (not a storage file), they don't need a
// place in that route's path allow-list.
//
// Captions are time-coded to the share's PINNED build recording, so they're
// resolved from that build's own notes — NOT the repo-latest used for the prose
// panel. Otherwise a sibling share in the same repo would inherit cues whose
// timing matches a different video.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!isValidShareSlug(slug)) {
    return new Response("Bad Request", { status: 400 });
  }

  const ctx = await getPublicShareContext(slug);
  if (!ctx) {
    return new Response("Not Found", { status: 404 });
  }

  const notes = await getBuildDemoNotes(ctx.build.id);
  const captions = notes?.captions ?? [];
  if (captions.length === 0) {
    return new Response("Not Found", { status: 404 });
  }

  return new Response(captionsToVtt(captions), {
    status: 200,
    headers: {
      "Content-Type": "text/vtt; charset=utf-8",
      // Captions can change when a run regenerates them, so keep the TTL short
      // and revalidate rather than the immutable year-long cache the media
      // route uses for content-addressed assets.
      "Cache-Control": "public, max-age=60, must-revalidate",
    },
  });
}
