/**
 * Settings → "Video Recording" was a dead toggle: `playwright_settings
 * .enableVideoRecording` round-tripped through the settings card and the API
 * allowlist, but no consumer read it. Video was gated solely on the per-run
 * `forceVideoRecording` flag, which only demo/share builds pass — so a user who
 * turned the switch on got nothing and no error.
 *
 * These lock in both sources feeding the one wire field.
 */
import { describe, expect, it } from "vitest";

import { resolveVideoRecording } from "@/lib/execution/executor";

describe("resolveVideoRecording", () => {
  it("records when the repo-level settings toggle is on", () => {
    expect(
      resolveVideoRecording({
        playwrightSettings: { enableVideoRecording: true },
      }),
    ).toBe(true);
  });

  it("records when a demo/share build forces it, settings off", () => {
    expect(
      resolveVideoRecording({
        forceVideoRecording: true,
        playwrightSettings: { enableVideoRecording: false },
      }),
    ).toBe(true);
  });

  it("does not record when both sources are off", () => {
    expect(
      resolveVideoRecording({
        forceVideoRecording: false,
        playwrightSettings: { enableVideoRecording: false },
      }),
    ).toBeUndefined();
  });

  it("stays off the wire rather than sending false", () => {
    // The EB reads `command.forceVideoRecording` as a plain truthiness check;
    // keeping the field absent matches how every other optional flag is sent.
    expect(resolveVideoRecording({})).toBeUndefined();
    expect(resolveVideoRecording({ playwrightSettings: null })).toBeUndefined();
  });

  it("treats a null settings column as off", () => {
    // The column is nullable and `getPlaywrightSettings()` returns rows created
    // before the field existed.
    expect(
      resolveVideoRecording({
        playwrightSettings: { enableVideoRecording: null },
      }),
    ).toBeUndefined();
  });
});
