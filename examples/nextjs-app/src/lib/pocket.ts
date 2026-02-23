import type { ServerLoaderConfig } from '@pocket/next';
import { Database } from '@pocket/core';
import { createMemoryStorage } from '@pocket/storage-memory';

/** Server loader configuration for fetching initial data during SSR. */
export const serverLoaderConfig: ServerLoaderConfig = {
  serverUrl: process.env.POCKET_SERVER_URL ?? 'http://localhost:4000',
  authToken: process.env.POCKET_AUTH_TOKEN,
  timeout: 5000,
};

export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: number;
}

/** Create a client-side Pocket database with in-memory storage. */
export function createClientDatabase(): Promise<Database> {
  return Database.create({
    name: 'pocket-nextjs-example',
    storage: createMemoryStorage(),
  });
}
