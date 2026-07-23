import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractText } from "./ocr";

/**
 * extractText goes through the OCR facade, which is remote-only: all
 * recognition happens in the ocr-service container (OCR_SERVICE_URL
 * required). These tests mock the service and exercise the word-level
 * confidence filtering and degradation paths.
 */

const PNG_STUB = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function serviceResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("extractText (remote OCR)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("OCR_SERVICE_URL", "http://ocr.test:8891");
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("drops low-confidence junk words and keeps the clean label", async () => {
    fetchMock.mockResolvedValue(
      serviceResponse({
        text: "& Save\n",
        confidence: 48, // dragged down by the icon glyph
        words: [
          { text: "&", confidence: 5 }, // icon glyph junk
          { text: "Save", confidence: 95 },
        ],
      }),
    );
    await expect(extractText(PNG_STUB)).resolves.toBe("Save");
  });

  it("returns null when no word is confident", async () => {
    fetchMock.mockResolvedValue(
      serviceResponse({
        text: "#~\n",
        confidence: 12,
        words: [
          { text: "#", confidence: 20 },
          { text: "~", confidence: 15 },
        ],
      }),
    );
    await expect(extractText(PNG_STUB)).resolves.toBeNull();
  });

  it("returns null when kept-word average confidence is below 60%", async () => {
    fetchMock.mockResolvedValue(
      serviceResponse({
        text: "maybe text\n",
        confidence: 50,
        words: [
          { text: "maybe", confidence: 45 },
          { text: "text", confidence: 50 },
        ],
      }),
    );
    await expect(extractText(PNG_STUB)).resolves.toBeNull();
  });

  it("falls back to whole-image confidence when no word breakdown", async () => {
    fetchMock.mockResolvedValue(
      serviceResponse({ text: "Hello World\n", confidence: 91 }),
    );
    await expect(extractText(PNG_STUB)).resolves.toBe("Hello World");

    fetchMock.mockResolvedValue(
      serviceResponse({ text: "garbled\n", confidence: 30 }),
    );
    await expect(extractText(PNG_STUB)).resolves.toBeNull();
  });

  it("returns null when the OCR service is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(extractText(PNG_STUB)).resolves.toBeNull();
  });

  it("returns null (no fetch) when OCR_SERVICE_URL is unset", async () => {
    vi.stubEnv("OCR_SERVICE_URL", "");
    await expect(extractText(PNG_STUB)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
