import type { ConformanceTestCase } from './types.js';

/**
 * Conformance test suite that native SDKs (Swift/Kotlin) must pass
 * to be considered compatible with the Pocket specification.
 */
export class ConformanceTestSuite {
  private readonly tests: ConformanceTestCase[];

  constructor() {
    this.tests = buildConformanceTests();
  }

  getAllTests(): ConformanceTestCase[] {
    return [...this.tests];
  }

  getTestsByCategory(category: string): ConformanceTestCase[] {
    return this.tests.filter((t) => t.category === category);
  }

  getTestCount(): number {
    return this.tests.length;
  }

  validateResult(
    testId: string,
    actual: unknown,
  ): { passed: boolean; message: string } {
    const test = this.tests.find((t) => t.id === testId);
    if (!test) return { passed: false, message: `Test not found: ${testId}` };
    const expected = JSON.stringify(test.expectedResult);
    const actualStr = JSON.stringify(actual);
    const passed = expected === actualStr;
    return {
      passed,
      message: passed
        ? 'Test passed'
        : `Expected ${expected}, got ${actualStr}`,
    };
  }
}

export function createConformanceTestSuite(): ConformanceTestSuite {
  return new ConformanceTestSuite();
}

function buildConformanceTests(): ConformanceTestCase[] {
  return [
    // --- CRUD tests ---
    {
      id: 'crud-insert-basic',
      name: 'Basic document insert',
      category: 'crud',
      description: 'Insert a document and verify it is persisted with an _id',
      steps: [
        {
          action: 'insert',
          params: { collection: 'users', doc: { name: 'Alice', age: 30 } },
          expectedOutcome: { hasId: true, name: 'Alice', age: 30 },
        },
      ],
      expectedResult: { hasId: true, name: 'Alice', age: 30 },
    },
    {
      id: 'crud-get-by-id',
      name: 'Get document by ID',
      category: 'crud',
      description: 'Insert a document then retrieve it by its _id',
      steps: [
        {
          action: 'insert',
          params: { collection: 'users', doc: { name: 'Bob' } },
        },
        {
          action: 'get',
          params: { collection: 'users', id: '$lastInsertId' },
          expectedOutcome: { name: 'Bob' },
        },
      ],
      expectedResult: { found: true, name: 'Bob' },
    },
    {
      id: 'crud-get-missing',
      name: 'Get non-existent document returns null',
      category: 'crud',
      description: 'Attempt to get a document that does not exist',
      steps: [
        {
          action: 'get',
          params: { collection: 'users', id: 'non-existent-id' },
          expectedOutcome: null,
        },
      ],
      expectedResult: null,
    },
    {
      id: 'crud-update-basic',
      name: 'Basic document update',
      category: 'crud',
      description: 'Insert a document, update a field, verify the change',
      steps: [
        {
          action: 'insert',
          params: { collection: 'users', doc: { name: 'Carol', age: 25 } },
        },
        {
          action: 'update',
          params: {
            collection: 'users',
            id: '$lastInsertId',
            changes: { age: 26 },
          },
          expectedOutcome: { name: 'Carol', age: 26 },
        },
      ],
      expectedResult: { name: 'Carol', age: 26 },
    },
    {
      id: 'crud-delete-basic',
      name: 'Basic document delete',
      category: 'crud',
      description: 'Insert a document, delete it, verify it is gone',
      steps: [
        {
          action: 'insert',
          params: { collection: 'users', doc: { name: 'Dave' } },
        },
        {
          action: 'delete',
          params: { collection: 'users', id: '$lastInsertId' },
        },
        {
          action: 'get',
          params: { collection: 'users', id: '$lastInsertId' },
          expectedOutcome: null,
        },
      ],
      expectedResult: null,
    },
    {
      id: 'crud-bulk-insert',
      name: 'Bulk document insert',
      category: 'crud',
      description: 'Insert multiple documents in a batch and verify count',
      steps: [
        {
          action: 'bulkInsert',
          params: {
            collection: 'items',
            docs: [
              { title: 'Item 1' },
              { title: 'Item 2' },
              { title: 'Item 3' },
            ],
          },
          expectedOutcome: { insertedCount: 3 },
        },
      ],
      expectedResult: { insertedCount: 3 },
    },
    {
      id: 'crud-insert-preserves-fields',
      name: 'Insert preserves all user fields',
      category: 'crud',
      description:
        'Insert a document with nested fields and verify they are preserved',
      steps: [
        {
          action: 'insert',
          params: {
            collection: 'profiles',
            doc: {
              name: 'Eve',
              address: { city: 'London', zip: 'SW1' },
              tags: ['admin', 'user'],
            },
          },
        },
        {
          action: 'get',
          params: { collection: 'profiles', id: '$lastInsertId' },
          expectedOutcome: {
            name: 'Eve',
            address: { city: 'London', zip: 'SW1' },
            tags: ['admin', 'user'],
          },
        },
      ],
      expectedResult: {
        name: 'Eve',
        address: { city: 'London', zip: 'SW1' },
        tags: ['admin', 'user'],
      },
    },

    // --- Query tests ---
    {
      id: 'query-eq-filter',
      name: 'Query with equality filter',
      category: 'query',
      description: 'Find documents matching an equality condition',
      steps: [
        {
          action: 'insert',
          params: {
            collection: 'products',
            doc: { name: 'Widget', category: 'A' },
          },
        },
        {
          action: 'insert',
          params: {
            collection: 'products',
            doc: { name: 'Gadget', category: 'B' },
          },
        },
        {
          action: 'find',
          params: {
            collection: 'products',
            filter: { type: 'eq', field: 'category', value: 'A' },
          },
          expectedOutcome: { count: 1 },
        },
      ],
      expectedResult: { count: 1, firstMatch: 'Widget' },
    },
    {
      id: 'query-gt-lt-filter',
      name: 'Query with range filters (gt/lt)',
      category: 'query',
      description: 'Find documents within a numeric range',
      steps: [
        {
          action: 'bulkInsert',
          params: {
            collection: 'scores',
            docs: [
              { player: 'A', score: 10 },
              { player: 'B', score: 50 },
              { player: 'C', score: 90 },
            ],
          },
        },
        {
          action: 'find',
          params: {
            collection: 'scores',
            filter: {
              type: 'and',
              conditions: [
                { type: 'gt', field: 'score', value: 20 },
                { type: 'lt', field: 'score', value: 80 },
              ],
            },
          },
          expectedOutcome: { count: 1, player: 'B' },
        },
      ],
      expectedResult: { count: 1, player: 'B' },
    },
    {
      id: 'query-sort-asc',
      name: 'Query with ascending sort',
      category: 'query',
      description: 'Query documents sorted by a field in ascending order',
      steps: [
        {
          action: 'bulkInsert',
          params: {
            collection: 'items',
            docs: [
              { name: 'C', order: 3 },
              { name: 'A', order: 1 },
              { name: 'B', order: 2 },
            ],
          },
        },
        {
          action: 'find',
          params: {
            collection: 'items',
            sort: [{ field: 'order', direction: 'asc' }],
          },
          expectedOutcome: { firstItem: 'A', lastItem: 'C' },
        },
      ],
      expectedResult: { order: ['A', 'B', 'C'] },
    },
    {
      id: 'query-limit-skip',
      name: 'Query with limit and skip',
      category: 'query',
      description: 'Query documents with pagination using limit and skip',
      steps: [
        {
          action: 'bulkInsert',
          params: {
            collection: 'pages',
            docs: [
              { page: 1 },
              { page: 2 },
              { page: 3 },
              { page: 4 },
              { page: 5 },
            ],
          },
        },
        {
          action: 'find',
          params: {
            collection: 'pages',
            sort: [{ field: 'page', direction: 'asc' }],
            limit: 2,
            skip: 1,
          },
          expectedOutcome: { pages: [2, 3] },
        },
      ],
      expectedResult: { pages: [2, 3], totalCount: 5 },
    },
    {
      id: 'query-in-filter',
      name: 'Query with IN filter',
      category: 'query',
      description: 'Find documents where a field matches any of several values',
      steps: [
        {
          action: 'bulkInsert',
          params: {
            collection: 'colors',
            docs: [
              { name: 'red', hex: '#f00' },
              { name: 'green', hex: '#0f0' },
              { name: 'blue', hex: '#00f' },
            ],
          },
        },
        {
          action: 'find',
          params: {
            collection: 'colors',
            filter: {
              type: 'in',
              field: 'name',
              values: ['red', 'blue'],
            },
          },
          expectedOutcome: { count: 2 },
        },
      ],
      expectedResult: { count: 2, names: ['red', 'blue'] },
    },
    {
      id: 'query-contains-filter',
      name: 'Query with string contains filter',
      category: 'query',
      description: 'Find documents where a string field contains a substring',
      steps: [
        {
          action: 'bulkInsert',
          params: {
            collection: 'articles',
            docs: [
              { title: 'Hello World' },
              { title: 'Goodbye World' },
              { title: 'Hello There' },
            ],
          },
        },
        {
          action: 'find',
          params: {
            collection: 'articles',
            filter: { type: 'contains', field: 'title', value: 'Hello' },
          },
          expectedOutcome: { count: 2 },
        },
      ],
      expectedResult: { count: 2 },
    },
    {
      id: 'query-count',
      name: 'Count documents with filter',
      category: 'query',
      description: 'Count documents matching a filter without returning them',
      steps: [
        {
          action: 'bulkInsert',
          params: {
            collection: 'tasks',
            docs: [
              { status: 'done' },
              { status: 'done' },
              { status: 'pending' },
            ],
          },
        },
        {
          action: 'count',
          params: {
            collection: 'tasks',
            filter: { type: 'eq', field: 'status', value: 'done' },
          },
          expectedOutcome: { count: 2 },
        },
      ],
      expectedResult: { count: 2 },
    },

    // --- Sync tests ---
    {
      id: 'sync-push-single',
      name: 'Push single document to server',
      category: 'sync',
      description:
        'Insert a document locally and push it to the sync server',
      steps: [
        {
          action: 'insert',
          params: { collection: 'notes', doc: { text: 'Sync me' } },
        },
        {
          action: 'startSync',
          params: { url: 'ws://localhost:9090', collections: ['notes'] },
        },
        {
          action: 'waitForEvent',
          params: { eventType: 'push_completed', timeoutMs: 5000 },
          expectedOutcome: { pushed: 1 },
        },
      ],
      expectedResult: { pushed: 1 },
    },
    {
      id: 'sync-pull-single',
      name: 'Pull single document from server',
      category: 'sync',
      description:
        'Start sync and pull a document that exists on the server',
      steps: [
        {
          action: 'startSync',
          params: { url: 'ws://localhost:9090', collections: ['notes'] },
        },
        {
          action: 'waitForEvent',
          params: { eventType: 'pull_completed', timeoutMs: 5000 },
          expectedOutcome: { pulled: 1 },
        },
        {
          action: 'get',
          params: { collection: 'notes', id: 'server-doc-1' },
          expectedOutcome: { found: true },
        },
      ],
      expectedResult: { pulled: 1, found: true },
    },
    {
      id: 'sync-status-transitions',
      name: 'Sync status transitions correctly',
      category: 'sync',
      description:
        'Verify sync status moves from idle → syncing → idle',
      steps: [
        {
          action: 'getSyncStatus',
          params: {},
          expectedOutcome: { status: 'idle' },
        },
        {
          action: 'startSync',
          params: { url: 'ws://localhost:9090' },
        },
        {
          action: 'getSyncStatus',
          params: {},
          expectedOutcome: { status: 'syncing' },
        },
        {
          action: 'stopSync',
          params: {},
        },
        {
          action: 'getSyncStatus',
          params: {},
          expectedOutcome: { status: 'idle' },
        },
      ],
      expectedResult: { transitions: ['idle', 'syncing', 'idle'] },
    },

    // --- Conflict tests ---
    {
      id: 'conflict-server-wins',
      name: 'Server-wins conflict resolution',
      category: 'conflict',
      description:
        'When the same document is modified locally and on server, server version wins',
      steps: [
        {
          action: 'insert',
          params: { collection: 'docs', doc: { _id: 'shared-1', value: 'local' } },
        },
        {
          action: 'startSync',
          params: {
            url: 'ws://localhost:9090',
            conflictStrategy: 'server-wins',
          },
        },
        {
          action: 'waitForEvent',
          params: { eventType: 'conflict', timeoutMs: 5000 },
        },
        {
          action: 'get',
          params: { collection: 'docs', id: 'shared-1' },
          expectedOutcome: { value: 'server' },
        },
      ],
      expectedResult: { value: 'server', strategy: 'server-wins' },
    },
    {
      id: 'conflict-client-wins',
      name: 'Client-wins conflict resolution',
      category: 'conflict',
      description:
        'When the same document is modified locally and on server, client version wins',
      steps: [
        {
          action: 'insert',
          params: { collection: 'docs', doc: { _id: 'shared-2', value: 'local' } },
        },
        {
          action: 'startSync',
          params: {
            url: 'ws://localhost:9090',
            conflictStrategy: 'client-wins',
          },
        },
        {
          action: 'waitForEvent',
          params: { eventType: 'conflict', timeoutMs: 5000 },
        },
        {
          action: 'get',
          params: { collection: 'docs', id: 'shared-2' },
          expectedOutcome: { value: 'local' },
        },
      ],
      expectedResult: { value: 'local', strategy: 'client-wins' },
    },
    {
      id: 'conflict-last-write-wins',
      name: 'Last-write-wins conflict resolution',
      category: 'conflict',
      description:
        'When conflicting, the most recent write (by timestamp) wins',
      steps: [
        {
          action: 'insert',
          params: {
            collection: 'docs',
            doc: { _id: 'shared-3', value: 'old', _updatedAt: 1000 },
          },
        },
        {
          action: 'startSync',
          params: {
            url: 'ws://localhost:9090',
            conflictStrategy: 'last-write-wins',
          },
        },
        {
          action: 'waitForEvent',
          params: { eventType: 'conflict', timeoutMs: 5000 },
        },
        {
          action: 'get',
          params: { collection: 'docs', id: 'shared-3' },
          expectedOutcome: { value: 'newer' },
        },
      ],
      expectedResult: { value: 'newer', strategy: 'last-write-wins' },
    },

    // --- Offline tests ---
    {
      id: 'offline-queue-operations',
      name: 'Queue operations while offline',
      category: 'offline',
      description:
        'Operations performed offline are queued and executed when connectivity resumes',
      steps: [
        {
          action: 'simulateOffline',
          params: {},
        },
        {
          action: 'insert',
          params: { collection: 'offline-notes', doc: { text: 'Written offline' } },
        },
        {
          action: 'update',
          params: {
            collection: 'offline-notes',
            id: '$lastInsertId',
            changes: { text: 'Updated offline' },
          },
        },
        {
          action: 'simulateOnline',
          params: {},
        },
        {
          action: 'waitForEvent',
          params: { eventType: 'push_completed', timeoutMs: 5000 },
          expectedOutcome: { pushed: 2 },
        },
      ],
      expectedResult: { queuedOperations: 2, pushed: 2 },
    },
    {
      id: 'offline-read-local',
      name: 'Read from local store while offline',
      category: 'offline',
      description:
        'Documents are readable from local storage when connectivity is lost',
      steps: [
        {
          action: 'insert',
          params: {
            collection: 'cached',
            doc: { _id: 'local-1', data: 'cached value' },
          },
        },
        {
          action: 'simulateOffline',
          params: {},
        },
        {
          action: 'get',
          params: { collection: 'cached', id: 'local-1' },
          expectedOutcome: { data: 'cached value' },
        },
      ],
      expectedResult: { found: true, data: 'cached value' },
    },
    {
      id: 'offline-live-query',
      name: 'Live queries update from local changes while offline',
      category: 'offline',
      description:
        'Live queries reflect local mutations even when offline',
      steps: [
        {
          action: 'simulateOffline',
          params: {},
        },
        {
          action: 'observe',
          params: { collection: 'tasks' },
        },
        {
          action: 'insert',
          params: { collection: 'tasks', doc: { title: 'Offline task' } },
        },
        {
          action: 'verifyObservation',
          params: { expectedCount: 1 },
          expectedOutcome: { count: 1, title: 'Offline task' },
        },
      ],
      expectedResult: { count: 1, title: 'Offline task' },
    },
  ];
}
