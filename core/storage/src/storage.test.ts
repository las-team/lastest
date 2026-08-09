import { describe, expect, it, vi } from "vitest";

import { createStorageCapability } from "./storage";
import type { HostBlobRef, StorageHost } from "./host";

const scope = { pluginId: "explorer", teamId: "t1" };

function blobRef(overrides: Partial<HostBlobRef> = {}): HostBlobRef {
  return {
    key: "t1/explorer/report.json",
    bytes: 10,
    contentType: "application/json",
    createdAt: new Date(0),
    ...overrides,
  };
}

function hostWith(overrides: Partial<StorageHost> = {}): StorageHost {
  return {
    put: vi.fn(async () => blobRef()),
    get: vi.fn(async () => new Uint8Array([1])),
    head: vi.fn(async () => blobRef()),
    list: vi.fn(async () => [blobRef()]),
    delete: vi.fn(async () => {}),
    usedBytes: vi.fn(async () => 0),
    quotaLimitBytes: vi.fn(async () => 1000),
    signedUrl: vi.fn(async () => "https://signed.example/x"),
    ...overrides,
  };
}

describe("createStorageCapability", () => {
  it("namespaces every key before it reaches the host", async () => {
    const host = hostWith();
    const storage = createStorageCapability(host, scope);

    await storage.put("report.json", new Uint8Array([1, 2, 3]));

    expect(host.put).toHaveBeenCalledWith(
      "t1/explorer/report.json",
      new Uint8Array([1, 2, 3]),
      expect.any(Object),
    );
  });

  it("strips the namespace back off before returning a BlobRef", async () => {
    const storage = createStorageCapability(hostWith(), scope);
    const ref = await storage.put("report.json", new Uint8Array([1]));
    expect(ref.key).toBe("report.json");
  });

  it("rejects a put that would exceed quota", async () => {
    const host = hostWith({
      usedBytes: vi.fn(async () => 995),
      quotaLimitBytes: vi.fn(async () => 1000),
    });
    const storage = createStorageCapability(host, scope);

    await expect(storage.put("big.bin", new Uint8Array(10))).rejects.toThrow(
      /quota/i,
    );
    expect(host.put).not.toHaveBeenCalled();
  });

  it("allows a put that exactly fills remaining quota", async () => {
    const host = hostWith({
      usedBytes: vi.fn(async () => 990),
      quotaLimitBytes: vi.fn(async () => 1000),
    });
    const storage = createStorageCapability(host, scope);
    await expect(
      storage.put("fits.bin", new Uint8Array(10)),
    ).resolves.toBeDefined();
  });

  it("reports quota as used/limit", async () => {
    const host = hostWith({
      usedBytes: vi.fn(async () => 42),
      quotaLimitBytes: vi.fn(async () => 1000),
    });
    const storage = createStorageCapability(host, scope);
    expect(await storage.quota()).toEqual({ usedBytes: 42, limitBytes: 1000 });
  });

  it("throws rather than returning a falsy signed URL", async () => {
    const host = hostWith({ signedUrl: vi.fn(async () => null) });
    const storage = createStorageCapability(host, scope);
    await expect(storage.signedUrl("report.json")).rejects.toThrow(
      /no signing secret/i,
    );
  });

  it("namespaces list/head/delete/get the same way", async () => {
    const host = hostWith();
    const storage = createStorageCapability(host, scope);

    await storage.get("report.json");
    await storage.head("report.json");
    await storage.list("reports/");
    await storage.delete("report.json");

    expect(host.get).toHaveBeenCalledWith("t1/explorer/report.json");
    expect(host.head).toHaveBeenCalledWith("t1/explorer/report.json");
    expect(host.list).toHaveBeenCalledWith("t1/explorer/reports/");
    expect(host.delete).toHaveBeenCalledWith("t1/explorer/report.json");
  });
});
