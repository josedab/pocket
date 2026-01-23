/**
 * CLI for Zero-Config Sync Server
 */

import { createMemoryStorage } from './storage/memory-storage.js';
import { createSyncServer } from './sync-server.js';

/**
 * Parse command line arguments
 */
function parseArgs(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];

      if (nextArg && !nextArg.startsWith('--')) {
        result[key] = nextArg;
        i++;
      } else {
        result[key] = true;
      }
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1);
      const nextArg = args[i + 1];

      if (nextArg && !nextArg.startsWith('-')) {
        result[key] = nextArg;
        i++;
      } else {
        result[key] = true;
      }
    }
  }

  return result;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Pocket Sync Server - Zero-config sync backend for Pocket

Usage: pocket-sync [options]

Options:
  -p, --port <port>     Port to listen on (default: 8080)
  -h, --host <host>     Host to bind to (default: 0.0.0.0)
  --path <path>         WebSocket path (default: /sync)
  --auth                Require authentication
  --debug               Enable debug logging
  --help                Show this help message
  --version             Show version

Examples:
  pocket-sync                           Start with defaults
  pocket-sync --port 3000               Start on port 3000
  pocket-sync --host localhost -p 8080  Bind to localhost:8080
  pocket-sync --debug                   Enable debug logging

Environment Variables:
  POCKET_SYNC_PORT     Port number
  POCKET_SYNC_HOST     Host address
  POCKET_SYNC_AUTH     Require auth (true/false)
`);
}

/**
 * Print version
 */
function printVersion(): void {
  console.log('pocket-sync v1.0.0');
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Handle help and version
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.version) {
    printVersion();
    process.exit(0);
  }

  // Parse configuration
  const port = parseInt(
    (args.port as string) ?? (args.p as string) ?? process.env.POCKET_SYNC_PORT ?? '8080',
    10
  );

  const host =
    (args.host as string) ?? (args.h as string) ?? process.env.POCKET_SYNC_HOST ?? '0.0.0.0';

  const path = (args.path as string) ?? '/sync';
  const requireAuth = args.auth === true || process.env.POCKET_SYNC_AUTH === 'true';
  const logging = args.debug ? 'debug' : 'info';

  // Create and start server
  const server = createSyncServer({
    port,
    host,
    path,
    requireAuth,
    logging: logging,
    storage: createMemoryStorage(),
  });

  // Handle shutdown
  const shutdown = async (): Promise<void> => {
    console.log('\nShutting down...');
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  // Start server
  try {
    await server.start();

    console.log(`
╔════════════════════════════════════════════════════════════╗
║                  Pocket Sync Server                        ║
╠════════════════════════════════════════════════════════════╣
║  Status:    Running                                        ║
║  Address:   ws://${host}:${port}${path.padEnd(30)}║
║  Auth:      ${requireAuth ? 'Required' : 'Disabled'}                                       ║
╚════════════════════════════════════════════════════════════╝

Press Ctrl+C to stop
`);

    // Log events
    server.onEvent((event) => {
      if (args.debug) {
        console.log(`[${event.type}]`, event.clientId ?? '', event.data ?? '');
      } else if (event.type === 'client_connected') {
        console.log(`Client connected: ${event.clientId}`);
      } else if (event.type === 'client_disconnected') {
        console.log(`Client disconnected: ${event.clientId}`);
      }
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Run
void main();
