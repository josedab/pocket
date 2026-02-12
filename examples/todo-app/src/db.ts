import { createDatabase, type Database } from '@pocket/core';
import { createIndexedDBStorage } from '@pocket/storage-indexeddb';
import { createMemoryStorage } from '@pocket/storage-memory';
import type { Document } from '@pocket/core';

export interface Todo extends Document {
  _id: string;
  title: string;
  completed: boolean;
  createdAt: number;
}

let dbInstance: Database | null = null;

export async function getDatabase(): Promise<Database> {
  if (dbInstance) {
    return dbInstance;
  }

  // Try IndexedDB first, fall back to memory storage
  let storage;
  try {
    storage = createIndexedDBStorage();
  } catch {
    console.warn('IndexedDB not available, using memory storage');
    storage = createMemoryStorage();
  }

  dbInstance = await createDatabase({
    name: 'todo-app',
    storage,
    collections: [
      {
        name: 'todos',
        schema: {
          properties: {
            title: { type: 'string', required: true, min: 1 },
            completed: { type: 'boolean', default: false },
            createdAt: { type: 'number' },
          },
        },
        indexes: [
          { fields: ['completed'] },
          { fields: ['createdAt'] },
        ],
      },
    ],
  });

  return dbInstance;
}
