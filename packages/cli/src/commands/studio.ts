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
/**
 * Schema visualization HTML template
 */
const SCHEMA_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Schema - Pocket Studio</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
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
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header h1 {
      font-size: 1.5rem;
      font-weight: 600;
    }
    .header h1 span { color: #e94560; }
    .header nav a {
      color: #aaa;
      text-decoration: none;
      margin-left: 1.5rem;
    }
    .header nav a:hover { color: #fff; }
    .header nav a.active { color: #e94560; }
    .container {
      padding: 2rem;
      max-width: 1400px;
      margin: 0 auto;
    }
    .tabs {
      display: flex;
      gap: 1rem;
      margin-bottom: 2rem;
      border-bottom: 1px solid #0f3460;
      padding-bottom: 1rem;
    }
    .tabs button {
      background: none;
      border: none;
      color: #888;
      font-size: 1rem;
      cursor: pointer;
      padding: 0.5rem 1rem;
      border-radius: 4px;
    }
    .tabs button:hover { color: #fff; background: #0f3460; }
    .tabs button.active { color: #e94560; background: #16213e; }
    .diagram-container {
      background: #fff;
      border-radius: 8px;
      padding: 2rem;
      min-height: 400px;
      overflow: auto;
    }
    .mermaid { text-align: center; }
    .code-container {
      background: #0d1117;
      border-radius: 8px;
      padding: 1.5rem;
      overflow: auto;
      display: none;
    }
    .code-container pre {
      margin: 0;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 0.9rem;
      line-height: 1.5;
      color: #c9d1d9;
    }
    .copy-btn {
      position: absolute;
      top: 1rem;
      right: 1rem;
      background: #238636;
      color: #fff;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 4px;
      cursor: pointer;
    }
    .copy-btn:hover { background: #2ea043; }
    .collections-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 1.5rem;
      display: none;
    }
    .collection-card {
      background: #16213e;
      border-radius: 8px;
      padding: 1.5rem;
      border: 1px solid #0f3460;
    }
    .collection-card h3 {
      font-size: 1.1rem;
      margin-bottom: 1rem;
      color: #e94560;
    }
    .field-list {
      list-style: none;
    }
    .field-list li {
      display: flex;
      justify-content: space-between;
      padding: 0.5rem 0;
      border-bottom: 1px solid #0f3460;
    }
    .field-list li:last-child { border-bottom: none; }
    .field-name { font-weight: 500; }
    .field-type { color: #888; font-family: monospace; }
    .required { color: #e94560; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Pocket <span>Studio</span> - Schema</h1>
    <nav>
      <a href="/">Data</a>
      <a href="/schema" class="active">Schema</a>
    </nav>
  </div>
  <div class="container">
    <div class="tabs">
      <button class="active" onclick="showTab('diagram')">ER Diagram</button>
      <button onclick="showTab('collections')">Collections</button>
      <button onclick="showTab('mermaid')">Mermaid Code</button>
    </div>
    <div id="diagram" class="diagram-container">
      <div class="mermaid" id="mermaid-diagram">Loading diagram...</div>
    </div>
    <div id="collections" class="collections-grid"></div>
    <div id="mermaid" class="code-container" style="position:relative;">
      <button class="copy-btn" onclick="copyMermaid()">Copy</button>
      <pre id="mermaid-code">Loading...</pre>
    </div>
  </div>
  <script>
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      er: { useMaxWidth: true }
    });

    let mermaidCode = '';

    // Load schema data
    Promise.all([
      fetch('/api/schema').then(r => r.json()),
      fetch('/api/schema/mermaid').then(r => r.text())
    ]).then(([schema, mermaid]) => {
      mermaidCode = mermaid;

      // Render mermaid diagram
      document.getElementById('mermaid-diagram').innerHTML = mermaid;
      mermaid.run({ nodes: [document.getElementById('mermaid-diagram')] });

      // Render mermaid code
      document.getElementById('mermaid-code').textContent = mermaid;

      // Render collections grid
      const grid = document.getElementById('collections');
      grid.innerHTML = schema.nodes.map(node => \`
        <div class="collection-card">
          <h3>\${node.label}</h3>
          <ul class="field-list">
            \${node.fields.map(f => \`
              <li>
                <span class="field-name">\${f.name}\${f.required ? ' <span class="required">*</span>' : ''}</span>
                <span class="field-type">\${f.type}</span>
              </li>
            \`).join('')}
          </ul>
        </div>
      \`).join('');
    }).catch(err => {
      document.getElementById('mermaid-diagram').textContent = 'Error loading schema: ' + err.message;
    });

    function showTab(tab) {
      document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
      event.target.classList.add('active');

      document.getElementById('diagram').style.display = tab === 'diagram' ? 'block' : 'none';
      document.getElementById('collections').style.display = tab === 'collections' ? 'grid' : 'none';
      document.getElementById('mermaid').style.display = tab === 'mermaid' ? 'block' : 'none';
    }

    function copyMermaid() {
      navigator.clipboard.writeText(mermaidCode);
      event.target.textContent = 'Copied!';
      setTimeout(() => event.target.textContent = 'Copy', 2000);
    }
  </script>
</body>
</html>`;

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

  // Generate schema visualization data
  const generateSchemaData = () => {
    const nodes: {
      id: string;
      label: string;
      fields: { name: string; type: string; required?: boolean }[];
    }[] = [];
    const edges: { from: string; to: string; label: string }[] = [];

    for (const [name, collectionConfig] of Object.entries(config.collections ?? {})) {
      const fields: { name: string; type: string; required?: boolean }[] = [];

      if (collectionConfig.schema?.properties) {
        for (const [fieldName, fieldDef] of Object.entries(collectionConfig.schema.properties)) {
          const def = fieldDef as unknown as Record<string, unknown>;
          const fieldType = typeof def.type === 'string' ? def.type : 'unknown';
          fields.push({
            name: fieldName,
            type: fieldType,
            required: def.required === true,
          });

          // Detect relationships (fields ending with Id or containing 'ref')
          if (fieldName.endsWith('Id') || fieldName.endsWith('_id')) {
            const targetCollection = fieldName.replace(/Id$|_id$/, '');
            const pluralTarget = targetCollection + 's';
            const matchedTarget = Object.keys(config.collections ?? {}).find(
              (c) =>
                c === targetCollection ||
                c === pluralTarget ||
                c.toLowerCase() === targetCollection.toLowerCase()
            );
            if (matchedTarget) {
              edges.push({ from: name, to: matchedTarget, label: fieldName });
            }
          }
        }
      }

      nodes.push({ id: name, label: name, fields });
    }

    return { nodes, edges };
  };

  // Generate Mermaid ER diagram
  const generateMermaidDiagram = () => {
    const schemaData = generateSchemaData();
    const lines: string[] = ['erDiagram'];

    for (const node of schemaData.nodes) {
      lines.push(`    ${node.id} {`);
      for (const field of node.fields) {
        const reqMark = field.required ? 'PK' : '';
        lines.push(`        ${field.type} ${field.name} ${reqMark}`.trimEnd());
      }
      lines.push('    }');
    }

    for (const edge of schemaData.edges) {
      lines.push(`    ${edge.from} ||--o{ ${edge.to} : "${edge.label}"`);
    }

    return lines.join('\n');
  };

  // Create simple HTTP server
  const server = http.createServer((req, res) => {
    if (req.url === '/api/collections') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(collections));
    } else if (req.url === '/api/config') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(config));
    } else if (req.url === '/api/schema') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(generateSchemaData()));
    } else if (req.url === '/api/schema/mermaid') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(generateMermaidDiagram());
    } else if (req.url === '/schema') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(SCHEMA_HTML);
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
