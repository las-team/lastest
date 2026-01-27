import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface InspectorSession {
  sessionId: string;
  process: ChildProcess;
  outputFile: string;
  startedAt: Date;
  url: string;
}

// Singleton map to track active inspector sessions
const activeSessions = new Map<string, InspectorSession>();

export interface InspectorOptions {
  browser?: 'chromium' | 'firefox' | 'webkit';
  viewport?: { width: number; height: number };
}

/**
 * Launch Playwright Inspector (codegen) for a recording session
 */
export async function launchInspector(
  sessionId: string,
  url: string,
  options: InspectorOptions = {}
): Promise<{ success: boolean; error?: string }> {
  // Check if session already exists
  if (activeSessions.has(sessionId)) {
    return { success: false, error: 'Session already exists' };
  }

  // Create temp file for output
  const tmpDir = os.tmpdir();
  const outputFile = path.join(tmpDir, `pw-inspector-${sessionId}.js`);

  // Build codegen command args
  const args = ['playwright', 'codegen'];

  // Add output file
  args.push('--output', outputFile);

  // Add browser if specified
  if (options.browser && options.browser !== 'chromium') {
    args.push('--browser', options.browser);
  }

  // Add viewport if specified
  if (options.viewport) {
    args.push('--viewport-size', `${options.viewport.width},${options.viewport.height}`);
  }

  // Add the target URL
  args.push(url);

  try {
    // Spawn the process
    const proc = spawn('npx', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    // Store the session
    activeSessions.set(sessionId, {
      sessionId,
      process: proc,
      outputFile,
      startedAt: new Date(),
      url,
    });

    // Handle process exit
    proc.on('exit', (code) => {
      console.log(`Inspector session ${sessionId} exited with code ${code}`);
    });

    proc.on('error', (err) => {
      console.error(`Inspector session ${sessionId} error:`, err);
      activeSessions.delete(sessionId);
    });

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to launch inspector';
    return { success: false, error: message };
  }
}

/**
 * Check if an inspector session is still running
 */
export function isInspectorRunning(sessionId: string): boolean {
  const session = activeSessions.get(sessionId);
  if (!session) return false;

  // Check if process is still alive
  try {
    // Sending signal 0 checks if process exists without killing it
    process.kill(session.process.pid!, 0);
    return true;
  } catch {
    // Process doesn't exist
    return false;
  }
}

/**
 * Get the generated code from an inspector session
 */
export function getInspectorOutput(sessionId: string): { code: string | null; error?: string } {
  const session = activeSessions.get(sessionId);
  if (!session) {
    return { code: null, error: 'Session not found' };
  }

  try {
    if (fs.existsSync(session.outputFile)) {
      const code = fs.readFileSync(session.outputFile, 'utf-8');
      return { code };
    }
    return { code: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read output';
    return { code: null, error: message };
  }
}

/**
 * Cancel/kill an inspector session
 */
export function cancelInspector(sessionId: string): { success: boolean; error?: string } {
  const session = activeSessions.get(sessionId);
  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  try {
    // Kill the process
    session.process.kill('SIGTERM');

    // Clean up temp file
    if (fs.existsSync(session.outputFile)) {
      fs.unlinkSync(session.outputFile);
    }

    activeSessions.delete(sessionId);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to cancel inspector';
    return { success: false, error: message };
  }
}

/**
 * Clean up a session (remove from map, optionally clean temp file)
 */
export function cleanupSession(sessionId: string, keepOutput = false): void {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  if (!keepOutput && fs.existsSync(session.outputFile)) {
    try {
      fs.unlinkSync(session.outputFile);
    } catch {
      // Ignore cleanup errors
    }
  }

  activeSessions.delete(sessionId);
}

/**
 * Get session info
 */
export function getSessionInfo(sessionId: string): {
  exists: boolean;
  isRunning: boolean;
  startedAt?: Date;
  url?: string;
} {
  const session = activeSessions.get(sessionId);
  if (!session) {
    return { exists: false, isRunning: false };
  }

  return {
    exists: true,
    isRunning: isInspectorRunning(sessionId),
    startedAt: session.startedAt,
    url: session.url,
  };
}
