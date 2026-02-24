/**
 * ReactPanelRenderer — React-based rendering engine for Chrome DevTools panel.
 *
 * Generates React component tree and mounting code for each panel tab,
 * using the DevToolsPanel API for data.
 */

// ── Types ──────────────────────────────────────────────────

export interface ReactPanelConfig {
  /** Theme: 'light' or 'dark' (default: auto-detect) */
  theme?: 'light' | 'dark' | 'auto';
  /** Custom CSS to inject */
  customCSS?: string;
  /** Tab configurations */
  tabs?: ReactPanelTab[];
}

export interface ReactPanelTab {
  id: string;
  label: string;
  icon?: string;
  component: string; // Component name to render
}

export interface ReactPanelFile {
  path: string;
  content: string;
}

// ── Default Tabs ──────────────────────────────────────────

const DEFAULT_TABS: ReactPanelTab[] = [
  { id: 'inspector', label: 'Inspector', component: 'InspectorPanel' },
  { id: 'playground', label: 'Query Playground', component: 'PlaygroundPanel' },
  { id: 'sync', label: 'Sync Monitor', component: 'SyncPanel' },
  { id: 'profiler', label: 'Profiler', component: 'ProfilerPanel' },
  { id: 'conflicts', label: 'Conflicts', component: 'ConflictsPanel' },
  { id: 'timeline', label: 'Timeline', component: 'TimelinePanel' },
];

// ── Generator ─────────────────────────────────────────────

/**
 * Generate the React panel application code.
 */
export function generateReactPanelApp(config: ReactPanelConfig = {}): ReactPanelFile[] {
  const tabs = config.tabs ?? DEFAULT_TABS;
  const files: ReactPanelFile[] = [];

  files.push(generateAppComponent(tabs, config));
  files.push(generateTabBarComponent(tabs));

  for (const tab of tabs) {
    files.push(generateTabComponent(tab));
  }

  files.push(generateMountScript());
  files.push(generateStylesheet(config));

  return files;
}

function generateAppComponent(tabs: ReactPanelTab[], config: ReactPanelConfig): ReactPanelFile {
  const imports = tabs
    .map((t) => `import { ${t.component} } from './${t.id}-panel.js';`)
    .join('\n');
  const cases = tabs
    .map((t) => `      case '${t.id}': return React.createElement(${t.component}, { bridge });`)
    .join('\n');

  return {
    path: 'src/App.tsx',
    content: `import React, { useState } from 'react';
import { TabBar } from './TabBar.js';
${imports}

interface AppProps {
  bridge: unknown;
}

export function App({ bridge }: AppProps) {
  const [activeTab, setActiveTab] = useState('${tabs[0]?.id ?? 'inspector'}');
  const theme = '${config.theme ?? 'auto'}';

  function renderPanel() {
    switch (activeTab) {
${cases}
      default: return React.createElement('div', null, 'Unknown tab');
    }
  }

  return React.createElement('div', { className: \`pocket-devtools theme-\${theme}\` },
    React.createElement(TabBar, { tabs: ${JSON.stringify(tabs.map((t) => ({ id: t.id, label: t.label })))}, activeTab, onTabChange: setActiveTab }),
    React.createElement('div', { className: 'panel-content' }, renderPanel())
  );
}
`,
  };
}

function generateTabBarComponent(_tabs: ReactPanelTab[]): ReactPanelFile {
  return {
    path: 'src/TabBar.tsx',
    content: `import React from 'react';

interface TabBarProps {
  tabs: Array<{ id: string; label: string }>;
  activeTab: string;
  onTabChange: (id: string) => void;
}

export function TabBar({ tabs, activeTab, onTabChange }: TabBarProps) {
  return React.createElement('div', { className: 'tab-bar' },
    ...tabs.map(tab =>
      React.createElement('button', {
        key: tab.id,
        className: \`tab-btn \${activeTab === tab.id ? 'active' : ''}\`,
        onClick: () => onTabChange(tab.id),
      }, tab.label)
    )
  );
}
`,
  };
}

function generateTabComponent(tab: ReactPanelTab): ReactPanelFile {
  return {
    path: `src/${tab.id}-panel.tsx`,
    content: `import React, { useState, useEffect } from 'react';

interface ${tab.component}Props {
  bridge: unknown;
}

export function ${tab.component}({ bridge }: ${tab.component}Props) {
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(false);
    // Connect to DevToolsPanel bridge for real data
    void bridge;
  }, [bridge]);

  if (loading) {
    return React.createElement('div', { className: 'loading' }, 'Loading ${tab.label}...');
  }

  return React.createElement('div', { className: 'panel ${tab.id}-panel' },
    React.createElement('h2', null, '${tab.label}'),
    React.createElement('div', { className: 'panel-body' },
      data ? React.createElement('pre', null, JSON.stringify(data, null, 2))
           : React.createElement('p', null, 'Connect to a Pocket database to get started.')
    )
  );
}
`,
  };
}

function generateMountScript(): ReactPanelFile {
  return {
    path: 'src/index.tsx',
    content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';

// Initialize connection to page via DevTools protocol
const bridge = {}; // Will be populated by content script messages

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(React.createElement(App, { bridge }));
`,
  };
}

function generateStylesheet(config: ReactPanelConfig): ReactPanelFile {
  const custom = config.customCSS ?? '';
  return {
    path: 'src/styles.css',
    content: `/* Pocket DevTools Panel Styles */
:root {
  --bg: #ffffff;
  --fg: #1a1a1a;
  --border: #e0e0e0;
  --accent: #0366d6;
  --hover: #f5f5f5;
}

.theme-dark {
  --bg: #1e1e1e;
  --fg: #d4d4d4;
  --border: #404040;
  --accent: #58a6ff;
  --hover: #2d2d2d;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

.pocket-devtools {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 12px;
  color: var(--fg);
  background: var(--bg);
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.tab-bar {
  display: flex;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}

.tab-btn {
  padding: 8px 16px;
  border: none;
  background: none;
  color: var(--fg);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  font-size: 12px;
}

.tab-btn:hover { background: var(--hover); }
.tab-btn.active { border-bottom-color: var(--accent); color: var(--accent); font-weight: 600; }

.panel-content { flex: 1; overflow: auto; padding: 12px; }
.loading { padding: 20px; text-align: center; color: var(--fg); opacity: 0.6; }

h2 { font-size: 14px; margin-bottom: 8px; }
pre { font-size: 11px; overflow: auto; padding: 8px; background: var(--hover); border-radius: 4px; }

${custom}
`,
  };
}

/**
 * Get the total count of generated files.
 */
export function getReactPanelFileCount(config?: ReactPanelConfig): number {
  const tabs = config?.tabs ?? DEFAULT_TABS;
  return tabs.length + 4; // tabs + App + TabBar + index + styles
}
