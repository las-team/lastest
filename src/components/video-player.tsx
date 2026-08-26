// Thin compatibility re-export. The implementation now lives in `@lastest/ui`
// so plugin packages (which cannot import `@/…`) can render it too. Kept here
// so the many in-app call sites don't need their import paths touched.
export {
  VideoPlayer,
  type PlayerSegment,
  type VideoPlayerHandle,
  type VideoPlayerProps,
  type VideoTextTrack,
} from "@lastest/ui";
