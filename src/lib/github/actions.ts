import sodium from 'libsodium-wrappers';

const GITHUB_API = 'https://api.github.com';
const WORKFLOW_PATH = '.github/workflows/lastest2.yml';

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/**
 * Get the SHA of the existing workflow file (if any).
 */
export async function getWorkflowFileSha(
  token: string,
  owner: string,
  repo: string,
): Promise<string | null> {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${WORKFLOW_PATH}`,
    { headers: headers(token) },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.sha as string;
}

/**
 * Create or update the workflow file via GitHub Contents API.
 */
export async function upsertWorkflowFile(
  token: string,
  owner: string,
  repo: string,
  yaml: string,
  existingSha?: string | null,
): Promise<{ sha: string }> {
  const content = Buffer.from(yaml).toString('base64');
  const body: Record<string, string> = {
    message: existingSha
      ? 'Update Lastest2 visual testing workflow'
      : 'Add Lastest2 visual testing workflow',
    content,
  };
  if (existingSha) body.sha = existingSha;

  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${WORKFLOW_PATH}`,
    {
      method: 'PUT',
      headers: headers(token),
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to upsert workflow: ${res.status} ${text}`);
  }

  const data = await res.json();
  return { sha: data.content.sha };
}

/**
 * Encrypt a secret value using the repo's public key and set it via the Secrets API.
 * Uses libsodium sealed-box encryption as required by GitHub.
 */
/**
 * Delete the workflow file from the repo.
 */
export async function deleteWorkflowFile(
  token: string,
  owner: string,
  repo: string,
): Promise<void> {
  const sha = await getWorkflowFileSha(token, owner, repo);
  if (!sha) return; // No workflow file to delete

  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${WORKFLOW_PATH}`,
    {
      method: 'DELETE',
      headers: headers(token),
      body: JSON.stringify({
        message: 'Remove Lastest2 visual testing workflow',
        sha,
      }),
    },
  );

  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete workflow: ${res.status} ${await res.text()}`);
  }
}

/**
 * Delete a repository secret.
 */
export async function deleteRepoSecret(
  token: string,
  owner: string,
  repo: string,
  secretName: string,
): Promise<void> {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/actions/secrets/${secretName}`,
    {
      method: 'DELETE',
      headers: headers(token),
    },
  );

  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete secret ${secretName}: ${res.status} ${await res.text()}`);
  }
}

export async function setRepoSecret(
  token: string,
  owner: string,
  repo: string,
  secretName: string,
  secretValue: string,
): Promise<void> {
  // 1. Get the repo's public key
  const keyRes = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/actions/secrets/public-key`,
    { headers: headers(token) },
  );
  if (!keyRes.ok) {
    throw new Error(`Failed to get public key: ${keyRes.status} ${await keyRes.text()}`);
  }
  const { key, key_id } = await keyRes.json();

  // 2. Encrypt the secret value using libsodium sealed box
  await sodium.ready;
  const binKey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
  const binMsg = sodium.from_string(secretValue);
  const encrypted = sodium.crypto_box_seal(binMsg, binKey);
  const encryptedBase64 = sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);

  // 3. Set the secret
  const setRes = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/actions/secrets/${secretName}`,
    {
      method: 'PUT',
      headers: headers(token),
      body: JSON.stringify({
        encrypted_value: encryptedBase64,
        key_id,
      }),
    },
  );

  if (!setRes.ok) {
    throw new Error(`Failed to set secret ${secretName}: ${setRes.status} ${await setRes.text()}`);
  }
}
