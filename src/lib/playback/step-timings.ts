// Thin compatibility re-export. The implementation now lives in
// `@lastest/playback` so plugin packages (which cannot import `@/…`) can use
// it too. Kept here so the many in-app call sites don't need their import
// paths touched.
export {
  resolveStepSegments,
  type StepScreenshotTiming,
} from "@lastest/playback";
