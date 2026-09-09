import { afterEach, describe, expect, it, vi } from "vitest";
import { to18 } from "../transform/ids";
import { createSfdcAuthenticator } from "./auth";
import { SfdcBulk, parseLocator, pkChunkingHeader } from "./bulk2";
import { SfdcApiError } from "./errors";
import { SfdcTransport } from "./rest";
import {
  API,
  LOGIN_URL,
  collect,
  jsonReply,
  mockFetch,
  testKeyPair,
  textReply,
  tokenRoute,
  type Route,
} from "./test-helpers";

const { privateKey } = testKeyPair();
const JOB = "750000000000001AAA";
const ID1 = to18("a0K000000000001");
const ID2 = to18("a0K000000000002");
const ID3 = to18("a0K000000000003");

afterEach(() => vi.unstubAllGlobals());

interface FakeJob {
  states: string[];
  pages: Array<{
    csv: string;
    locator: string | null;
    next: string | null;
    n?: number;
  }>;
}

/** Route table for one bulk job: create → poll (state sequence) → results by locator. */
function jobRoutes(
  job: FakeJob,
  onCreate?: (req: {
    headers: Record<string, string>;
    body: string | null;
  }) => void,
): Route[] {
  let polls = 0;
  return [
    {
      method: "POST",
      match: "/jobs/query",
      reply: (req) => {
        onCreate?.(req);
        return jsonReply({
          id: JOB,
          operation: JSON.parse(req.body ?? "{}").operation,
          object: "Call2_vod__c",
          state: "UploadComplete",
          createdDate: "2026-09-08T10:00:00.000+0000",
        });
      },
    },
    {
      method: "GET",
      match: `/jobs/query/${JOB}/results`,
      reply: (req) => {
        const loc = req.parsed.searchParams.get("locator");
        const page = job.pages.find((p) => p.locator === loc);
        if (!page)
          return jsonReply(
            [
              {
                errorCode: "INVALID_QUERY_LOCATOR",
                message: `bad locator ${loc}`,
              },
            ],
            400,
          );
        return textReply(page.csv, 200, {
          "Sforce-Locator": page.next ?? "null",
          "Sforce-NumberOfRecords": String(
            page.n ?? page.csv.trim().split("\n").length - 1,
          ),
        });
      },
    },
    {
      method: "GET",
      match: `/jobs/query/${JOB}`,
      reply: () => {
        const state = job.states[Math.min(polls, job.states.length - 1)];
        polls++;
        return jsonReply({
          id: JOB,
          operation: "queryAll",
          object: "Call2_vod__c",
          state,
          numberRecordsProcessed: state === "JobComplete" ? 3 : 0,
        });
      },
    },
  ];
}

function build(
  routes: Route[],
  opts: { concurrency?: number; sleeps?: number[]; now?: () => number } = {},
) {
  const fm = mockFetch([tokenRoute(), ...routes]);
  vi.stubGlobal("fetch", fm.fetch);
  const auth = createSfdcAuthenticator({
    loginUrl: LOGIN_URL,
    auth: { kind: "jwt", clientId: "c", username: "u", privateKey },
  });
  const transport = new SfdcTransport({
    auth,
    apiVersion: "67.0",
    retry: { sleep: async () => {}, random: () => 0.5 },
  });
  const sleeps = opts.sleeps ?? [];
  const bulk = new SfdcBulk(transport, {
    concurrency: opts.concurrency ?? 4,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 1, // deterministic: delay == ceiling
    now: opts.now,
  });
  return { fm, transport, bulk, sleeps };
}

const PAGE1 = `Id,Name,Account_vod__r.Name\n${ID1},"Call, one",Acme\n${ID2},,"Multi\nline"\n`;
const PAGE2 = `Id,Name,Account_vod__r.Name\n${ID3},Third,\n`;

describe("helpers", () => {
  it("renders the PK chunking header and validates the size", () => {
    expect(pkChunkingHeader(undefined)).toBeUndefined();
    expect(pkChunkingHeader(false)).toBeUndefined();
    expect(pkChunkingHeader(true)).toBe("chunkSize=100000");
    expect(
      pkChunkingHeader({ chunkSize: 250000, startRow: ID1, parent: "Account" }),
    ).toBe(`chunkSize=250000; startRow=${ID1}; parent=Account`);
    expect(() => pkChunkingHeader({ chunkSize: 999 })).toThrow(RangeError);
  });
  it("normalises the literal null locator", () => {
    expect(parseLocator("null")).toBeNull();
    expect(parseLocator("NULL")).toBeNull();
    expect(parseLocator(null)).toBeNull();
    expect(parseLocator("")).toBeNull();
    expect(parseLocator(" MTAwMDA= ")).toBe("MTAwMDA=");
  });
});

describe("SfdcBulk.query", () => {
  it("creates a queryAll CSV job with PK chunking, polls with 1s→30s backoff and pages results by locator", async () => {
    let create:
      | { headers: Record<string, string>; body: string | null }
      | undefined;
    const job: FakeJob = {
      states: [
        "UploadComplete",
        "InProgress",
        "InProgress",
        "InProgress",
        "InProgress",
        "InProgress",
        "InProgress",
        "JobComplete",
      ],
      pages: [
        { csv: PAGE1, locator: null, next: "MTAwMDA=", n: 2 },
        { csv: PAGE2, locator: "MTAwMDA=", next: null, n: 1 },
      ],
    };
    const { fm, bulk, sleeps } = build(jobRoutes(job, (r) => (create = r)));
    const result = bulk.query(
      "SELECT Id, Name, Account_vod__r.Name FROM Call2_vod__c",
      { all: true, pkChunking: { chunkSize: 50000 }, maxRecords: 2 },
    );
    const pages = await collect(result);
    const info = await result.job;

    expect(create?.headers["sforce-enable-pkchunking"]).toBe("chunkSize=50000");
    expect(JSON.parse(create?.body ?? "{}")).toEqual({
      operation: "queryAll",
      query: "SELECT Id, Name, Account_vod__r.Name FROM Call2_vod__c",
      contentType: "CSV",
      columnDelimiter: "COMMA",
      lineEnding: "LF",
    });
    expect(info).toMatchObject({
      id: JOB,
      state: "JobComplete",
      operation: "queryAll",
      numberRecordsProcessed: 3,
    });
    // 7 non-terminal polls → 7 sleeps with doubling ceiling capped at 30 s
    expect(sleeps).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);

    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({
      jobId: JOB,
      locator: null,
      nextLocator: "MTAwMDA=",
      pageNo: 0,
      rows: 2,
      csv: PAGE1,
    });
    expect(pages[0].records).toEqual([
      { Id: ID1, Name: "Call, one", "Account_vod__r.Name": "Acme" },
      { Id: ID2, Name: null, "Account_vod__r.Name": "Multi\nline" },
    ]);
    expect(pages[1]).toMatchObject({
      locator: "MTAwMDA=",
      nextLocator: null,
      pageNo: 1,
      rows: 1,
    });
    expect(pages[1].records).toEqual([
      { Id: ID3, Name: "Third", "Account_vod__r.Name": null },
    ]);

    const results = fm.callsTo("/results");
    expect(results[0].url).toBe(
      `${API}/jobs/query/${JOB}/results?maxRecords=2`,
    );
    expect(results[0].headers.accept).toBe("text/csv");
    expect(results[1].url).toBe(
      `${API}/jobs/query/${JOB}/results?maxRecords=2&locator=MTAwMDA%3D`,
    );
    expect(bulk.activeJobs).toBe(0);
  });

  it("resumes an existing job from a persisted (jobId, locator, pageNo) without creating a new one", async () => {
    const job: FakeJob = {
      states: ["JobComplete"],
      pages: [
        { csv: PAGE1, locator: null, next: "L1" },
        { csv: PAGE2, locator: "L1", next: null },
      ],
    };
    const { fm, bulk } = build(jobRoutes(job));
    const pages = await collect(
      bulk.query("ignored", {
        resume: { jobId: JOB, locator: "L1", pageNo: 1 },
      }),
    );
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({
      jobId: JOB,
      locator: "L1",
      nextLocator: null,
      pageNo: 1,
    });
    expect(
      fm.calls.filter(
        (c) => c.method === "POST" && c.url.endsWith("/jobs/query"),
      ),
    ).toHaveLength(0);
  });

  it("rejects both the job promise and the iterator when the job fails, and releases the slot", async () => {
    const job: FakeJob = { states: ["InProgress", "Failed"], pages: [] };
    const { bulk } = build(jobRoutes(job), { concurrency: 1 });
    const result = bulk.query("SELECT Id FROM Call2_vod__c");
    const iterErr = (await collect(result).catch(
      (e: unknown) => e,
    )) as SfdcApiError;
    expect(iterErr).toBeInstanceOf(SfdcApiError);
    expect(iterErr.errorCode).toBe("BULK_JOB_FAILED");
    expect(iterErr.errorClass).toBe("structural");
    await expect(result.job).rejects.toMatchObject({
      errorCode: "BULK_JOB_FAILED",
    });
    expect(bulk.activeJobs).toBe(0);
    // an Aborted job is reported distinctly
    const aborted = bulk.query("x", {
      resume: { jobId: JOB, locator: null, pageNo: 0 },
    });
    job.states = ["Aborted"];
    await expect(collect(aborted)).rejects.toMatchObject({
      errorCode: "BULK_JOB_ABORTED",
    });
  });

  it("times out polling after pollTimeoutMs with a retryable error", async () => {
    let t = 0;
    const job: FakeJob = { states: ["InProgress"], pages: [] };
    const { transport } = build(jobRoutes(job));
    const bulk = new SfdcBulk(transport, {
      pollTimeoutMs: 5000,
      sleep: async (ms) => void (t += ms),
      now: () => t,
      random: () => 1,
    });
    await expect(
      collect(bulk.query("SELECT Id FROM Call2_vod__c")),
    ).rejects.toMatchObject({
      errorCode: "BULK_JOB_TIMEOUT",
      errorClass: "retryable",
    });
  });

  it("caps concurrent jobs at sfdcBulkConcurrency (slot held until the pages are consumed)", async () => {
    const job: FakeJob = {
      states: ["JobComplete"],
      pages: [{ csv: PAGE2, locator: null, next: null }],
    };
    const { bulk } = build(jobRoutes(job), { concurrency: 1 });
    const first = bulk
      .query("SELECT Id FROM Call2_vod__c")
      [Symbol.asyncIterator]();
    await first.next();
    expect(bulk.activeJobs).toBe(1);
    let secondStarted = false;
    const second = (async () => {
      for await (const _p of bulk.query("SELECT Id FROM Call2_vod__c"))
        secondStarted = true;
    })();
    await new Promise((r) => setTimeout(r, 5));
    expect(secondStarted).toBe(false);
    await first.return?.(undefined);
    await second;
    expect(secondStarted).toBe(true);
    expect(bulk.activeJobs).toBe(0);
  });

  it("surfaces a job-creation failure (e.g. PK chunking unsupported) as structural", async () => {
    const { bulk } = build([
      {
        method: "POST",
        match: "/jobs/query",
        reply: () =>
          jsonReply(
            [
              {
                errorCode: "INVALIDJOB",
                message: "PK chunking is not supported for this object",
              },
            ],
            400,
          ),
      },
    ]);
    const result = bulk.query("SELECT Id FROM Foo__c", { pkChunking: true });
    const err = (await collect(result).catch(
      (e: unknown) => e,
    )) as SfdcApiError;
    expect(err.status).toBe(400);
    expect(err.errorCode).toBe("INVALIDJOB");
    await expect(result.job).rejects.toBeInstanceOf(SfdcApiError);
  });
});

describe("SfdcBulk job control", () => {
  it("abortJob PATCHes Aborted then DELETEs, tolerating an already-terminal job", async () => {
    const { fm, bulk } = build([
      {
        method: "PATCH",
        match: `/jobs/query/${JOB}`,
        reply: () =>
          jsonReply(
            [{ errorCode: "INVALIDJOBSTATE", message: "already complete" }],
            400,
          ),
      },
      {
        method: "DELETE",
        match: `/jobs/query/${JOB}`,
        reply: () => new Response(null, { status: 204 }),
      },
    ]);
    await bulk.abortJob(JOB);
    const patch = fm.calls.find((c) => c.method === "PATCH");
    expect(patch?.url).toBe(`${API}/jobs/query/${JOB}`);
    expect(JSON.parse(patch?.body ?? "{}")).toEqual({ state: "Aborted" });
    expect(fm.calls.some((c) => c.method === "DELETE")).toBe(true);
    // a vanished job (404 on DELETE) is fine too
    const gone = build([
      {
        method: "PATCH",
        match: "/jobs/query/",
        reply: () => jsonReply([{ errorCode: "NOT_FOUND", message: "x" }], 404),
      },
      {
        method: "DELETE",
        match: "/jobs/query/",
        reply: () => jsonReply([{ errorCode: "NOT_FOUND", message: "x" }], 404),
      },
    ]);
    await expect(
      gone.bulk.abortJob("750000000000002AAA"),
    ).resolves.toBeUndefined();
  });

  it("listJobs follows nextRecordsUrl and cleanupFinishedJobs deletes terminal jobs only", async () => {
    const { fm, bulk } = build([
      {
        method: "GET",
        match: "/jobs/query/page2",
        reply: () =>
          jsonReply({
            done: true,
            records: [
              {
                id: "j3",
                operation: "query",
                object: "A",
                state: "InProgress",
              },
            ],
          }),
      },
      {
        method: "GET",
        match: /\/jobs\/query\?jobType=V2Query$/,
        reply: () =>
          jsonReply({
            done: false,
            nextRecordsUrl: "/services/data/v67.0/jobs/query/page2",
            records: [
              {
                id: "j1",
                operation: "queryAll",
                object: "A",
                state: "JobComplete",
              },
              { id: "j2", operation: "query", object: "B", state: "Failed" },
            ],
          }),
      },
      {
        method: "DELETE",
        match: "/jobs/query/",
        reply: () => new Response(null, { status: 204 }),
      },
    ]);
    const jobs = await bulk.listJobs();
    expect(jobs.map((j) => j.id)).toEqual(["j1", "j2", "j3"]);
    expect(await bulk.cleanupFinishedJobs()).toBe(2);
    expect(
      fm.calls
        .filter((c) => c.method === "DELETE")
        .map((c) => c.url.split("/").pop()),
    ).toEqual(["j1", "j2"]);
  });
});
