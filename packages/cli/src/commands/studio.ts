/**
 * @pocket/cli - Studio Command
 *
 * Launches a web UI for data inspection.
 *
 * @module @pocket/cli/commands
 */

import * as http from 'node:http';
import { loadProjectConfig } from '../config/loader.js';

/**
 * Studio options
 */
export interface StudioOptions {
  /** Port to run on */
  port?: number;
  /** Open browser automatically */
  open?: boolean;
  /** Working directory */
  cwd?: string;
}

/**
 * Simple HTML template for studio
 */
const STUDIO_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pocket Studio</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #eee;
      min-height: 100vh;
    }
    .header {
      background: #16213e;
      padding: 1rem 2rem;
      border-bottom: 1px solid #0f3460;
    }
    .header h1 {
      font-size: 1.5rem;
      font-weight: 600;
    }
    .header h1 span { color: #e94560; }
    .container {
      display: flex;
      min-height: calc(100vh - 60px);
    }
    .sidebar {
      width: 250px;
      background: #16213e;
      border-right: 1px solid #0f3460;
      padding: 1rem;
    }
    .sidebar h2 {
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #888;
      margin-bottom: 0.5rem;
    }
    .collection-list {
      list-style: none;
    }
    .collection-list li {
      padding: 0.5rem;
      border-radius: 4px;
      cursor: pointer;
      margin-bottom: 2px;
    }
    .collection-list li:hover {
      background: #0f3460;
    }
    .collection-list li.active {
      background: #e94560;
    }
    .main {
      flex: 1;
      padding: 2rem;
    }
    .empty-state {
      text-align: center;
      padding: 4rem;
      color: #666;
    }
    .empty-state svg {
      width: 64px;
      height: 64px;
      margin-bottom: 1rem;
      opacity: 0.5;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Pocket <span>Studio</span></h1>
  </div>
  <div class="container">
    <div class="sidebar">
      <h2>Collections</h2>
      <ul class="collection-list" id="collections">
        <li>Loading...</li>
      </ul>
    </div>
    <div class="main">
      <div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
        </svg>
        <p>Select a collection to explore your data</p>
      </div>
    </div>
  </div>
  <script>
    // Load collections from config
    fetch('/api/collections')
      .then(r => r.json())
      .then(collections => {
        const list = document.getElementById('collections');
        list.innerHTML = collections.map(c =>
          '<li onclick="selectCollection(\\'' + c + '\\')">' + c + '</li>'
        ).join('') || '<li>No collections found</li>';
      })
      .catch(() => {
        document.getElementById('collections').innerHTML = '<li>Error loading collections</li>';
      });

    function selectCollection(name) {
      document.querySelectorAll('.collection-list li').forEach(li => li.classList.remove('active'));
      event.target.classList.add('active');
      document.querySelector('.main').innerHTML = '<h2 style="margin-bottom:1rem">' + name + '</h2><p>Collection viewer coming soon...</p>';
    }
  </script>
</body>
</html>`;

/**
 * Launch the studio server
 *
 * @param options - Studio options
 */
export async function studio(options: StudioOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  // Load config
  const config = await loadProjectConfig(cwd);
  if (!config) {
    console.error('Error: No pocket.config.ts found. Run "pocket init" first.');
    process.exit(1);
  }

  const port = options.port ?? config.studio?.port ?? 4983;
  const collections = Object.keys(config.collections ?? {});

  // Create simple HTTP server
  const server = http.createServer((req, res) => {
    if (req.url === '/api/collections') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(collections));
    } else if (req.url === '/api/config') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(config));
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(STUDIO_HTML);
    }
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                      Pocket Studio                          ║
╠════════════════════════════════════════════════════════════╣
║  Database:  ${config.database.name.padEnd(45)}║
║  URL:       ${url.padEnd(45)}║
║  Collections: ${String(collections.length).padEnd(43)}║
╚════════════════════════════════════════════════════════════╝

Press Ctrl+C to stop
`);

    // Open browser if requested
    if (options.open !== false) {
      const openCommand =
        process.platform === 'darwin'
          ? 'open'
          : process.platform === 'win32'
            ? 'start'
            : 'xdg-open';
      void import('node:child_process').then(({ exec }) => {
        exec(`${openCommand} ${url}`);
      });
    }
  });

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down studio...');
    server.close();
    process.exit(0);
  });
}
