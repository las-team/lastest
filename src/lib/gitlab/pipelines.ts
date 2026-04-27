// GitLab REST API helpers for managing project files, variables, hooks, schedules.
// Mirrors src/lib/github/actions.ts but for GitLab — no libsodium needed
// (GitLab variable values are sent in plaintext over HTTPS).

const CI_FILE_PATH = '.gitlab-ci.yml';

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function projectIdParam(id: number | string): string {
  return encodeURIComponent(String(id));
}

function fileParam(path: string): string {
  return encodeURIComponent(path);
}

interface RepoFileMeta {
  file_path: string;
  branch: string;
  commit_id: string;
  blob_id: string;
}

/**
 * Fetch the metadata of an existing file at the given branch.
 * Returns null if the file does not exist (404).
 */
export async function getCiFileMeta(
  token: string,
  instanceUrl: string,
  projectId: number,
  ref: string,
): Promise<RepoFileMeta | null> {
  const res = await fetch(
    `${instanceUrl}/api/v4/projects/${projectIdParam(projectId)}/repository/files/${fileParam(CI_FILE_PATH)}?ref=${encodeURIComponent(ref)}`,
    { headers: authHeaders(token) },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitLab API error fetching file: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Create or update the .gitlab-ci.yml on the given branch.
 */
export async function upsertCiFile(
  token: string,
  instanceUrl: string,
  projectId: number,
  branch: string,
  yaml: string,
): Promise<{ created: boolean }> {
  const existing = await getCiFileMeta(token, instanceUrl, projectId, branch);
  const url = `${instanceUrl}/api/v4/projects/${projectIdParam(projectId)}/repository/files/${fileParam(CI_FILE_PATH)}`;
  const body = {
    branch,
    content: yaml,
    commit_message: existing
      ? 'Update Lastest visual testing pipeline'
      : 'Add Lastest visual testing pipeline',
  };
  const method = existing ? 'PUT' : 'POST';
  const res = await fetch(url, {
    method,
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Failed to upsert .gitlab-ci.yml: ${res.status} ${await res.text()}`);
  }
  return { created: !existing };
}

export async function deleteCiFile(
  token: string,
  instanceUrl: string,
  projectId: number,
  branch: string,
): Promise<void> {
  const res = await fetch(
    `${instanceUrl}/api/v4/projects/${projectIdParam(projectId)}/repository/files/${fileParam(CI_FILE_PATH)}`,
    {
      method: 'DELETE',
      headers: authHeaders(token),
      body: JSON.stringify({
        branch,
        commit_message: 'Remove Lastest visual testing pipeline',
      }),
    },
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete .gitlab-ci.yml: ${res.status} ${await res.text()}`);
  }
}

/**
 * Set or update a project-scoped CI variable.
 */
export async function setProjectVariable(
  token: string,
  instanceUrl: string,
  projectId: number,
  key: string,
  value: string,
  opts?: { masked?: boolean; protected?: boolean },
): Promise<void> {
  const masked = opts?.masked ?? true;
  const isProtected = opts?.protected ?? false;
  const exists = await checkProjectVariableExists(token, instanceUrl, projectId, key);
  const url = exists
    ? `${instanceUrl}/api/v4/projects/${projectIdParam(projectId)}/variables/${encodeURIComponent(key)}`
    : `${instanceUrl}/api/v4/projects/${projectIdParam(projectId)}/variables`;
  const method = exists ? 'PUT' : 'POST';
  const res = await fetch(url, {
    method,
    headers: authHeaders(token),
    body: JSON.stringify({
      key,
      value,
      masked,
      protected: isProtected,
      variable_type: 'env_var',
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to set project variable ${key}: ${res.status} ${await res.text()}`);
  }
}

export async function deleteProjectVariable(
  token: string,
  instanceUrl: string,
  projectId: number,
  key: string,
): Promise<void> {
  const res = await fetch(
    `${instanceUrl}/api/v4/projects/${projectIdParam(projectId)}/variables/${encodeURIComponent(key)}`,
    { method: 'DELETE', headers: authHeaders(token) },
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete project variable ${key}: ${res.status} ${await res.text()}`);
  }
}

export async function checkProjectVariableExists(
  token: string,
  instanceUrl: string,
  projectId: number,
  key: string,
): Promise<boolean> {
  const res = await fetch(
    `${instanceUrl}/api/v4/projects/${projectIdParam(projectId)}/variables/${encodeURIComponent(key)}`,
    { headers: authHeaders(token) },
  );
  return res.status === 200;
}

interface ProjectHook {
  id: number;
  url: string;
  push_events: boolean;
  merge_requests_events: boolean;
}

/**
 * Create or update a project hook pointing at the Lastest webhook URL.
 */
export async function upsertProjectHook(
  token: string,
  instanceUrl: string,
  projectId: number,
  hookUrl: string,
  secretToken: string,
  events: { push?: boolean; merge_request?: boolean } = { push: true, merge_request: true },
): Promise<ProjectHook> {
  const listRes = await fetch(
    `${instanceUrl}/api/v4/projects/${projectIdParam(projectId)}/hooks`,
    { headers: authHeaders(token) },
  );
  if (!listRes.ok) {
    throw new Error(`Failed to list project hooks: ${listRes.status} ${await listRes.text()}`);
  }
  const hooks: ProjectHook[] = await listRes.json();
  const existing = hooks.find(h => h.url === hookUrl);

  const body = {
    url: hookUrl,
    token: secretToken,
    push_events: !!events.push,
    merge_requests_events: !!events.merge_request,
    enable_ssl_verification: true,
  };

  const url = existing
    ? `${instanceUrl}/api/v4/projects/${projectIdParam(projectId)}/hooks/${existing.id}`
    : `${instanceUrl}/api/v4/projects/${projectIdParam(projectId)}/hooks`;
  const method = existing ? 'PUT' : 'POST';
  const res = await fetch(url, {
    method,
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Failed to upsert project hook: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function deleteProjectHook(
  token: string,
  instanceUrl: string,
  projectId: number,
  hookUrl: string,
): Promise<void> {
  const listRes = await fetch(
    `${instanceUrl}/api/v4/projects/${projectIdParam(projectId)}/hooks`,
    { headers: authHeaders(token) },
  );
  if (!listRes.ok) return;
  const hooks: ProjectHook[] = await listRes.json();
  const existing = hooks.find(h => h.url === hookUrl);
  if (!existing) return;
  await fetch(
    `${instanceUrl}/api/v4/projects/${projectIdParam(projectId)}/hooks/${existing.id}`,
    { method: 'DELETE', headers: authHeaders(token) },
  );
}

interface PipelineSchedule {
  id: number;
  description: string;
  ref: string;
  cron: string;
  active: boolean;
}

/**
 * Create or update a Lastest-managed pipeline schedule.
 */
export async function upsertPipelineSchedule(
  token: string,
  instanceUrl: string,
  projectId: number,
  cron: string,
  ref: string,
): Promise<PipelineSchedule> {
  const description = 'Lastest scheduled visual tests';
  const listRes = await fetch(
    `${instanceUrl}/api/v4/projects/${projectIdParam(projectId)}/pipeline_schedules`,
    { headers: authHeaders(token) },
  );
  const schedules: PipelineSchedule[] = listRes.ok ? await listRes.json() : [];
  const existing = schedules.find(s => s.description === description);

  const body = { description, ref, cron, active: true };
  const url = existing
    ? `${instanceUrl}/api/v4/projects/${projectIdParam(projectId)}/pipeline_schedules/${existing.id}`
    : `${instanceUrl}/api/v4/projects/${projectIdParam(projectId)}/pipeline_schedules`;
  const method = existing ? 'PUT' : 'POST';
  const res = await fetch(url, {
    method,
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Failed to upsert pipeline schedule: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function deletePipelineSchedule(
  token: string,
  instanceUrl: string,
  projectId: number,
): Promise<void> {
  const description = 'Lastest scheduled visual tests';
  const listRes = await fetch(
    `${instanceUrl}/api/v4/projects/${projectIdParam(projectId)}/pipeline_schedules`,
    { headers: authHeaders(token) },
  );
  if (!listRes.ok) return;
  const schedules: PipelineSchedule[] = await listRes.json();
  const existing = schedules.find(s => s.description === description);
  if (!existing) return;
  await fetch(
    `${instanceUrl}/api/v4/projects/${projectIdParam(projectId)}/pipeline_schedules/${existing.id}`,
    { method: 'DELETE', headers: authHeaders(token) },
  );
}

interface Pipeline {
  id: number;
  status: string;
  ref: string;
  sha: string;
  web_url: string;
  created_at: string;
  updated_at: string;
}

export async function getLatestPipeline(
  token: string,
  instanceUrl: string,
  projectId: number,
  ref?: string,
): Promise<Pipeline | null> {
  const params = new URLSearchParams({ per_page: '1' });
  if (ref) params.set('ref', ref);
  const res = await fetch(
    `${instanceUrl}/api/v4/projects/${projectIdParam(projectId)}/pipelines?${params}`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) return null;
  const data: Pipeline[] = await res.json();
  return data[0] ?? null;
}
