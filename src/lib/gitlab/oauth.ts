const GITLAB_CLIENT_ID = process.env.GITLAB_CLIENT_ID || '';
const GITLAB_CLIENT_SECRET = process.env.GITLAB_CLIENT_SECRET || '';
const GITLAB_REDIRECT_URI = process.env.GITLAB_REDIRECT_URI || 'http://localhost:3000/api/auth/gitlab/callback';
const DEFAULT_GITLAB_INSTANCE = process.env.GITLAB_INSTANCE_URL || 'https://gitlab.com';

export function getGitLabAuthUrl(state?: string, instanceUrl?: string): string {
  const baseUrl = instanceUrl || DEFAULT_GITLAB_INSTANCE;
  const params = new URLSearchParams({
    client_id: GITLAB_CLIENT_ID,
    redirect_uri: GITLAB_REDIRECT_URI,
    response_type: 'code',
    scope: 'api read_user read_repository',
    state: state || crypto.randomUUID(),
  });

  return `${baseUrl}/oauth/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string, instanceUrl?: string): Promise<{
  access_token: string;
  token_type: string;
  refresh_token?: string;
  expires_in?: number;
  created_at?: number;
} | null> {
  const baseUrl = instanceUrl || DEFAULT_GITLAB_INSTANCE;

  try {
    const response = await fetch(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: GITLAB_CLIENT_ID,
        client_secret: GITLAB_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: GITLAB_REDIRECT_URI,
      }),
    });

    if (!response.ok) return null;

    return response.json();
  } catch {
    return null;
  }
}

export async function refreshAccessToken(refreshToken: string, instanceUrl?: string): Promise<{
  access_token: string;
  token_type: string;
  refresh_token?: string;
  expires_in?: number;
  created_at?: number;
} | null> {
  const baseUrl = instanceUrl || DEFAULT_GITLAB_INSTANCE;

  try {
    const response = await fetch(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: GITLAB_CLIENT_ID,
        client_secret: GITLAB_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) return null;

    return response.json();
  } catch {
    return null;
  }
}

export async function getGitLabUser(accessToken: string, instanceUrl?: string): Promise<{
  id: number;
  username: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
} | null> {
  const baseUrl = instanceUrl || DEFAULT_GITLAB_INSTANCE;

  try {
    const response = await fetch(`${baseUrl}/api/v4/user`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) return null;

    return response.json();
  } catch {
    return null;
  }
}

export interface GitLabProject {
  id: number;
  name: string;
  path_with_namespace: string; // e.g., "owner/repo"
  namespace: { path: string };
  default_branch: string;
  visibility: string; // 'private' | 'internal' | 'public'
  web_url: string;
}

export async function getUserProjects(accessToken: string, instanceUrl?: string): Promise<GitLabProject[]> {
  const baseUrl = instanceUrl || DEFAULT_GITLAB_INSTANCE;

  try {
    const response = await fetch(
      `${baseUrl}/api/v4/projects?membership=true&per_page=100&order_by=updated_at`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) return [];

    return response.json();
  } catch {
    return [];
  }
}

export interface GitLabBranch {
  name: string;
  commit: { id: string };
  protected: boolean;
  default: boolean;
}

export async function getProjectBranches(
  accessToken: string,
  projectId: number,
  instanceUrl?: string
): Promise<GitLabBranch[]> {
  const baseUrl = instanceUrl || DEFAULT_GITLAB_INSTANCE;

  try {
    const response = await fetch(
      `${baseUrl}/api/v4/projects/${projectId}/repository/branches?per_page=100`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) return [];

    return response.json();
  } catch {
    return [];
  }
}

export interface GitLabMergeRequest {
  id: number;
  iid: number; // Internal ID (used in URLs and API calls)
  title: string;
  state: 'opened' | 'closed' | 'merged';
  source_branch: string;
  target_branch: string;
  sha: string;
  web_url: string;
}

export async function getOpenMRsForBranch(
  accessToken: string,
  projectId: number,
  branch: string,
  instanceUrl?: string
): Promise<GitLabMergeRequest[]> {
  const baseUrl = instanceUrl || DEFAULT_GITLAB_INSTANCE;

  try {
    const response = await fetch(
      `${baseUrl}/api/v4/projects/${projectId}/merge_requests?source_branch=${encodeURIComponent(branch)}&state=opened`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) return [];

    return response.json();
  } catch {
    return [];
  }
}

export function getDefaultInstanceUrl(): string {
  return DEFAULT_GITLAB_INSTANCE;
}
