import * as http from 'node:http';
import { Subject } from 'rxjs';
import { DatabaseInspector } from './database-inspector.js';
import { DocumentEditor } from './document-editor.js';
import { PerformanceProfiler } from './performance-profiler.js';
import { SyncInspector, type SyncEngineLike } from './sync-inspector.js';
import type { StudioConfig, StudioEvent } from './types.js';

/**
 * Parsed route information from a URL path.
 */
interface ParsedRoute {
  /** The matched route pattern */
  pattern: string;
  /** Extracted URL parameters */
  params: Record<string, string>;
}

/**
 * Studio Server - a lightweight HTTP server for the Pocket Studio.
 *
 * Provides a REST API for database inspection, document management,
 * sync monitoring, and performance profiling. Built on Node.js's
 * built-in `http` module with no external dependencies.
 *
 * ## Routes
 *
 * | Method | Path | Description |
 * |--------|------|-------------|
 * | GET | /api/collections | List all collections |
 * | GET | /api/collections/:name | Get collection info |
 * | GET | /api/collections/:name/documents | Query documents |
 * | GET | /api/collections/:name/documents/:id | Get document by ID |
 * | POST | /api/collections/:name/documents | Insert document |
 * | PUT | /api/collections/:name/documents/:id | Update document |
 * | DELETE | /api/collections/:name/documents/:id | Delete document |
 * | GET | /api/sync/status | Get sync status |
 * | POST | /api/query/explain | Explain a query |
 * | GET | /api/stats | Get overall statistics |
 *
 * @example
 * ```typescript
 * const server = createStudioServer({
 *   port: 4680,
 *   database: myDb,
 *   readOnly: false,
 * });
 *
 * await server.start();
 * console.log('Studio running at http://localhost:4680');
 *
 * // Later...
 * await server.stop();
 * ```
 *
 * @see {@link createStudioServer} for the factory function
 * @see {@link StudioConfig} for configuration options
 */
export class StudioServer {
  private readonly config: Required<Omit<StudioConfig, 'database' | 'auth'>> & {
    database?: StudioConfig['database'];
    auth?: StudioConfig['auth'];
  };
  private readonly inspector: DatabaseInspector | null;
  private readonly editor: DocumentEditor | null;
  private readonly syncInspector: SyncInspector;
  private readonly profiler: PerformanceProfiler | null;
  private readonly events$ = new Subject<StudioEvent>();

  private server: http.Server | null = null;

  constructor(config: StudioConfig = {}) {
    this.config = {
      port: config.port ?? 4680,
      host: config.host ?? 'localhost',
      readOnly: config.readOnly ?? false,
      database: config.database,
      auth: config.auth,
    };

    if (config.database) {
      this.inspector = new DatabaseInspector(config.database);
      this.editor = new DocumentEditor(config.database, {
        readOnly: config.readOnly,
      });
      this.profiler = new PerformanceProfiler(config.database);
    } else {
      this.inspector = null;
      this.editor = null;
      this.profiler = null;
    }

    this.syncInspector = new SyncInspector();
  }

  /**
   * Get the event stream for studio lifecycle events.
   */
  get events(): Subject<StudioEvent> {
    return this.events$;
  }

  /**
   * Get the sync inspector for external configuration.
   */
  getSyncInspector(): SyncInspector {
    return this.syncInspector;
  }

  /**
   * Set a sync engine for inspection.
   *
   * @param syncEngine - The sync engine to attach
   */
  setSyncEngine(syncEngine: SyncEngineLike): void {
    // Create a new SyncInspector with the engine - but since
    // we already have one, we'll use a workaround: store reference
    // The SyncInspector is designed to work with or without an engine
    Object.assign(this, {
      syncInspector: new SyncInspector(syncEngine),
    });
  }

  /**
   * Start the HTTP server.
   *
   * @returns A promise that resolves when the server is listening
   */
  async start(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        void this.handleRequest(req, res);
      });

      this.server.on('error', (err) => {
        this.events$.next({ type: 'error', message: err.message });
        reject(err);
      });

      this.server.listen(this.config.port, this.config.host, () => {
        this.events$.next({ type: 'studio:started', port: this.config.port });
        resolve();
      });
    });
  }

  /**
   * Stop the HTTP server.
   *
   * @returns A promise that resolves when the server is closed
   */
  async stop(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close(() => {
        this.server = null;
        this.events$.next({ type: 'studio:stopped' });
        resolve();
      });
    });
  }

  /**
   * Whether the server is currently running.
   */
  get isRunning(): boolean {
    return this.server?.listening ?? false;
  }

  /**
   * Destroy the server and clean up resources.
   */
  async destroy(): Promise<void> {
    await this.stop();
    this.editor?.destroy();
    this.events$.complete();
  }

  /**
   * Handle an incoming HTTP request.
   */
  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // Set CORS headers for local development
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Basic auth check
    if (this.config.auth) {
      if (!this.checkAuth(req)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
    }

    try {
      await this.routeRequest(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.events$.next({ type: 'error', message });
      this.sendJson(res, 500, { error: message });
    }
  }

  /**
   * Check basic authentication.
   */
  private checkAuth(req: http.IncomingMessage): boolean {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Basic ')) {
      return false;
    }

    const credentials = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
    const [username, password] = credentials.split(':');

    return (
      username === this.config.auth!.username &&
      password === this.config.auth!.password
    );
  }

  /**
   * Route an incoming request to the appropriate handler.
   */
  private async routeRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;

    // Route matching
    const route = this.matchRoute(pathname);
    if (!route) {
      this.sendJson(res, 404, { error: 'Not found' });
      return;
    }

    // Ensure database is configured for most routes
    if (!this.inspector && route.pattern !== '/api/health') {
      this.sendJson(res, 503, { error: 'No database configured' });
      return;
    }

    switch (route.pattern) {
      case '/api/collections': {
        if (method === 'GET') {
          await this.handleListCollections(res);
        } else {
          this.sendJson(res, 405, { error: 'Method not allowed' });
        }
        break;
      }

      case '/api/collections/:name': {
        if (method === 'GET') {
          await this.handleGetCollection(res, route.params.name!);
        } else {
          this.sendJson(res, 405, { error: 'Method not allowed' });
        }
        break;
      }

      case '/api/collections/:name/documents': {
        if (method === 'GET') {
          await this.handleQueryDocuments(req, res, route.params.name!);
        } else if (method === 'POST') {
          await this.handleInsertDocument(req, res, route.params.name!);
        } else {
          this.sendJson(res, 405, { error: 'Method not allowed' });
        }
        break;
      }

      case '/api/collections/:name/documents/:id': {
        const name = route.params.name!;
        const id = route.params.id!;
        if (method === 'GET') {
          await this.handleGetDocument(res, name, id);
        } else if (method === 'PUT') {
          await this.handleUpdateDocument(req, res, name, id);
        } else if (method === 'DELETE') {
          await this.handleDeleteDocument(res, name, id);
        } else {
          this.sendJson(res, 405, { error: 'Method not allowed' });
        }
        break;
      }

      case '/api/sync/status': {
        if (method === 'GET') {
          this.handleSyncStatus(res);
        } else {
          this.sendJson(res, 405, { error: 'Method not allowed' });
        }
        break;
      }

      case '/api/query/explain': {
        if (method === 'POST') {
          await this.handleExplainQuery(req, res);
        } else {
          this.sendJson(res, 405, { error: 'Method not allowed' });
        }
        break;
      }

      case '/api/stats': {
        if (method === 'GET') {
          await this.handleGetStats(res);
        } else {
          this.sendJson(res, 405, { error: 'Method not allowed' });
        }
        break;
      }

      case '/api/studio/panels': {
        if (method === 'GET') {
          const { getAvailablePanels } = await import('./studio-launcher.js');
          const panels = getAvailablePanels({
            port: this.config.port ?? 4680,
          });
          this.sendJson(res, 200, { panels });
        } else {
          this.sendJson(res, 405, { error: 'Method not allowed' });
        }
        break;
      }

      case '/api/studio/status': {
        if (method === 'GET') {
          this.sendJson(res, 200, {
            running: true,
            port: this.config.port ?? 4680,
            startedAt: Date.now(),
          });
        } else {
          this.sendJson(res, 405, { error: 'Method not allowed' });
        }
        break;
      }

      case '/api/network/presets': {
        if (method === 'GET') {
          const { NetworkSimulator } = await import('./network-simulator.js');
          const sim = new NetworkSimulator();
          this.sendJson(res, 200, {
            presets: sim.getPresets().map((p) => ({
              name: p,
              condition: sim.getPresetCondition(p),
            })),
          });
          sim.destroy();
        } else {
          this.sendJson(res, 405, { error: 'Method not allowed' });
        }
        break;
      }

      case '/api/network/condition': {
        if (method === 'GET') {
          this.sendJson(res, 200, {
            condition: { latencyMs: 0, jitterMs: 0, packetLossRate: 0, online: true },
            preset: 'perfect',
          });
        } else {
          this.sendJson(res, 405, { error: 'Method not allowed' });
        }
        break;
      }

      case '/api/health': {
        this.sendJson(res, 200, {
          status: 'healthy',
          uptime: process.uptime(),
          timestamp: Date.now(),
          version: '0.1.0',
        });
        break;
      }

      case '/api/ready': {
        const ready = !!this.inspector;
        this.sendJson(res, ready ? 200 : 503, {
          ready,
          database: !!this.inspector,
          timestamp: Date.now(),
        });
        break;
      }

      default:
        this.sendJson(res, 404, { error: 'Not found' });
    }
  }

  /**
   * Match a URL pathname to a known route pattern.
   */
  private matchRoute(pathname: string): ParsedRoute | null {
    const routes = [
      '/api/collections',
      '/api/collections/:name/documents/:id',
      '/api/collections/:name/documents',
      '/api/collections/:name',
      '/api/sync/status',
      '/api/query/explain',
      '/api/stats',
      '/api/studio/panels',
      '/api/studio/status',
      '/api/network/presets',
      '/api/network/condition',
      '/api/health',
      '/api/ready',
    ];

    for (const pattern of routes) {
      const match = this.matchPattern(pathname, pattern);
      if (match) {
        return { pattern, params: match };
      }
    }

    return null;
  }

  /**
   * Match a URL pathname against a route pattern with :param placeholders.
   */
  private matchPattern(
    pathname: string,
    pattern: string
  ): Record<string, string> | null {
    const pathParts = pathname.split('/').filter(Boolean);
    const patternParts = pattern.split('/').filter(Boolean);

    if (pathParts.length !== patternParts.length) {
      return null;
    }

    const params: Record<string, string> = {};

    for (let i = 0; i < patternParts.length; i++) {
      const patternPart = patternParts[i]!;
      const pathPart = pathParts[i]!;

      if (patternPart.startsWith(':')) {
        params[patternPart.slice(1)] = decodeURIComponent(pathPart);
      } else if (patternPart !== pathPart) {
        return null;
      }
    }

    return params;
  }

  /**
   * Parse the JSON body from an incoming request.
   */
  private async parseBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const chunks: Buffer[] = [];

      req.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        if (!raw || raw.length === 0) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error('Invalid JSON body'));
        }
      });

      req.on('error', reject);
    });
  }

  /**
   * Send a JSON response.
   */
  private sendJson(
    res: http.ServerResponse,
    statusCode: number,
    data: unknown
  ): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  // --- Route handlers ---

  /**
   * GET /api/collections
   */
  private async handleListCollections(res: http.ServerResponse): Promise<void> {
    const collections = await this.inspector!.listCollections();
    this.sendJson(res, 200, { collections });
  }

  /**
   * GET /api/collections/:name
   */
  private async handleGetCollection(
    res: http.ServerResponse,
    name: string
  ): Promise<void> {
    const info = await this.inspector!.getCollection(name);
    this.sendJson(res, 200, info);
  }

  /**
   * GET /api/collections/:name/documents
   *
   * Supports query parameters:
   * - filter: JSON-encoded filter object
   * - sort: JSON-encoded sort object
   * - limit: number
   */
  private async handleQueryDocuments(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    name: string
  ): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const filterParam = url.searchParams.get('filter');
    const sortParam = url.searchParams.get('sort');
    const limitParam = url.searchParams.get('limit');

    let filter: Record<string, unknown> | undefined;
    let sort: Record<string, 'asc' | 'desc'> | undefined;
    let limit: number | undefined;

    if (filterParam) {
      try {
        filter = JSON.parse(filterParam) as Record<string, unknown>;
      } catch {
        this.sendJson(res, 400, { error: 'Invalid filter parameter' });
        return;
      }
    }

    if (sortParam) {
      try {
        sort = JSON.parse(sortParam) as Record<string, 'asc' | 'desc'>;
      } catch {
        this.sendJson(res, 400, { error: 'Invalid sort parameter' });
        return;
      }
    }

    if (limitParam) {
      limit = parseInt(limitParam, 10);
      if (isNaN(limit) || limit < 0) {
        this.sendJson(res, 400, { error: 'Invalid limit parameter' });
        return;
      }
    }

    const result = await this.inspector!.queryDocuments(name, filter, sort, limit);

    this.events$.next({ type: 'query:executed', result });
    this.sendJson(res, 200, result);
  }

  /**
   * GET /api/collections/:name/documents/:id
   */
  private async handleGetDocument(
    res: http.ServerResponse,
    collection: string,
    id: string
  ): Promise<void> {
    const document = await this.inspector!.getDocument(collection, id);
    if (document === null) {
      this.sendJson(res, 404, { error: 'Document not found' });
      return;
    }
    this.sendJson(res, 200, { document });
  }

  /**
   * POST /api/collections/:name/documents
   */
  private async handleInsertDocument(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    collection: string
  ): Promise<void> {
    if (!this.editor) {
      this.sendJson(res, 503, { error: 'No database configured' });
      return;
    }

    const body = await this.parseBody(req);
    if (typeof body !== 'object' || body === null) {
      this.sendJson(res, 400, { error: 'Request body must be a JSON object' });
      return;
    }

    try {
      const document = await this.editor.insertDocument(
        collection,
        body as Record<string, unknown>
      );
      this.sendJson(res, 201, { document });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('read-only')) {
        this.sendJson(res, 403, { error: message });
      } else if (message.includes('Validation')) {
        this.sendJson(res, 400, { error: message });
      } else {
        throw error;
      }
    }
  }

  /**
   * PUT /api/collections/:name/documents/:id
   */
  private async handleUpdateDocument(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    collection: string,
    id: string
  ): Promise<void> {
    if (!this.editor) {
      this.sendJson(res, 503, { error: 'No database configured' });
      return;
    }

    const body = await this.parseBody(req);
    if (typeof body !== 'object' || body === null) {
      this.sendJson(res, 400, { error: 'Request body must be a JSON object' });
      return;
    }

    try {
      const document = await this.editor.updateDocument(
        collection,
        id,
        body as Record<string, unknown>
      );
      this.sendJson(res, 200, { document });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('read-only')) {
        this.sendJson(res, 403, { error: message });
      } else if (message.includes('not found') || message.includes('Not found')) {
        this.sendJson(res, 404, { error: message });
      } else if (message.includes('Validation')) {
        this.sendJson(res, 400, { error: message });
      } else {
        throw error;
      }
    }
  }

  /**
   * DELETE /api/collections/:name/documents/:id
   */
  private async handleDeleteDocument(
    res: http.ServerResponse,
    collection: string,
    id: string
  ): Promise<void> {
    if (!this.editor) {
      this.sendJson(res, 503, { error: 'No database configured' });
      return;
    }

    try {
      await this.editor.deleteDocument(collection, id);
      this.sendJson(res, 200, { deleted: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('read-only')) {
        this.sendJson(res, 403, { error: message });
      } else {
        throw error;
      }
    }
  }

  /**
   * GET /api/sync/status
   */
  private handleSyncStatus(res: http.ServerResponse): void {
    const status = this.syncInspector.getStatus();
    this.sendJson(res, 200, status);
  }

  /**
   * POST /api/query/explain
   *
   * Body: { collection: string, filter: object }
   */
  private async handleExplainQuery(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const body = (await this.parseBody(req)) as Record<string, unknown>;

    const collection = body.collection;
    const filter = body.filter;

    if (typeof collection !== 'string') {
      this.sendJson(res, 400, { error: 'Missing or invalid "collection" field' });
      return;
    }

    if (typeof filter !== 'object' || filter === null) {
      this.sendJson(res, 400, { error: 'Missing or invalid "filter" field' });
      return;
    }

    const plan = await this.inspector!.explainQuery(
      collection,
      filter as Record<string, unknown>
    );
    this.sendJson(res, 200, { plan });
  }

  /**
   * GET /api/stats
   */
  private async handleGetStats(res: http.ServerResponse): Promise<void> {
    const collections = await this.inspector!.listCollections();

    let totalDocuments = 0;
    let totalIndexes = 0;
    let totalStorageSize = 0;

    for (const coll of collections) {
      totalDocuments += coll.documentCount;
      totalIndexes += coll.indexCount;
      totalStorageSize += coll.storageSize;
    }

    const syncStatus = this.syncInspector.getStatus();
    const profilerStats = this.profiler?.getOperationStats() ?? {
      reads: 0,
      writes: 0,
      avgReadMs: 0,
      avgWriteMs: 0,
    };

    this.sendJson(res, 200, {
      collections: collections.length,
      totalDocuments,
      totalIndexes,
      totalStorageSize,
      sync: syncStatus,
      performance: profilerStats,
    });
  }
}

/**
 * Create a new StudioServer instance.
 *
 * @param config - Studio server configuration
 * @returns A new StudioServer
 *
 * @example
 * ```typescript
 * import { createStudioServer } from '@pocket/studio';
 *
 * const server = createStudioServer({
 *   port: 4680,
 *   database: myDb,
 *   readOnly: false,
 *   auth: { username: 'admin', password: 'secret' },
 * });
 *
 * await server.start();
 * console.log('Studio available at http://localhost:4680');
 * ```
 */
export function createStudioServer(config?: StudioConfig): StudioServer {
  return new StudioServer(config);
}
