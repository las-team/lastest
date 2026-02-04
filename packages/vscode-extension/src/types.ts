// API Response types

export interface Repository {
  id: number;
  name: string;
  fullName: string;
  localPath: string | null;
}

export interface FunctionalArea {
  id: number;
  name: string;
  repositoryId: number;
}

export interface Test {
  id: number;
  name: string;
  functionalAreaId: number;
  targetUrl: string;
  code: string;
  lastRunStatus: 'passed' | 'failed' | 'running' | null;
  lastRunAt: string | null;
}

export interface TestRun {
  id: number;
  testId: number;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'error';
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  consoleOutput: string | null;
}

export interface Build {
  id: number;
  repositoryId: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  totalTests: number;
  passedTests: number;
  failedTests: number;
  createdAt: string;
}

// Tree item types
export type TreeItemType = 'repository' | 'functionalArea' | 'test';

export interface TestTreeItem {
  type: TreeItemType;
  id: number;
  name: string;
  status?: 'passed' | 'failed' | 'running' | null;
  children?: TestTreeItem[];
  parentId?: number;
  lastRunAt?: string | null;
}

// WebSocket message types
export interface WSMessage {
  type: 'test:start' | 'test:progress' | 'test:complete' | 'build:start' | 'build:complete' | 'connected';
  payload: Record<string, unknown>;
}

export interface TestProgressPayload {
  testId: number;
  runId: number;
  step: string;
  progress: number;
}

export interface TestCompletePayload {
  testId: number;
  runId: number;
  status: 'passed' | 'failed' | 'error';
  errorMessage?: string;
  duration: number;
}
