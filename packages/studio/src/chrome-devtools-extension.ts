/**
 * ChromeDevToolsExtension — Manifest V3-compatible Chrome extension bridge.
 *
 * Generates extension manifest, content script detector, and panel registration
 * that powers the unified Pocket DevTools Chrome extension.
 */

// ── Types ──────────────────────────────────────────────────

export interface ExtensionManifest {
  manifest_version: 3;
  name: string;
  version: string;
  description: string;
  permissions: string[];
  devtools_page: string;
  icons: Record<string, string>;
  content_scripts: {
    matches: string[];
    js: string[];
    run_at: string;
  }[];
}

export interface ExtensionPanelConfig {
  /** Panel title shown in DevTools (default: 'Pocket') */
  title?: string;
  /** Panel icon path */
  iconPath?: string;
  /** Available panel tabs */
  tabs?: ExtensionTab[];
}

export type ExtensionTab =
  | 'inspector'
  | 'playground'
  | 'sync-monitor'
  | 'profiler'
  | 'conflicts'
  | 'timeline';

export interface DetectionResult {
  detected: boolean;
  version: string | null;
  databases: string[];
  collections: string[];
}

export interface PanelMessage {
  type: 'detect' | 'inspect' | 'query' | 'subscribe' | 'profile';
  payload: unknown;
  tabId?: number;
}

export interface PanelResponse {
  type: string;
  success: boolean;
  data: unknown;
  error?: string;
}

// ── Extension Generator ────────────────────────────────────

/**
 * Generate a Chrome Extension Manifest V3 for Pocket DevTools.
 */
export function generateExtensionManifest(version = '0.1.0'): ExtensionManifest {
  return {
    manifest_version: 3,
    name: 'Pocket Database DevTools',
    version,
    description: 'Developer tools for inspecting, querying, and debugging Pocket databases',
    permissions: ['storage'],
    devtools_page: 'devtools.html',
    icons: {
      '16': 'icons/icon-16.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    },
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: ['content-script.js'],
        run_at: 'document_idle',
      },
    ],
  };
}

/**
 * Generate the devtools.html page that registers the panel.
 */
export function generateDevToolsPage(config: ExtensionPanelConfig = {}): string {
  const title = config.title ?? 'Pocket';
  const icon = config.iconPath ?? 'icons/icon-16.png';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<script>
  chrome.devtools.panels.create(
    "${title}",
    "${icon}",
    "panel.html",
    function(panel) {
      console.log("[Pocket DevTools] Panel created");
    }
  );
</script>
</body>
</html>`;
}

/**
 * Generate the content script that detects Pocket databases on the page.
 */
export function generateContentScript(): string {
  return `// Pocket Database Detector
(function() {
  'use strict';

  function detectPocket() {
    const result = {
      detected: false,
      version: null,
      databases: [],
      collections: [],
    };

    // Check for Pocket global
    if (window.__POCKET_DEVTOOLS__) {
      result.detected = true;
      result.version = window.__POCKET_DEVTOOLS__.version || null;
      result.databases = window.__POCKET_DEVTOOLS__.databases || [];
      result.collections = window.__POCKET_DEVTOOLS__.collections || [];
    }

    // Check IndexedDB for Pocket databases
    if (window.indexedDB && window.indexedDB.databases) {
      window.indexedDB.databases().then(function(dbs) {
        var pocketDbs = dbs.filter(function(db) {
          return db.name && db.name.startsWith('pocket_');
        });
        if (pocketDbs.length > 0) {
          result.detected = true;
          result.databases = pocketDbs.map(function(db) { return db.name; });
        }
        window.postMessage({ type: 'POCKET_DETECT_RESULT', payload: result }, '*');
      });
    } else {
      window.postMessage({ type: 'POCKET_DETECT_RESULT', payload: result }, '*');
    }
  }

  // Listen for detection requests from the DevTools panel
  window.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'POCKET_DETECT_REQUEST') {
      detectPocket();
    }
  });

  // Auto-detect on load
  if (document.readyState === 'complete') {
    detectPocket();
  } else {
    window.addEventListener('load', detectPocket);
  }
})();`;
}

/**
 * Generate the panel HTML page with tab navigation.
 */
export function generatePanelHTML(config: ExtensionPanelConfig = {}): string {
  const tabs = config.tabs ?? [
    'inspector',
    'playground',
    'sync-monitor',
    'profiler',
    'conflicts',
    'timeline',
  ];

  const tabButtons = tabs
    .map(
      (tab) =>
        `    <button class="tab-btn" data-tab="${tab}">${tab.replace('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</button>`
    )
    .join('\n');

  const tabPanels = tabs
    .map(
      (tab) =>
        `    <div class="tab-panel" id="panel-${tab}" style="display:none"><h2>${tab.replace('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</h2><div id="${tab}-content"></div></div>`
    )
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Pocket DevTools</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 12px; color: #333; background: #fff; }
    .tabs { display: flex; border-bottom: 1px solid #ddd; background: #f5f5f5; }
    .tab-btn { padding: 8px 16px; border: none; background: none; cursor: pointer; font-size: 12px; border-bottom: 2px solid transparent; }
    .tab-btn.active { border-bottom-color: #0366d6; color: #0366d6; font-weight: 600; }
    .tab-panel { padding: 12px; }
    h2 { font-size: 14px; margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="tabs">
${tabButtons}
  </div>
  <div class="panels">
${tabPanels}
  </div>
  <script src="panel.js"></script>
</body>
</html>`;
}

/**
 * Get all files needed for a complete Chrome extension.
 */
export function generateExtensionFiles(
  version = '0.1.0',
  config: ExtensionPanelConfig = {}
): { path: string; content: string }[] {
  return [
    { path: 'manifest.json', content: JSON.stringify(generateExtensionManifest(version), null, 2) },
    { path: 'devtools.html', content: generateDevToolsPage(config) },
    { path: 'content-script.js', content: generateContentScript() },
    { path: 'panel.html', content: generatePanelHTML(config) },
  ];
}
