/**
 * HTTP client for Lastest REST API v1.
 * All MCP tools delegate to this client.
 */

export interface LastestClientConfig {
  baseUrl: string;
  apiKey: string;
}

export interface ToolResponse {
  status: string;
  summary: string;
  actionRequired?: string[];
  details: Record<string, unknown>;
}

export class LastestClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: LastestClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Lastest API error ${res.status}: ${text || res.statusText}`,
      );
    }

    return res.json() as Promise<T>;
  }

  private get<T = unknown>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  private post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  private del<T = unknown>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  // --- Health ---

  async health(): Promise<{ ok: boolean }> {
    return this.get("/api/v1/health");
  }

  // --- Repositories ---

  async listRepos(): Promise<unknown[]> {
    return this.get("/api/v1/repos");
  }

  async getRepo(repoId: string): Promise<unknown> {
    return this.get(`/api/v1/repos/${repoId}`);
  }

  async createRepo(
    name: string,
    opts?: { baseUrl?: string },
  ): Promise<{
    id: string;
    name: string;
    fullName: string;
    baseUrl?: string | null;
  }> {
    return this.post("/api/v1/repos", { name, baseUrl: opts?.baseUrl });
  }

  async updateRepo(
    repoId: string,
    data: {
      name?: string;
      defaultBranch?: string;
      selectedBranch?: string;
      baseUrl?: string;
    },
  ): Promise<unknown> {
    return this.put(`/api/v1/repos/${repoId}`, data);
  }

  // --- Builds ---

  async createBuild(opts: {
    repositoryId?: string;
    triggerType?: string;
    testIds?: string[];
    functionalAreaId?: string;
    gitBranch?: string;
    forceVideoRecording?: boolean;
  }): Promise<{ buildId: string; testRunId: string; testCount: number }> {
    return this.post("/api/v1/runs", {
      repositoryId: opts.repositoryId,
      testIds: opts.testIds,
      functionalAreaId: opts.functionalAreaId,
      forceVideoRecording: opts.forceVideoRecording,
    });
  }

  async validateDiff(opts: {
    repositoryId: string;
    diff?: string;
    baseBranch?: string;
    headBranch?: string;
    wait?: boolean;
    maxWaitMs?: number;
  }): Promise<Record<string, unknown>> {
    return this.post("/api/v1/validate-diff", opts);
  }

  async suggestAppFix(
    testId: string,
    opts?: { buildId?: string },
  ): Promise<Record<string, unknown>> {
    return this.post(`/api/v1/tests/${testId}/suggest-app-fix`, {
      buildId: opts?.buildId,
    });
  }

  async revokeShare(shareId: string): Promise<{ success: boolean }> {
    return this.del(`/api/v1/shares/${shareId}`);
  }

  async listBuildShares(buildId: string): Promise<unknown[]> {
    return this.get(`/api/v1/builds/${buildId}/shares`);
  }

  async listTestShares(testId: string): Promise<unknown[]> {
    return this.get(`/api/v1/tests/${testId}/shares`);
  }

  async getBuild(buildId: string, opts?: { full?: boolean }): Promise<unknown> {
    const qs = opts?.full ? "?full=true" : "";
    return this.get(`/api/v1/builds/${buildId}${qs}`);
  }

  async publishShare(
    buildId: string,
    opts?: { scopedTestId?: string },
  ): Promise<{ shareId: string; slug: string; url: string }> {
    return this.post(`/api/v1/builds/${buildId}/share`, {
      scopedTestId: opts?.scopedTestId ?? null,
    });
  }

  async listBuilds(repoId: string, limit = 10): Promise<unknown[]> {
    return this.get(`/api/v1/repos/${repoId}/builds?limit=${limit}`);
  }

  // --- Tests ---

  async listTests(repoId: string): Promise<unknown[]> {
    return this.get(`/api/v1/repos/${repoId}/tests`);
  }

  async getTest(testId: string): Promise<unknown> {
    return this.get(`/api/v1/tests/${testId}`);
  }

  // --- Functional Areas ---

  async listAreas(repoId: string): Promise<unknown[]> {
    return this.get(`/api/v1/repos/${repoId}/functional-areas`);
  }

  async createArea(data: {
    name: string;
    repositoryId?: string;
    parentId?: string;
  }): Promise<unknown> {
    return this.post("/api/v1/functional-areas", data);
  }

  async updateArea(
    areaId: string,
    data: { name?: string; description?: string; parentId?: string | null },
  ): Promise<unknown> {
    return this.put(`/api/v1/functional-areas/${areaId}`, data);
  }

  async deleteArea(areaId: string): Promise<{ success: boolean }> {
    return this.del(`/api/v1/functional-areas/${areaId}`);
  }

  async listTestsByArea(areaId: string): Promise<unknown[]> {
    return this.get(`/api/v1/functional-areas/${areaId}/tests`);
  }

  // --- Tests (mutations) ---

  async updateTest(
    testId: string,
    data: {
      name?: string;
      code?: string;
      targetUrl?: string;
      functionalAreaId?: string;
      apiDefinition?: Record<string, unknown>;
      quarantined?: boolean;
      executionMode?: "procedural" | "agent";
      viewportOverride?: { width: number; height: number } | null;
      playwrightOverrides?: Record<string, unknown> | null;
      diffOverrides?: Record<string, unknown> | null;
      stabilizationOverrides?: Record<string, unknown> | null;
      setupTestId?: string | null;
      setupScriptId?: string | null;
      setupOverrides?: {
        skippedDefaultStepIds?: string[];
        extraSteps?: Array<{
          stepType: "test" | "script" | "storage_state";
          testId?: string | null;
          scriptId?: string | null;
          storageStateId?: string | null;
        }>;
      } | null;
      teardownOverrides?: {
        skippedDefaultStepIds?: string[];
        extraSteps?: Array<{
          stepType: "test" | "script" | "storage_state";
          testId?: string | null;
          scriptId?: string | null;
          storageStateId?: string | null;
        }>;
      } | null;
    },
  ): Promise<unknown> {
    return this.put(`/api/v1/tests/${testId}`, data);
  }

  // --- Playwright Settings (repo-level) ---

  async getPlaywrightSettings(repoId: string): Promise<unknown> {
    return this.get(`/api/v1/repos/${repoId}/playwright-settings`);
  }

  async updatePlaywrightSettings(
    repoId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.put(`/api/v1/repos/${repoId}/playwright-settings`, data);
  }

  // --- Storage States ---

  async listStorageStates(repoId: string): Promise<unknown[]> {
    return this.get(`/api/v1/repos/${repoId}/storage-states`);
  }

  async getStorageState(
    stateId: string,
    opts?: { includeJson?: boolean },
  ): Promise<unknown> {
    const qs = opts?.includeJson ? "?includeJson=true" : "";
    return this.get(`/api/v1/storage-states/${stateId}${qs}`);
  }

  async createStorageState(
    repoId: string,
    data: {
      name: string;
      storageStateJson: string;
      authFlavor?: string | null;
      tokenLocations?: string[] | null;
      firebaseApiKey?: string | null;
      expiresAt?: string | null;
    },
  ): Promise<unknown> {
    return this.post(`/api/v1/repos/${repoId}/storage-states`, data);
  }

  async deleteStorageState(stateId: string): Promise<{ success: boolean }> {
    return this.del(`/api/v1/storage-states/${stateId}`);
  }

  // --- Setup Scripts ---

  async listSetupScripts(repoId: string): Promise<unknown[]> {
    return this.get(`/api/v1/repos/${repoId}/setup-scripts`);
  }

  async getSetupScript(scriptId: string): Promise<unknown> {
    return this.get(`/api/v1/setup-scripts/${scriptId}`);
  }

  async createSetupScript(
    repoId: string,
    data: {
      name: string;
      type: "playwright" | "api";
      code: string;
      description?: string;
    },
  ): Promise<unknown> {
    return this.post(`/api/v1/repos/${repoId}/setup-scripts`, data);
  }

  async updateSetupScript(
    scriptId: string,
    data: {
      name?: string;
      type?: "playwright" | "api";
      code?: string;
      description?: string | null;
    },
  ): Promise<unknown> {
    return this.put(`/api/v1/setup-scripts/${scriptId}`, data);
  }

  async deleteSetupScript(scriptId: string): Promise<{ success: boolean }> {
    return this.del(`/api/v1/setup-scripts/${scriptId}`);
  }

  async deleteTest(testId: string): Promise<{ success: boolean }> {
    return this.del(`/api/v1/tests/${testId}`);
  }

  // --- Diffs ---

  async getDiff(diffId: string): Promise<unknown> {
    return this.get(`/api/v1/diffs/${diffId}`);
  }

  async approveDiffs(diffIds: string[]): Promise<{ approvedCount: number }> {
    return this.post("/api/v1/diffs/approve", { diffIds });
  }

  async rejectDiffs(diffIds: string[]): Promise<{ rejectedCount: number }> {
    return this.post("/api/v1/diffs/reject", { diffIds });
  }

  async approveDiff(diffId: string): Promise<{ success: boolean }> {
    return this.post(`/api/v1/diffs/${diffId}/approve`);
  }

  async rejectDiff(diffId: string): Promise<{ success: boolean }> {
    return this.post(`/api/v1/diffs/${diffId}/reject`);
  }

  async approveAllDiffs(buildId: string): Promise<{ success: boolean }> {
    return this.post(`/api/v1/builds/${buildId}/approve-all`);
  }

  // --- Background Jobs ---

  async getActiveJobs(): Promise<unknown[]> {
    return this.get("/api/v1/jobs/active");
  }

  async getJob(jobId: string): Promise<unknown> {
    return this.get(`/api/v1/jobs/${jobId}`);
  }

  // --- Coverage ---

  async getCoverage(repoId: string): Promise<unknown> {
    return this.get(`/api/v1/repos/${repoId}/coverage`);
  }

  // --- AI Operations ---

  async createTest(opts: {
    repositoryId: string;
    url?: string;
    prompt?: string;
    functionalAreaId?: string;
  }): Promise<unknown> {
    return this.post("/api/v1/tests/create", opts);
  }

  async createTestDirect(opts: {
    repositoryId: string;
    name: string;
    code?: string;
    functionalAreaId?: string;
    targetUrl?: string;
    description?: string;
    // E1: API tests carry a definition instead of Playwright code.
    testType?: "browser" | "api";
    apiDefinition?: Record<string, unknown>;
  }): Promise<{ id: string; name: string; code: string }> {
    return this.post("/api/v1/tests", opts);
  }

  /** Generate an API test from a prompt/OpenAPI and persist it (E1). */
  async generateApiTest(opts: {
    repositoryId: string;
    name?: string;
    prompt?: string;
    endpoint?: string;
    openapiSpec?: string;
    graphqlSchema?: string;
    functionalAreaId?: string;
  }): Promise<Record<string, unknown>> {
    return this.post("/api/v1/tests/generate-api", opts);
  }

  async healTest(testId: string): Promise<unknown> {
    return this.post(`/api/v1/tests/${testId}/heal`);
  }

  // --- QuickStart agent ---

  async startQuickstart(
    repoId: string,
    opts?: { emailTemplate?: string },
  ): Promise<{ sessionId: string }> {
    return this.post(`/api/v1/repos/${repoId}/quickstart`, {
      emailTemplate: opts?.emailTemplate,
    });
  }

  async getQuickstartStatus(sessionId: string): Promise<{
    id: string;
    kind: "quickstart";
    status: "active" | "paused" | "completed" | "failed" | "cancelled";
    currentStepId: string | null;
    steps: Array<{
      id: string;
      status: string;
      label: string;
      description?: string;
      error?: string;
      result?: Record<string, unknown>;
      startedAt?: string;
      completedAt?: string;
    }>;
    metadata: Record<string, unknown>;
  }> {
    return this.get(`/api/v1/quickstart/${sessionId}`);
  }

  async cancelQuickstart(sessionId: string): Promise<{ success: boolean }> {
    return this.del(`/api/v1/quickstart/${sessionId}`);
  }

  // --- Activity Reporting ---

  // ── Verify phase (v1.14+) ───────────────────────────────────────────────

  async getChangeMap(buildId: string): Promise<unknown> {
    return this.get(`/api/v1/builds/${buildId}/change-map`);
  }

  async verifyBuild(buildId: string): Promise<unknown> {
    return this.get(`/api/v1/builds/${buildId}/verify`);
  }

  async approveLayer(opts: {
    stepComparisonId: string;
    buildId: string;
    layer: string;
    status: "approved" | "rejected" | "snoozed";
    note?: string;
  }): Promise<unknown> {
    return this.post("/api/v1/verify/layer-feedback", opts);
  }

  async reportActivity(data: {
    eventType: string;
    summary: string;
    detail?: Record<string, unknown>;
    toolName?: string;
    durationMs?: number;
    repositoryId?: string;
    artifactType?: string;
    artifactId?: string;
    artifactLabel?: string;
  }): Promise<void> {
    try {
      await this.post("/api/v1/activity", data);
    } catch {
      // Activity reporting is best-effort — never fail the tool call
    }
  }
}
