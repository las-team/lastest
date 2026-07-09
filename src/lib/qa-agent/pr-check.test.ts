import { describe, it, expect } from "vitest";
import {
  buildPrChangesDigest,
  computePrChanges,
  computePrCoverage,
  parsePatchSymbols,
} from "./pr-check";
import type { QaGeneratedTest, QaPrChanges, QaTestPlan } from "@/lib/db/schema";

const compareFile = (
  filename: string,
  patch: string | undefined,
  status: "added" | "modified" | "removed" | "renamed" | "changed" = "modified",
  previousFilename?: string,
) => ({
  filename,
  status,
  additions: 1,
  deletions: 0,
  changes: 1,
  patch,
  previousFilename,
});

describe("parsePatchSymbols", () => {
  it("extracts added top-level declarations from + lines", () => {
    const patch = [
      "@@ -1,3 +1,9 @@",
      "+export async function createInvoice(input: Input) {",
      "+export const InvoiceRow = ({ id }: Props) => {",
      "+export class InvoiceStore {",
      "+function helperAtTopLevel() {",
      "+  function nestedIgnored() {",
      "+const notAFunction = 3;",
    ].join("\n");
    const { added } = parsePatchSymbols(patch);
    expect([...added.keys()].sort()).toEqual([
      "InvoiceRow",
      "InvoiceStore",
      "createInvoice",
      "helperAtTopLevel",
    ]);
    expect(added.get("InvoiceStore")).toBe(true); // class flag
  });

  it("marks hunk-context declarations as modified, added wins", () => {
    const patch = [
      "@@ -10,6 +10,8 @@ export function applyDiscount(order: Order) {",
      "+  const rate = 0.2;",
      "@@ -40,2 +42,6 @@ export function applyDiscount(order: Order) {",
      "+export function applyCoupon(order: Order) {",
    ].join("\n");
    const { added, modified } = parsePatchSymbols(patch);
    expect([...modified.keys()]).toEqual(["applyDiscount"]);
    expect([...added.keys()]).toEqual(["applyCoupon"]);
  });

  it("collects HTTP-method handlers separately", () => {
    const patch = [
      "@@ -1,1 +1,5 @@ export async function GET(req: Request) {",
      "+export async function POST(req: Request) {",
    ].join("\n");
    const { methods } = parsePatchSymbols(patch);
    expect(methods.get("POST")).toBe("added");
    expect(methods.get("GET")).toBe("modified");
  });
});

describe("computePrChanges", () => {
  it("splits route files into endpoints and source files into symbols", () => {
    const changes = computePrChanges(
      {
        baseBranch: "main",
        headBranch: "feat-invoices",
        files: [
          compareFile(
            "src/app/api/invoices/route.ts",
            "@@ -0,0 +1,9 @@\n+export async function POST(req: Request) {",
            "added",
          ),
          compareFile(
            "src/lib/billing/invoice.ts",
            "@@ -0,0 +1,4 @@\n+export function totalWithTax(cents: number) {",
            "added",
          ),
          compareFile("README.md", "+# docs", "modified"),
        ],
      },
      [],
    );
    expect(changes.endpoints).toEqual([
      {
        method: "POST",
        path: "/api/invoices",
        file: "src/app/api/invoices/route.ts",
        change: "added",
      },
    ]);
    expect(changes.symbols).toEqual([
      {
        name: "totalWithTax",
        kind: "function",
        file: "src/lib/billing/invoice.ts",
        change: "added",
      },
    ]);
    expect(changes.files).toHaveLength(3);
  });

  it("falls back to declared endpoints when the patch has no handler decl", () => {
    const changes = computePrChanges(
      {
        baseBranch: "main",
        headBranch: "fix",
        files: [
          compareFile(
            "src/app/api/users/[id]/route.ts",
            "@@ -12,3 +12,4 @@\n+  const user = await load(id);",
          ),
        ],
      },
      [
        {
          method: "DELETE",
          path: "/api/users/:id",
          file: "src/app/api/users/[id]/route.ts",
        },
      ],
    );
    expect(changes.endpoints).toEqual([
      {
        method: "DELETE",
        path: "/api/users/:id",
        file: "src/app/api/users/[id]/route.ts",
        change: "modified",
      },
    ]);
  });
});

describe("buildPrChangesDigest", () => {
  it("emits verbatim ref tags and the coverage requirement", () => {
    const pr: QaPrChanges = {
      baseBranch: "main",
      headBranch: "feat",
      files: [
        {
          path: "src/lib/a.ts",
          status: "modified",
          additions: 4,
          deletions: 1,
        },
      ],
      symbols: [
        {
          name: "totalWithTax",
          kind: "function",
          file: "src/lib/a.ts",
          change: "added",
        },
      ],
      endpoints: [
        {
          method: "POST",
          path: "/api/invoices",
          file: "src/app/api/invoices/route.ts",
          change: "added",
        },
      ],
    };
    const digest = buildPrChangesDigest(pr);
    expect(digest).toContain("vs `main`");
    expect(digest).toContain("[ref: totalWithTax]");
    expect(digest).toContain("[ref: POST /api/invoices]");
    expect(digest).toContain('"changeRefs"');
  });
});

describe("computePrCoverage", () => {
  const pr: QaPrChanges = {
    baseBranch: "main",
    headBranch: "feat",
    files: [],
    symbols: [
      {
        name: "totalWithTax",
        kind: "function",
        file: "src/lib/a.ts",
        change: "added",
      },
      {
        name: "unusedHelper",
        kind: "function",
        file: "src/lib/b.ts",
        change: "added",
      },
    ],
    endpoints: [
      {
        method: "POST",
        path: "/api/invoices",
        file: "src/app/api/invoices/route.ts",
        change: "added",
      },
    ],
  };
  const plan = {
    appProfile: { summary: "" },
    journeys: [],
    items: [
      {
        id: "T1",
        group: "ui",
        title: "Invoice totals show tax",
        priority: "P1",
        scenario: "…",
        changeRefs: ["totalWithTax"],
      },
      {
        id: "T2",
        group: "api",
        title: "Create invoice API",
        priority: "P1",
        scenario: "…",
        api: { method: "POST", path: "/api/invoices", expectedStatus: 201 },
      },
      {
        id: "T3",
        group: "ui",
        title: "Disabled item",
        priority: "P3",
        scenario: "…",
        changeRefs: ["unusedHelper"],
        enabled: false,
      },
    ],
  } as unknown as QaTestPlan;
  const ledger: QaGeneratedTest[] = [
    {
      planItemId: "T1",
      group: "ui",
      testId: "test-1",
      name: "Invoice totals show tax",
      status: "passed",
    },
    {
      planItemId: "T2",
      group: "api",
      testId: "test-2",
      name: "Create invoice API",
      status: "generated",
    },
  ];

  it("joins changeRefs and api-path fallbacks to a per-change verdict", () => {
    const coverage = computePrCoverage(pr, plan, ledger);
    const byRef = new Map(coverage.entries.map((e) => [e.ref, e]));
    expect(byRef.get("totalWithTax")?.status).toBe("passed");
    expect(byRef.get("totalWithTax")?.testIds).toEqual(["test-1"]);
    // No changeRefs on T2 — matched through api.method+path.
    expect(byRef.get("POST /api/invoices")?.status).toBe("generated");
    // Disabled items don't count.
    expect(byRef.get("unusedHelper")?.status).toBe("uncovered");
    expect(coverage.coveredCount).toBe(2);
  });

  it("reports planned when an item matches but has no test yet", () => {
    const coverage = computePrCoverage(pr, plan, []);
    const byRef = new Map(coverage.entries.map((e) => [e.ref, e]));
    expect(byRef.get("totalWithTax")?.status).toBe("planned");
  });
});
