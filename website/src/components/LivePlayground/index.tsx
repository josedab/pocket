/**
 * Live Playground Component — Browser-based REPL for Pocket documentation.
 *
 * Provides an interactive code editor with execution, pre-loaded datasets,
 * and shareable URL-encoded snippets.
 */

import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './LivePlayground.module.css';

interface OutputEntry {
  id: number;
  code: string;
  output: string[];
  error: string | null;
  executionTimeMs: number;
}

interface DatasetInfo {
  name: string;
  description: string;
  setupCode: string;
}

const DATASETS: DatasetInfo[] = [
  {
    name: 'None',
    description: 'Empty playground',
    setupCode: '',
  },
  {
    name: 'E-Commerce',
    description: 'Products, orders, users',
    setupCode: `// Pre-loaded e-commerce dataset
const products = [
  { id: 'p1', name: 'Wireless Headphones', category: 'electronics', price: 79.99, rating: 4.5, inStock: true },
  { id: 'p2', name: 'USB-C Cable', category: 'electronics', price: 12.99, rating: 4.2, inStock: true },
  { id: 'p3', name: 'Standing Desk', category: 'furniture', price: 449.00, rating: 4.8, inStock: false },
  { id: 'p4', name: 'Mechanical Keyboard', category: 'electronics', price: 149.99, rating: 4.7, inStock: true },
  { id: 'p5', name: 'Ergonomic Chair', category: 'furniture', price: 599.00, rating: 4.6, inStock: true },
];
const users = [
  { id: 'u1', name: 'Alice', email: 'alice@example.com', tier: 'premium' },
  { id: 'u2', name: 'Bob', email: 'bob@example.com', tier: 'basic' },
];
console.log('📦 E-Commerce dataset loaded: ' + products.length + ' products, ' + users.length + ' users');`,
  },
  {
    name: 'Task Manager',
    description: 'Tasks, projects, assignees',
    setupCode: `// Pre-loaded task manager dataset
const tasks = [
  { id: 't1', title: 'Design landing page', status: 'done', priority: 'high', assignee: 'Alice' },
  { id: 't2', title: 'Implement auth', status: 'in_progress', priority: 'high', assignee: 'Bob' },
  { id: 't3', title: 'Write API docs', status: 'todo', priority: 'medium', assignee: 'Charlie' },
  { id: 't4', title: 'Add unit tests', status: 'todo', priority: 'medium', assignee: 'Alice' },
  { id: 't5', title: 'Setup CI/CD', status: 'done', priority: 'high', assignee: 'Bob' },
];
console.log('📋 Task Manager dataset loaded: ' + tasks.length + ' tasks');`,
  },
  {
    name: 'Blog',
    description: 'Posts, authors, comments',
    setupCode: `// Pre-loaded blog dataset
const posts = [
  { id: 'post1', title: 'Getting Started with Local-First', authorId: 'a1', likes: 142 },
  { id: 'post2', title: 'Understanding CRDTs', authorId: 'a2', likes: 89 },
  { id: 'post3', title: 'Offline-First Patterns', authorId: 'a1', likes: 203 },
];
const authors = [
  { id: 'a1', name: 'Sarah Chen', bio: 'Frontend architect' },
  { id: 'a2', name: 'Marcus Rivera', bio: 'Distributed systems engineer' },
];
const comments = [
  { id: 'c1', postId: 'post1', author: 'Reader1', text: 'Great intro!' },
  { id: 'c2', postId: 'post3', author: 'Reader2', text: 'This changed how I build apps.' },
];
console.log('📝 Blog dataset loaded: ' + posts.length + ' posts, ' + authors.length + ' authors');`,
  },
];

const DEFAULT_CODE = `// Welcome to the Pocket Playground! 🚀
// Write code and press Shift+Enter or click Run to execute.

const db = new Map();

// Store some documents
db.set('user-1', { name: 'Alice', role: 'admin' });
db.set('user-2', { name: 'Bob', role: 'user' });

// Query documents
const users = Array.from(db.values());
console.log('Users:', users);
console.log('Count:', users.length);

// Filter
const admins = users.filter(u => u.role === 'admin');
console.log('Admins:', admins);
`;

function encodeState(code: string, dataset: string): string {
  try {
    const data = JSON.stringify({ c: code, d: dataset });
    return btoa(encodeURIComponent(data));
  } catch {
    return '';
  }
}

function decodeState(hash: string): { code: string; dataset: string } | null {
  try {
    const json = decodeURIComponent(atob(hash));
    const data = JSON.parse(json) as { c?: string; d?: string };
    return { code: data.c ?? '', dataset: data.d ?? 'None' };
  } catch {
    return null;
  }
}

function executeCode(code: string): { output: string[]; error: string | null } {
  const output: string[] = [];
  const capturedConsole = {
    log: (...args: unknown[]) => output.push(args.map(formatValue).join(' ')),
    error: (...args: unknown[]) => output.push('❌ ' + args.map(formatValue).join(' ')),
    warn: (...args: unknown[]) => output.push('⚠️ ' + args.map(formatValue).join(' ')),
    info: (...args: unknown[]) => output.push('ℹ️ ' + args.map(formatValue).join(' ')),
  };

  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function('console', `'use strict';\n${code}`) as (
      c: typeof capturedConsole
    ) => unknown;
    const result = fn(capturedConsole);
    if (result !== undefined) {
      output.push('→ ' + formatValue(result));
    }
    return { output, error: null };
  } catch (err) {
    return { output, error: err instanceof Error ? err.message : String(err) };
  }
}

function formatValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

let entryId = 0;

export function LivePlayground({
  initialCode,
  height = '500px',
}: {
  initialCode?: string;
  height?: string;
}): ReactNode {
  const [code, setCode] = useState(initialCode ?? DEFAULT_CODE);
  const [entries, setEntries] = useState<OutputEntry[]>([]);
  const [selectedDataset, setSelectedDataset] = useState('None');
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  // Restore state from URL hash on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.slice(1);
    if (hash) {
      const state = decodeState(hash);
      if (state) {
        setCode(state.code);
        setSelectedDataset(state.dataset);
      }
    }
  }, []);

  const handleRun = useCallback(() => {
    const dataset = DATASETS.find((d) => d.name === selectedDataset);
    const fullCode = dataset?.setupCode ? dataset.setupCode + '\n\n' + code : code;

    const start = performance.now();
    const result = executeCode(fullCode);
    const elapsed = performance.now() - start;

    // If dataset prepended output, skip those lines
    const datasetLines = dataset?.setupCode
      ? executeCode(dataset.setupCode).output.length
      : 0;
    const userOutput = result.output.slice(datasetLines);

    setEntries((prev) => [
      ...prev,
      {
        id: ++entryId,
        code,
        output: userOutput.length > 0 ? userOutput : result.output,
        error: result.error,
        executionTimeMs: Math.round(elapsed * 100) / 100,
      },
    ]);

    // Auto-scroll output
    setTimeout(() => {
      outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight, behavior: 'smooth' });
    }, 50);
  }, [code, selectedDataset]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        handleRun();
      }
    },
    [handleRun]
  );

  const handleShare = useCallback(() => {
    const hash = encodeState(code, selectedDataset);
    const url = `${window.location.origin}${window.location.pathname}#${hash}`;
    window.history.replaceState(null, '', `#${hash}`);
    navigator.clipboard.writeText(url).catch(() => {});
    setShareUrl(url);
    setTimeout(() => setShareUrl(null), 3000);
  }, [code, selectedDataset]);

  const handleClear = useCallback(() => {
    setEntries([]);
  }, []);

  return (
    <div className={styles.container} style={{ height }}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <span className={styles.title}>🔬 Pocket Playground</span>
          <select
            value={selectedDataset}
            onChange={(e) => setSelectedDataset(e.target.value)}
            className={styles.datasetSelect}
          >
            {DATASETS.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name} {d.description ? `— ${d.description}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.toolbarRight}>
          <button onClick={handleRun} className={styles.runButton} title="Shift+Enter">
            ▶ Run
          </button>
          <button onClick={handleShare} className={styles.shareButton}>
            {shareUrl ? '✅ Copied!' : '🔗 Share'}
          </button>
          <button onClick={handleClear} className={styles.clearButton}>
            🗑 Clear
          </button>
        </div>
      </div>

      <div className={styles.panels}>
        {/* Editor Panel */}
        <div className={styles.editorPanel}>
          <textarea
            ref={textareaRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={handleKeyDown}
            className={styles.editor}
            spellCheck={false}
            placeholder="Type your code here..."
          />
        </div>

        {/* Output Panel */}
        <div className={styles.outputPanel} ref={outputRef}>
          {entries.length === 0 && (
            <div className={styles.placeholder}>
              Output will appear here. Press <kbd>Shift+Enter</kbd> to run.
            </div>
          )}
          {entries.map((entry) => (
            <div key={entry.id} className={styles.outputEntry}>
              <div className={styles.outputHeader}>
                <span className={styles.outputPrompt}>›</span>
                <code className={styles.outputCode}>
                  {entry.code.length > 80 ? entry.code.slice(0, 80) + '...' : entry.code.split('\n')[0]}
                </code>
                <span className={styles.outputTime}>{entry.executionTimeMs}ms</span>
              </div>
              {entry.output.map((line, i) => (
                <div key={i} className={styles.outputLine}>
                  {line}
                </div>
              ))}
              {entry.error && <div className={styles.outputError}>Error: {entry.error}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default LivePlayground;
