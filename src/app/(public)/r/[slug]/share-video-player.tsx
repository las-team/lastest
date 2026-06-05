// Thin compatibility re-export. The implementation now lives in
// `@/components/replay-player` so the in-app test detail page can reuse the
// same autoplay/loop/`[data-seek]`-aware wrapper as the public share page.
// Keep the `ShareVideoPlayer` named export so the share page import and the
// commentary references in `server/actions/builds.ts` remain valid.
export { ReplayPlayer as ShareVideoPlayer } from "@/components/replay-player";
