import { describe, it, expect } from "vitest";
import {
  buildCodeCheckDigest,
  extractDeclaredEndpoints,
  extractMethodsFromSource,
  isApiRouteFile,
  selectApiRouteFiles,
  type QaCodeCheck,
} from "./code-check";
import { buildDocsDigest, isSupportedDocName } from "./docs";
import type { TreeEntry } from "@/lib/github/content";

const blob = (path: string): TreeEntry => ({
  path,
  mode: "100644",
  type: "blob",
  sha: path,
  url: "",
});

describe("isApiRouteFile / selectApiRouteFiles", () => {
  it("matches App Router route files and pages/api files only", () => {
    expect(isApiRouteFile("src/app/api/users/route.ts")).toBe(true);
    expect(isApiRouteFile("app/api/auth/[...all]/route.ts")).toBe(true);
    expect(isApiRouteFile("pages/api/login.ts")).toBe(true);
    expect(isApiRouteFile("pages/api/orders/index.ts")).toBe(true);
    expect(isApiRouteFile("src/app/dashboard/page.tsx")).toBe(false);
    expect(isApiRouteFile("src/lib/api/client.ts")).toBe(false);
  });

  it("filters trees to blobs and caps the selection", () => {
    const tree = [
      blob("src/app/api/a/route.ts"),
      { ...blob("src/app/api/b/route.ts"), type: "tree" as const },
      blob("README.md"),
    ];
    expect(selectApiRouteFiles(tree).map((e) => e.path)).toEqual([
      "src/app/api/a/route.ts",
    ]);
  });
});

describe("extractMethodsFromSource", () => {
  it("finds App Router method exports", () => {
    const src = `export async function GET(req: Request) {}\nexport const POST = async () => {};`;
    expect(extractMethodsFromSource(src).sort()).toEqual(["GET", "POST"]);
  });

  it("finds pages/api req.method checks", () => {
    const src = `export default function handler(req, res) { if (req.method === "DELETE") {} }`;
    expect(extractMethodsFromSource(src)).toEqual(["DELETE"]);
  });

  it("defaults to GET when no method is discernible", () => {
    expect(extractMethodsFromSource("export default handler")).toEqual(["GET"]);
  });
});

describe("extractDeclaredEndpoints", () => {
  it("maps file paths to URL paths with dynamic segments", async () => {
    const tree = [
      blob("src/app/api/users/[id]/route.ts"),
      blob("src/app/(app)/api/ignored-group/route.ts"),
      blob("pages/api/auth/[...all].ts"),
      blob("src/app/api/broken/route.ts"),
    ];
    const sources: Record<string, string | null> = {
      "src/app/api/users/[id]/route.ts":
        "export async function GET() {}\nexport async function DELETE() {}",
      "src/app/(app)/api/ignored-group/route.ts":
        "export async function POST() {}",
      "pages/api/auth/[...all].ts": 'if (req.method === "POST") {}',
      "src/app/api/broken/route.ts": null,
    };
    const endpoints = await extractDeclaredEndpoints(tree, async (p) => {
      return sources[p] ?? null;
    });
    expect(endpoints).toContainEqual({
      method: "GET",
      path: "/api/users/:id",
      file: "src/app/api/users/[id]/route.ts",
    });
    expect(endpoints).toContainEqual({
      method: "POST",
      path: "/api/ignored-group",
      file: "src/app/(app)/api/ignored-group/route.ts",
    });
    expect(endpoints).toContainEqual({
      method: "POST",
      path: "/api/auth/:all*",
      file: "pages/api/auth/[...all].ts",
    });
    // Unreadable files are skipped, not failed.
    expect(endpoints.some((e) => e.file.includes("broken"))).toBe(false);
  });
});

describe("buildCodeCheckDigest", () => {
  it("renders stack facts, notes, and declared endpoints", () => {
    const check: QaCodeCheck = {
      framework: "Next.js 16 (App Router)",
      authMechanism: "better-auth",
      apiLayer: "REST",
      projectDescription: "A demo bank.",
      testingNotes: ["stripe: mock payment intents in tests"],
      declaredEndpoints: [
        {
          method: "POST",
          path: "/api/transfer",
          file: "app/api/transfer/route.ts",
        },
      ],
    };
    const digest = buildCodeCheckDigest(check);
    expect(digest).toContain("## Code analysis");
    expect(digest).toContain("Framework: Next.js 16 (App Router)");
    expect(digest).toContain("Auth: better-auth");
    expect(digest).toContain("- stripe: mock payment intents in tests");
    expect(digest).toContain("- POST /api/transfer");
  });
});

describe("docs digest", () => {
  it("filters supported extensions", () => {
    expect(isSupportedDocName("SPEC.md")).toBe(true);
    expect(isSupportedDocName("manual.PDF")).toBe(true);
    expect(isSupportedDocName("notes.docx")).toBe(true);
    expect(isSupportedDocName("image.png")).toBe(false);
  });

  it("shares the budget across docs and labels each", () => {
    const digest = buildDocsDigest([
      { name: "spec.md", text: "Users can transfer money." },
      { name: "faq.txt", text: "x".repeat(50_000) },
    ]);
    expect(digest).toContain("### Document: spec.md");
    expect(digest).toContain("Users can transfer money.");
    expect(digest).toContain("### Document: faq.txt");
    expect(digest).toContain("…(truncated)");
    expect(digest.length).toBeLessThan(16_500);
  });

  it("returns empty for empty docs", () => {
    expect(buildDocsDigest([{ name: "a.md", text: "   " }])).toBe("");
  });
});
