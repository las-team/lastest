import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  // tesseract.js spawns worker threads from its own package files — it must
  // stay a runtime dependency, not be bundled.
  external: ["tesseract.js"],
});
