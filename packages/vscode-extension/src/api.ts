import * as vscode from 'vscode';
import type { Repository, Test, TestRun, Build, FunctionalArea } from './types';

export class Lastest2Api {
  private serverUrl: string;
  private apiToken: string;

  constructor() {
    const config = vscode.workspace.getConfiguration('lastest2');
    this.serverUrl = config.get('serverUrl', 'http://localhost:3000');
    this.apiToken = config.get('apiToken', '');
  }

  updateConfig() {
    const config = vscode.workspace.getConfiguration('lastest2');
    this.serverUrl = config.get('serverUrl', 'http://localhost:3000');
    this.apiToken = config.get('apiToken', '');
  }

  private async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.serverUrl}/api/v1${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.apiToken) {
      headers['Authorization'] = `Bearer ${this.apiToken}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API Error (${response.status}): ${error}`);
    }

    return response.json();
  }

  // Repositories
  async getRepositories(): Promise<Repository[]> {
    return this.fetch<Repository[]>('/repos');
  }

  async getRepository(id: number): Promise<Repository> {
    return this.fetch<Repository>(`/repos/${id}`);
  }

  // Functional Areas
  async getFunctionalAreas(repoId: number): Promise<FunctionalArea[]> {
    return this.fetch<FunctionalArea[]>(`/repos/${repoId}/functional-areas`);
  }

  // Tests
  async getTests(repoId: number): Promise<Test[]> {
    return this.fetch<Test[]>(`/repos/${repoId}/tests`);
  }

  async getTestsByFunctionalArea(functionalAreaId: number): Promise<Test[]> {
    return this.fetch<Test[]>(`/functional-areas/${functionalAreaId}/tests`);
  }

  async getTest(testId: number): Promise<Test> {
    return this.fetch<Test>(`/tests/${testId}`);
  }

  // Test Runs
  async runTest(testId: number): Promise<TestRun> {
    return this.fetch<TestRun>('/runs', {
      method: 'POST',
      body: JSON.stringify({ testIds: [testId] }),
    });
  }

  async runTests(testIds: number[]): Promise<{ buildId: number }> {
    return this.fetch<{ buildId: number }>('/runs', {
      method: 'POST',
      body: JSON.stringify({ testIds }),
    });
  }

  async runFunctionalArea(functionalAreaId: number): Promise<{ buildId: number }> {
    return this.fetch<{ buildId: number }>('/runs', {
      method: 'POST',
      body: JSON.stringify({ functionalAreaId }),
    });
  }

  async runRepository(repoId: number): Promise<{ buildId: number }> {
    return this.fetch<{ buildId: number }>('/runs', {
      method: 'POST',
      body: JSON.stringify({ repositoryId: repoId }),
    });
  }

  async getTestRun(runId: number): Promise<TestRun> {
    return this.fetch<TestRun>(`/runs/${runId}`);
  }

  // Builds
  async getBuild(buildId: number): Promise<Build> {
    return this.fetch<Build>(`/builds/${buildId}`);
  }

  async getBuilds(repoId: number): Promise<Build[]> {
    return this.fetch<Build[]>(`/repos/${repoId}/builds`);
  }

  // Health check
  async checkConnection(): Promise<boolean> {
    try {
      await this.fetch<{ ok: boolean }>('/health');
      return true;
    } catch {
      return false;
    }
  }

  getServerUrl(): string {
    return this.serverUrl;
  }
}
