import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  remoteDetectRegions,
  remoteRecognize,
  remoteSleep,
  remoteWarmup,
} from "./remote";
import { isRemoteOCR, ocrServiceUrl } from "./config";

const PNG_STUB = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe("OCR remote client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("OCR_SERVICE_URL", "http://ocr.test:8891/");
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("config: detects remote mode and strips trailing slashes", () => {
    expect(isRemoteOCR()).toBe(true);
    expect(ocrServiceUrl()).toBe("http://ocr.test:8891");
    vi.stubEnv("OCR_SERVICE_URL", "");
    expect(isRemoteOCR()).toBe(false);
    expect(ocrServiceUrl()).toBeNull();
  });

  it("recognize: posts PNG and returns text + confidence", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ text: "Hello", confidence: 91.5 }), {
        status: 200,
      }),
    );
    const result = await remoteRecognize(PNG_STUB);
    expect(result).toEqual({ text: "Hello", confidence: 91.5 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://ocr.test:8891/recognize");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("image/png");
  });

  it("recognize: sends bearer token when OCR_SERVICE_TOKEN is set", async () => {
    vi.stubEnv("OCR_SERVICE_TOKEN", "sekrit");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ text: "", confidence: 0 }), {
        status: 200,
      }),
    );
    await remoteRecognize(PNG_STUB);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer sekrit");
  });

  it("recognize: returns null on network failure instead of throwing", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(remoteRecognize(PNG_STUB)).resolves.toBeNull();
  });

  it("recognize: returns null on non-2xx response", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 503 }));
    await expect(remoteRecognize(PNG_STUB)).resolves.toBeNull();
  });

  it("recognize: returns null when OCR_SERVICE_URL is unset", async () => {
    vi.stubEnv("OCR_SERVICE_URL", "");
    await expect(remoteRecognize(PNG_STUB)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("detect-regions: passes granularity/minConfidence and returns regions", async () => {
    const regions = [{ x: 1, y: 2, width: 30, height: 10 }];
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ regions, confidence: 80 }), {
        status: 200,
      }),
    );
    const result = await remoteDetectRegions(PNG_STUB, "line", 42);
    expect(result).toEqual(regions);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "http://ocr.test:8891/detect-regions?granularity=line&minConfidence=42",
    );
  });

  it("detect-regions: null on failure (caller falls back to standard diff)", async () => {
    fetchMock.mockRejectedValue(new Error("timeout"));
    await expect(remoteDetectRegions(PNG_STUB, "word", 50)).resolves.toBeNull();
  });

  it("warmup/sleep: fire without body and never throw", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
    await remoteWarmup(2);
    await remoteSleep();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://ocr.test:8891/warmup?workers=2",
    );
    expect(fetchMock.mock.calls[1][0]).toBe("http://ocr.test:8891/sleep");

    fetchMock.mockRejectedValue(new Error("down"));
    await expect(remoteWarmup()).resolves.toBeUndefined();
    await expect(remoteSleep()).resolves.toBeUndefined();
  });
});
