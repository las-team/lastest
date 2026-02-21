import { spawn, ChildProcess } from 'child_process';
import type { EnvironmentConfig } from '@/lib/db/schema';

export interface ServerStatus {
  isRunning: boolean;
  managedByUs: boolean;
  pid?: number;
}

class ServerManager {
  private managedProcess: ChildProcess | null = null;
  private config: EnvironmentConfig | null = null;

  setConfig(config: EnvironmentConfig) {
    this.config = config;
  }

  getConfig(): EnvironmentConfig | null {
    return this.config;
  }

  /**
   * Check if a server is responding at the given URL
   */
  async checkServerHealth(url: string, timeout = 5000): Promise<boolean> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response.ok || response.status < 500;
    } catch {
      clearTimeout(timeoutId);
      return false;
    }
  }

  /**
   * Wait for server to become healthy with retry logic
   */
  async waitForServer(url: string, timeout: number): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 1000; // Check every second

    while (Date.now() - startTime < timeout) {
      const isHealthy = await this.checkServerHealth(url);
      if (isHealthy) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    return false;
  }

  /**
   * Parse a shell command string into [command, ...args], respecting quoted arguments.
   */
  private parseCommand(command: string): string[] {
    const tokens: string[] = [];
    const regex = /"([^"]*?)"|'([^']*?)'|(\S+)/g;
    let match;
    while ((match = regex.exec(command)) !== null) {
      tokens.push(match[1] ?? match[2] ?? match[3]);
    }
    return tokens;
  }

  /**
   * Start a server process with the given command
   */
  async startServer(command: string, cwd?: string): Promise<ChildProcess> {
    return new Promise((resolve, reject) => {
      const [cmd, ...args] = this.parseCommand(command);

      const proc = spawn(cmd, args, {
        cwd: cwd || process.cwd(),
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      // Give it a moment to fail fast if command is invalid
      const failTimer = setTimeout(() => {
        resolve(proc);
      }, 2000);

      proc.on('error', (err) => {
        clearTimeout(failTimer);
        reject(new Error(`Failed to start server: ${err.message}`));
      });

      proc.on('exit', (code) => {
        if (code !== null && code !== 0) {
          clearTimeout(failTimer);
          reject(new Error(`Server process exited with code ${code}`));
        }
      });

      // Collect stderr for debugging
      let stderr = '';
      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // Log stdout for debugging
      proc.stdout?.on('data', (data) => {
        console.log(`[server] ${data.toString().trim()}`);
      });
    });
  }

  /**
   * Ensure server is running before tests
   * Returns true if server is ready, false otherwise
   */
  async ensureServerRunning(): Promise<{ ready: boolean; error?: string }> {
    if (!this.config) {
      return { ready: true }; // No config = assume manual mode
    }

    const healthCheckUrl = this.config.healthCheckUrl || this.config.baseUrl;
    const timeout = this.config.healthCheckTimeout || 60000;

    // Check if server is already running
    const existingServer = await this.checkServerHealth(healthCheckUrl);

    if (existingServer) {
      if (this.config.reuseExistingServer) {
        console.log(`[server-manager] Server already running at ${healthCheckUrl}`);
        return { ready: true };
      } else {
        return {
          ready: false,
          error: `Server already running at ${healthCheckUrl} but reuseExistingServer is disabled`
        };
      }
    }

    // If manual mode, server must be running
    if (this.config.mode === 'manual') {
      return {
        ready: false,
        error: `Server not running at ${healthCheckUrl}. Start your server manually or switch to managed mode.`
      };
    }

    // Managed mode - start the server
    if (!this.config.startCommand) {
      return {
        ready: false,
        error: 'No start command configured for managed mode'
      };
    }

    try {
      console.log(`[server-manager] Starting server with: ${this.config.startCommand}`);
      this.managedProcess = await this.startServer(this.config.startCommand);

      console.log(`[server-manager] Waiting for server at ${healthCheckUrl}...`);
      const isReady = await this.waitForServer(healthCheckUrl, timeout);

      if (!isReady) {
        await this.stopManagedServer();
        return {
          ready: false,
          error: `Server did not become ready within ${timeout}ms`
        };
      }

      console.log(`[server-manager] Server is ready at ${healthCheckUrl}`);
      return { ready: true };

    } catch (error) {
      return {
        ready: false,
        error: error instanceof Error ? error.message : 'Unknown error starting server'
      };
    }
  }

  /**
   * Stop the managed server process if we started one
   */
  async stopManagedServer(): Promise<void> {
    if (this.managedProcess) {
      console.log('[server-manager] Stopping managed server...');
      this.managedProcess.kill('SIGTERM');

      // Wait for graceful shutdown, then force kill
      await new Promise<void>((resolve) => {
        const forceKillTimer = setTimeout(() => {
          if (this.managedProcess && !this.managedProcess.killed) {
            this.managedProcess.kill('SIGKILL');
          }
          resolve();
        }, 5000);

        this.managedProcess?.on('exit', () => {
          clearTimeout(forceKillTimer);
          resolve();
        });
      });

      this.managedProcess = null;
    }
  }

  /**
   * Get status of the server
   */
  async getStatus(): Promise<ServerStatus> {
    if (!this.config) {
      return { isRunning: false, managedByUs: false };
    }

    const healthCheckUrl = this.config.healthCheckUrl || this.config.baseUrl;
    const isRunning = await this.checkServerHealth(healthCheckUrl);

    return {
      isRunning,
      managedByUs: this.managedProcess !== null && !this.managedProcess.killed,
      pid: this.managedProcess?.pid,
    };
  }

  /**
   * Resolve a test URL by substituting the base URL
   * This allows tests to use relative URLs or have their baseUrl swapped at runtime
   */
  resolveUrl(originalUrl: string): string {
    if (!this.config?.baseUrl || !originalUrl) {
      return originalUrl;
    }

    try {
      const original = new URL(originalUrl);
      const configured = new URL(this.config.baseUrl);

      // If the original URL has a different origin, substitute it
      if (original.origin !== configured.origin) {
        return `${configured.origin}${original.pathname}${original.search}${original.hash}`;
      }

      return originalUrl;
    } catch {
      // If URL parsing fails, return original
      return originalUrl;
    }
  }
}

// Singleton instance
let serverManagerInstance: ServerManager | null = null;

export function getServerManager(): ServerManager {
  if (!serverManagerInstance) {
    serverManagerInstance = new ServerManager();
  }
  return serverManagerInstance;
}

export function resetServerManager(): void {
  if (serverManagerInstance) {
    serverManagerInstance.stopManagedServer();
    serverManagerInstance = null;
  }
}
