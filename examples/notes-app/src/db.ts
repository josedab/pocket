import { createDatabase, type Database } from '@pocket/core';
import { IndexedDBAdapter } from '@pocket/storage-indexeddb';
import { MemoryStorageAdapter } from '@pocket/storage-memory';
import { SyncEngine, type SyncConfig } from '@pocket/sync';
import type { Document } from '@pocket/core';

export interface Note extends Document {
  _id: string;
  title: string;
  content: string;
  color: string;
  createdAt: number;
  updatedAt: number;
}

let dbInstance: Database | null = null;
let syncEngineInstance: SyncEngine | null = null;

export async function getDatabase(): Promise<Database> {
  if (dbInstance) {
    return dbInstance;
  }

  // Try IndexedDB first, fall back to memory storage
  let storage;
  try {
    storage = new IndexedDBAdapter();
    if (!storage.isAvailable()) {
      throw new Error('IndexedDB not available');
    }
  } catch {
    console.warn('IndexedDB not available, using memory storage');
    storage = new MemoryStorageAdapter();
  }

  dbInstance = await createDatabase({
    name: 'notes-app',
    storage,
    collections: [
      {
        name: 'notes',
        sync: true,
        schema: {
          properties: {
            title: { type: 'string', required: true, min: 1 },
            content: { type: 'string', default: '' },
            color: { type: 'string', default: '#ffd93d' },
            createdAt: { type: 'number' },
            updatedAt: { type: 'number' },
          },
        },
        indexes: [
          { fields: ['createdAt'] },
          { fields: ['updatedAt'] },
        ],
      },
    ],
  });

  return dbInstance;
}

export function getSyncEngine(db: Database): SyncEngine {
  if (syncEngineInstance) {
    return syncEngineInstance;
  }

  const config: SyncConfig = {
    serverUrl: 'ws://localhost:3001',
    collections: ['notes'],
    direction: 'both',
    conflictStrategy: 'last-write-wins',
    autoRetry: true,
  };

  syncEngineInstance = new SyncEngine(db, config);
  return syncEngineInstance;
}

export const NOTE_COLORS = [
  '#ffd93d', // Yellow
  '#6bcb77', // Green
  '#4d96ff', // Blue
  '#ff6b6b', // Red
  '#c9b1ff', // Purple
  '#ff9f45', // Orange
];
