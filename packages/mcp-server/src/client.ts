/**
 * HTTP client for Lastest2 REST API v1.
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
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
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
      'Content-Type': 'application/json',
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Lastest2 API error ${res.status}: ${text || res.statusText}`);
    }

    return res.json() as Promise<T>;
  }

  private get<T = unknown>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  private post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  // --- Health ---

  async health(): Promise<{ ok: boolean }> {
    return this.get('/api/v1/health');
  }

  // --- Repositories ---

  async listRepos(): Promise<unknown[]> {
    return this.get('/api/v1/repos');
  }

  async getRepo(repoId: string): Promise<unknown> {
    return this.get(`/api/v1/repos/${repoId}`);
  }

  // --- Builds ---

  async createBuild(opts: {
    repositoryId?: string;
    triggerType?: string;
    testIds?: string[];
    gitBranch?: string;
  }): Promise<{ buildId: string; testRunId: string; testCount: number }> {
    return this.post('/api/builds/create', {
      repositoryId: opts.repositoryId,
      triggerType: opts.triggerType ?? 'manual',
      gitBranch: opts.gitBranch,
      testIds: opts.testIds,
    });
  }

  async getBuild(buildId: string): Promise<unknown> {
    return this.get(`/api/v1/builds/${buildId}`);
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

  // --- Diffs ---

  async approveDiffs(diffIds: string[]): Promise<{ approvedCount: number }> {
    return this.post('/api/v1/diffs/approve', { diffIds });
  }

  async rejectDiffs(diffIds: string[]): Promise<{ rejectedCount: number }> {
    return this.post('/api/v1/diffs/reject', { diffIds });
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
    return this.post('/api/v1/tests/create', opts);
  }

  async healTest(testId: string): Promise<unknown> {
    return this.post(`/api/v1/tests/${testId}/heal`);
  }
}
