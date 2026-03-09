/**
 * @pocket/web-component — Self-contained Web Component for embedding
 * Pocket databases in any web application.
 *
 * Uses the Custom Elements API (v1) for framework-agnostic integration.
 * Configured via HTML attributes and provides data binding, sync controls,
 * and event dispatching.
 *
 * @example
 * ```html
 * <pocket-data
 *   database="myapp"
 *   collection="todos"
 *   storage="memory"
 *   display="table"
 *   fields="title,completed,createdAt"
 *   filter='{"completed": false}'
 *   sort='{"createdAt": -1}'
 *   limit="50"
 *   editable
 *   realtime
 * ></pocket-data>
 *
 * <script type="module">
 *   import '@pocket/web-component';
 *
 *   const el = document.querySelector('pocket-data');
 *   el.addEventListener('data-changed', (e) => {
 *     console.log('Documents:', e.detail.documents);
 *   });
 * </script>
 * ```
 *
 * @module @pocket/web-component
 */

import { BehaviorSubject, type Subscription } from 'rxjs';
import type {
  DisplayMode,
  PocketElementConfig,
  PocketElementState,
} from './types.js';

// ── Observed Attributes ───────────────────────────────────

const OBSERVED_ATTRIBUTES = [
  'database',
  'collection',
  'storage',
  'sync-url',
  'filter',
  'sort',
  'limit',
  'fields',
  'display',
  'editable',
  'realtime',
  'theme',
] as const;

// ── Styles ────────────────────────────────────────────────

function getStyles(theme: 'light' | 'dark' | 'auto'): string {
  const lightVars = `
    --pocket-bg: #ffffff;
    --pocket-text: #1a1a1a;
    --pocket-border: #e0e0e0;
    --pocket-header-bg: #f5f5f5;
    --pocket-hover-bg: #f0f0f0;
    --pocket-accent: #4ECDC4;
    --pocket-error: #FF6B6B;
  `;

  const darkVars = `
    --pocket-bg: #1a1a2e;
    --pocket-text: #e0e0e0;
    --pocket-border: #333355;
    --pocket-header-bg: #16213e;
    --pocket-hover-bg: #0f3460;
    --pocket-accent: #4ECDC4;
    --pocket-error: #FF6B6B;
  `;

  const vars = theme === 'dark' ? darkVars : theme === 'auto'
    ? `${lightVars} @media (prefers-color-scheme: dark) { :host { ${darkVars} } }`
    : lightVars;

  return `
    :host {
      display: block;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      ${vars}
      background: var(--pocket-bg);
      color: var(--pocket-text);
      border: 1px solid var(--pocket-border);
      border-radius: 8px;
      overflow: hidden;
    }

    .pocket-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      background: var(--pocket-header-bg);
      border-bottom: 1px solid var(--pocket-border);
      font-size: 12px;
    }

    .pocket-status {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .pocket-status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--pocket-accent);
    }

    .pocket-status-dot.error { background: var(--pocket-error); }
    .pocket-status-dot.offline { background: #999; }

    .pocket-body {
      padding: 8px;
      overflow: auto;
      max-height: 400px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    th, td {
      padding: 6px 10px;
      text-align: left;
      border-bottom: 1px solid var(--pocket-border);
    }

    th {
      background: var(--pocket-header-bg);
      font-weight: 600;
      position: sticky;
      top: 0;
    }

    tr:hover td { background: var(--pocket-hover-bg); }

    .pocket-list-item {
      padding: 8px;
      border-bottom: 1px solid var(--pocket-border);
      cursor: pointer;
    }

    .pocket-list-item:hover { background: var(--pocket-hover-bg); }

    .pocket-json {
      white-space: pre-wrap;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 12px;
      padding: 8px;
    }

    .pocket-empty {
      text-align: center;
      padding: 24px;
      color: #999;
    }

    .pocket-error-msg {
      color: var(--pocket-error);
      padding: 12px;
      text-align: center;
    }

    .pocket-footer {
      display: flex;
      justify-content: space-between;
      padding: 6px 12px;
      background: var(--pocket-header-bg);
      border-top: 1px solid var(--pocket-border);
      font-size: 11px;
      color: #888;
    }
  `;
}

// ── PocketDataElement ─────────────────────────────────────

/**
 * `<pocket-data>` — Custom Element for embedding Pocket data views.
 */
export class PocketDataElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return [...OBSERVED_ATTRIBUTES];
  }

  private shadow: ShadowRoot;
  private state$$: BehaviorSubject<PocketElementState>;
  private stateSub: Subscription | null = null;
  private documents: Record<string, unknown>[] = [];
  private initialized = false;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.state$$ = new BehaviorSubject<PocketElementState>({
      status: 'idle',
      documents: [],
      documentCount: 0,
      error: null,
      syncStatus: 'disconnected',
      lastUpdated: null,
    });
  }

  /** Get current configuration from attributes */
  get config(): PocketElementConfig {
    return {
      database: this.getAttribute('database') ?? 'default',
      collection: this.getAttribute('collection') ?? 'default',
      storage: this.getAttribute('storage') ?? 'memory',
      syncUrl: this.getAttribute('sync-url') ?? undefined,
      filter: this.getAttribute('filter') ?? undefined,
      sort: this.getAttribute('sort') ?? undefined,
      limit: this.hasAttribute('limit') ? Number(this.getAttribute('limit')) : undefined,
      fields: this.getAttribute('fields') ?? undefined,
      display: (this.getAttribute('display') as DisplayMode) ?? 'table',
      editable: this.hasAttribute('editable'),
      realtime: !this.hasAttribute('realtime') || this.getAttribute('realtime') !== 'false',
      theme: (this.getAttribute('theme') as 'light' | 'dark' | 'auto') ?? 'light',
    };
  }

  /** Get current state */
  get state(): PocketElementState {
    return this.state$$.getValue();
  }

  /** Programmatically set documents */
  setDocuments(docs: Record<string, unknown>[]): void {
    this.documents = docs;
    this.state$$.next({
      ...this.state,
      status: 'connected',
      documents: docs,
      documentCount: docs.length,
      lastUpdated: Date.now(),
    });
    this.emitEvent('data-changed', { documents: docs, count: docs.length });
  }

  /** Add a document */
  addDocument(doc: Record<string, unknown>): void {
    this.documents.push(doc);
    this.setDocuments([...this.documents]);
    this.emitEvent('document-created', { document: doc });
  }

  /** Update a document by ID */
  updateDocument(id: string, updates: Record<string, unknown>): void {
    const idx = this.documents.findIndex((d) => d['_id'] === id || d['id'] === id);
    if (idx >= 0) {
      this.documents[idx] = { ...this.documents[idx], ...updates };
      this.setDocuments([...this.documents]);
      this.emitEvent('document-updated', { document: this.documents[idx] });
    }
  }

  /** Remove a document by ID */
  removeDocument(id: string): void {
    this.documents = this.documents.filter((d) => d['_id'] !== id && d['id'] !== id);
    this.setDocuments([...this.documents]);
    this.emitEvent('document-deleted', { documentId: id });
  }

  connectedCallback(): void {
    if (!this.initialized) {
      this.initialized = true;
      this.stateSub = this.state$$.subscribe(() => this.render());
      this.render();
      this.emitEvent('ready', { config: this.config });
    }
  }

  disconnectedCallback(): void {
    this.stateSub?.unsubscribe();
    this.stateSub = null;
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue !== newValue && this.initialized) {
      this.render();
    }
  }

  // ── Rendering ───────────────────────────────────────

  private render(): void {
    const config = this.config;
    const state = this.state;
    const theme = config.theme ?? 'light';

    let bodyContent: string;

    if (state.status === 'error') {
      bodyContent = `<div class="pocket-error-msg">${this.escapeHtml(state.error ?? 'Unknown error')}</div>`;
    } else if (state.documents.length === 0) {
      bodyContent = `<div class="pocket-empty">No documents</div>`;
    } else {
      switch (config.display) {
        case 'table':
          bodyContent = this.renderTable(state.documents, config);
          break;
        case 'list':
          bodyContent = this.renderList(state.documents);
          break;
        case 'json':
          bodyContent = `<div class="pocket-json">${this.escapeHtml(JSON.stringify(state.documents, null, 2))}</div>`;
          break;
        default:
          bodyContent = this.renderTable(state.documents, config);
      }
    }

    const statusDotClass = state.status === 'error' ? 'error' : state.status === 'offline' ? 'offline' : '';

    this.shadow.innerHTML = `
      <style>${getStyles(theme)}</style>
      <div class="pocket-header">
        <span><strong>${this.escapeHtml(config.collection)}</strong></span>
        <div class="pocket-status">
          <span class="pocket-status-dot ${statusDotClass}"></span>
          <span>${state.status}</span>
        </div>
      </div>
      <div class="pocket-body">${bodyContent}</div>
      <div class="pocket-footer">
        <span>${state.documentCount} document${state.documentCount !== 1 ? 's' : ''}</span>
        <span>${state.lastUpdated ? new Date(state.lastUpdated).toLocaleTimeString() : '—'}</span>
      </div>
    `;

    // Attach click handlers for list items
    if (config.display === 'list') {
      this.shadow.querySelectorAll('.pocket-list-item').forEach((el, i) => {
        el.addEventListener('click', () => {
          const doc = state.documents[i];
          if (doc) {
            this.emitEvent('document-selected', { document: doc });
          }
        });
      });
    }

    // Attach click handlers for table rows
    if (config.display === 'table') {
      this.shadow.querySelectorAll('tbody tr').forEach((el, i) => {
        el.addEventListener('click', () => {
          const doc = state.documents[i];
          if (doc) {
            this.emitEvent('document-selected', { document: doc });
          }
        });
      });
    }
  }

  private renderTable(docs: Record<string, unknown>[], config: PocketElementConfig): string {
    const fieldsStr = config.fields;
    const fields = fieldsStr
      ? fieldsStr.split(',').map((f) => f.trim())
      : docs.length > 0
        ? Object.keys(docs[0]!).slice(0, 10)
        : [];

    const headers = fields.map((f) => `<th>${this.escapeHtml(f)}</th>`).join('');
    const rows = docs.map((doc) => {
      const cells = fields.map((f) => {
        const val = doc[f];
        const display = val === null || val === undefined ? '—' : typeof val === 'object' ? JSON.stringify(val) : String(val);
        return `<td>${this.escapeHtml(display)}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  private renderList(docs: Record<string, unknown>[]): string {
    return docs.map((doc) => {
      const id = doc['_id'] ?? doc['id'] ?? '?';
      const preview = Object.entries(doc)
        .filter(([k]) => k !== '_id' && k !== 'id')
        .slice(0, 3)
        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
        .join(', ');
      return `<div class="pocket-list-item"><strong>${this.escapeHtml(String(id))}</strong> — ${this.escapeHtml(preview)}</div>`;
    }).join('');
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private emitEvent(name: string, detail: Record<string, unknown>): void {
    this.dispatchEvent(new CustomEvent(name, {
      detail,
      bubbles: true,
      composed: true,
    }));
  }
}

// ── Registration ──────────────────────────────────────────

/**
 * Register the `<pocket-data>` custom element.
 * Safe to call multiple times — will skip if already registered.
 */
export function registerPocketElement(tagName = 'pocket-data'): void {
  if (typeof customElements !== 'undefined' && !customElements.get(tagName)) {
    customElements.define(tagName, PocketDataElement);
  }
}
