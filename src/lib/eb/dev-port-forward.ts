/**
 * Dev-only helper: bridge cluster-internal EB ports (9223 stream, 9232 CDP) to
 * 127.0.0.1 via `kubectl port-forward`, so `pnpm dev` running on the host can
 * talk to EB pods inside a local k3d cluster.
 *
 * Every export is a no-op unless `EB_DEV_PORT_FORWARD === '1'`. The env var is
 * never set in k8s deployment manifests or the production Dockerfile, so this
 * module contributes nothing in prod even though the register routes import it.
 */
import { execFile, execFileSync, spawn, type ChildProcess } from 'child_process';
import net from 'net';

const ENABLED = process.env.EB_DEV_PORT_FORWARD === '1';
const NAMESPACE = process.env.EB_NAMESPACE || 'lastest';
const STREAM_PORT = 9223;
const CDP_PORT = 9232;

interface Forward {
  streamPort: number;
  cdpPort: number;
  child: ChildProcess;
  ready: Promise<void>;
}

const forwards = new Map<string, Forward>();
let exitHooksInstalled = false;

function installExitHooks() {
  if (exitHooksInstalled) return;
  exitHooksInstalled = true;
  const kill = () => {
    for (const { child } of forwards.values()) {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
    }
    forwards.clear();
  };
  process.on('exit', kill);
  process.on('SIGINT', () => { kill(); process.exit(130); });
  process.on('SIGTERM', () => { kill(); process.exit(143); });
}

function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error('port alloc failed'))));
    });
  });
}

function findPodName(instanceId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'kubectl',
      [
        '-n', NAMESPACE,
        'get', 'pod',
        '-l', `lastest.dev/eb-instance=${instanceId}`,
        '-o', 'jsonpath={.items[0].metadata.name}',
      ],
      { timeout: 10_000 },
      (err, stdout) => {
        if (err) return reject(err);
        const name = stdout.trim();
        if (!name) return reject(new Error(`no pod found for instance ${instanceId}`));
        resolve(name);
      },
    );
  });
}

async function startForward(instanceId: string): Promise<Forward> {
  const [streamPort, cdpPort, podName] = await Promise.all([
    allocatePort(),
    allocatePort(),
    findPodName(instanceId),
  ]);
  const child = spawn('kubectl', [
    '-n', NAMESPACE,
    'port-forward',
    `pod/${podName}`,
    `${streamPort}:${STREAM_PORT}`,
    `${cdpPort}:${CDP_PORT}`,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const ready = new Promise<void>((resolve, reject) => {
    const watchdog = setTimeout(() => reject(new Error(`port-forward for ${instanceId} did not become ready in 15s`)), 15_000);
    let streamReady = false;
    let cdpReady = false;
    const maybeResolve = () => {
      if (streamReady && cdpReady) { clearTimeout(watchdog); resolve(); }
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      const s = chunk.toString('utf8');
      if (s.includes(`127.0.0.1:${streamPort}`)) streamReady = true;
      if (s.includes(`127.0.0.1:${cdpPort}`)) cdpReady = true;
      maybeResolve();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      console.warn(`[EB dev-pf ${instanceId}] ${chunk.toString('utf8').trim()}`);
    });
    child.once('exit', (code) => {
      clearTimeout(watchdog);
      if (!(streamReady && cdpReady)) reject(new Error(`port-forward exited (${code}) before ready`));
    });
  });

  child.once('exit', () => { forwards.delete(instanceId); });

  const fw: Forward = { streamPort, cdpPort, child, ready };
  forwards.set(instanceId, fw);
  console.log(`[EB dev-pf] ${instanceId} → stream=127.0.0.1:${streamPort} cdp=127.0.0.1:${cdpPort} (pod ${podName})`);
  return fw;
}

async function getOrStart(instanceId: string): Promise<Forward> {
  const existing = forwards.get(instanceId);
  if (existing) {
    await existing.ready;
    return existing;
  }
  installExitHooks();
  const fw = await startForward(instanceId);
  try {
    await fw.ready;
  } catch (err) {
    try { fw.child.kill('SIGTERM'); } catch { /* ignore */ }
    forwards.delete(instanceId);
    throw err;
  }
  return fw;
}

/**
 * Rewrite `ws://<podIP>:9223` to `ws://127.0.0.1:<forwardedPort>` so the host
 * dev server can reach the EB. Returns the original URL unchanged in prod or
 * when the flag is off.
 */
export async function rewriteDevStreamUrl(instanceId: string, streamUrl: string | undefined): Promise<string | undefined> {
  if (!ENABLED || !streamUrl) return streamUrl;
  try {
    const fw = await getOrStart(instanceId);
    const u = new URL(streamUrl);
    u.hostname = '127.0.0.1';
    u.port = String(fw.streamPort);
    return u.toString();
  } catch (err) {
    console.warn(`[EB dev-pf] stream rewrite failed for ${instanceId}:`, (err as Error).message);
    return streamUrl;
  }
}

export async function rewriteDevCdpUrl(instanceId: string, cdpUrl: string | undefined): Promise<string | undefined> {
  if (!ENABLED || !cdpUrl) return cdpUrl;
  try {
    const fw = await getOrStart(instanceId);
    const u = new URL(cdpUrl);
    u.hostname = '127.0.0.1';
    u.port = String(fw.cdpPort);
    return u.toString();
  } catch (err) {
    console.warn(`[EB dev-pf] cdp rewrite failed for ${instanceId}:`, (err as Error).message);
    return cdpUrl;
  }
}

/** Kill the port-forward for an instance (on session delete / pod teardown). */
export function stopDevPortForward(instanceId: string): void {
  if (!ENABLED) return;
  const fw = forwards.get(instanceId);
  if (!fw) return;
  try { fw.child.kill('SIGTERM'); } catch { /* ignore */ }
  forwards.delete(instanceId);
}

/**
 * On dev-server boot, orphan port-forward children from a previous run may
 * still hold the free ports we want. `pkill` them defensively. Safe no-op if
 * none are running. Only runs when the flag is enabled.
 */
export function reapOrphanDevPortForwards(): void {
  if (!ENABLED) return;
  try {
    execFileSync('pkill', ['-f', `kubectl.*-n ${NAMESPACE} port-forward pod/`], { stdio: 'ignore' });
  } catch { /* no matches → exit 1, fine */ }
}
