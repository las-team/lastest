/**
 * Embedded Browser Service
 *
 * Entry point for the embedded browser container.
 * Launches Playwright Chromium, starts CDP screencast streaming,
 * and connects to the main Lastest2 app as a runner.
 */

import { chromium, type Browser, type Page, type BrowserContext } from 'playwright';
import { ScreencastManager } from './screencast.js';
import { InputHandler } from './input-handler.js';
import { StreamServer } from './stream-server.js';
import { EmbeddedRunnerClient } from './runner-client.js';

// Configuration from environment
const config = {
  serverUrl: process.env.LASTEST2_URL ?? 'http://localhost:3000',
  token: process.env.LASTEST2_TOKEN ?? '',
  streamPort: parseInt(process.env.STREAM_PORT ?? '9223', 10),
  pollInterval: parseInt(process.env.POLL_INTERVAL ?? '3000', 10),
  viewportWidth: parseInt(process.env.VIEWPORT_WIDTH ?? '1280', 10),
  viewportHeight: parseInt(process.env.VIEWPORT_HEIGHT ?? '720', 10),
  streamAuthToken: process.env.STREAM_AUTH_TOKEN,
};

if (!config.token) {
  console.error('LASTEST2_TOKEN is required');
  process.exit(1);
}

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
let screencast: ScreencastManager | null = null;
let inputHandler: InputHandler | null = null;
let streamServer: StreamServer | null = null;
let runnerClient: EmbeddedRunnerClient | null = null;

async function startup(): Promise<void> {
  console.log('=== Embedded Browser Service ===');
  console.log(`Server: ${config.serverUrl}`);
  console.log(`Stream port: ${config.streamPort}`);
  console.log(`Viewport: ${config.viewportWidth}x${config.viewportHeight}`);

  // 1. Launch browser
  console.log('[Startup] Launching Chromium...');
  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  context = await browser.newContext({
    viewport: { width: config.viewportWidth, height: config.viewportHeight },
  });

  page = await context.newPage();
  await page.goto('about:blank');
  console.log('[Startup] Browser ready');

  // 2. Start stream server
  streamServer = new StreamServer({
    port: config.streamPort,
    authToken: config.streamAuthToken,
  });
  streamServer.start();

  // 3. Start screencast
  screencast = new ScreencastManager({
    maxWidth: config.viewportWidth,
    maxHeight: config.viewportHeight,
    quality: 80,
    format: 'jpeg',
  });

  streamServer.setScreencast(screencast);

  await screencast.start(page, (frame) => {
    streamServer!.broadcastFrame(frame.data, frame.width, frame.height, frame.timestamp);
  });

  // 4. Start input handler
  inputHandler = new InputHandler();
  await inputHandler.attach(page);
  streamServer.setInputHandler(inputHandler);

  // 5. Connect as runner
  runnerClient = new EmbeddedRunnerClient({
    serverUrl: config.serverUrl,
    token: config.token,
    streamPort: config.streamPort,
    pollInterval: config.pollInterval,
  });

  // Handle commands from main app
  runnerClient.onCommand = async (command) => {
    console.log(`[Command] Received: ${command.type}`);
    // Commands are handled by the standard runner protocol
    // The embedded browser's page is already running - commands
    // manipulate it via the runner's test execution path
  };

  await runnerClient.start();
  console.log('[Startup] Fully operational');
}

async function shutdown(): Promise<void> {
  console.log('[Shutdown] Starting...');

  if (runnerClient) {
    await runnerClient.stop();
  }

  if (screencast) {
    await screencast.stop();
  }

  if (inputHandler) {
    await inputHandler.detach();
  }

  if (streamServer) {
    await streamServer.stop();
  }

  if (context) {
    await context.close();
  }

  if (browser) {
    await browser.close();
  }

  console.log('[Shutdown] Complete');
  process.exit(0);
}

// Health check endpoint (simple HTTP on same port + 1)
import { createServer } from 'http';

const healthPort = config.streamPort + 1;
const healthServer = createServer((req, res) => {
  if (req.url === '/health') {
    const healthy = browser?.isConnected() ?? false;
    res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: healthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      browser: healthy ? 'connected' : 'disconnected',
      clients: streamServer?.getClientCount() ?? 0,
      screencast: screencast?.isRunning() ?? false,
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

healthServer.listen(healthPort, () => {
  console.log(`[Health] Listening on port ${healthPort}`);
});

// Graceful shutdown
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start
startup().catch((error) => {
  console.error('Startup failed:', error);
  process.exit(1);
});
