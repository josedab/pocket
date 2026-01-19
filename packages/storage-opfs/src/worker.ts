/**
 * OPFS Worker - handles file operations in a Web Worker
 */

/// <reference path="./fs-types.d.ts" />
import type { Document } from '@pocket/core';

/**
 * Worker message types
 */
export type WorkerRequest =
  | { type: 'init'; dbName: string }
  | { type: 'get'; collection: string; id: string }
  | { type: 'getAll'; collection: string }
  | { type: 'put'; collection: string; doc: Document }
  | { type: 'bulkPut'; collection: string; docs: Document[] }
  | { type: 'delete'; collection: string; id: string }
  | { type: 'clear'; collection: string }
  | { type: 'close' };

export type WorkerResponse =
  | { type: 'success'; data?: unknown }
  | { type: 'error'; message: string };

// Worker state
let rootDir: FileSystemDirectoryHandle | null = null;
let dbDir: FileSystemDirectoryHandle | null = null;
const collectionDirs = new Map<string, FileSystemDirectoryHandle>();

/**
 * Initialize the worker with database name
 */
async function init(dbName: string): Promise<void> {
  rootDir = await navigator.storage.getDirectory();
  dbDir = await rootDir.getDirectoryHandle(dbName, { create: true });
}

/**
 * Get or create a collection directory
 */
async function getCollectionDir(name: string): Promise<FileSystemDirectoryHandle> {
  let dir = collectionDirs.get(name);
  if (!dir && dbDir) {
    dir = await dbDir.getDirectoryHandle(name, { create: true });
    collectionDirs.set(name, dir);
  }
  if (!dir) {
    throw new Error('Database not initialized');
  }
  return dir;
}

/**
 * Get a document from a collection
 */
async function getDocument(collection: string, id: string): Promise<Document | null> {
  try {
    const dir = await getCollectionDir(collection);
    const fileHandle = await dir.getFileHandle(`${id}.json`);
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Get all documents from a collection
 */
async function getAllDocuments(collection: string): Promise<Document[]> {
  const dir = await getCollectionDir(collection);
  const docs: Document[] = [];

  for await (const [name, handle] of dir.entries()) {
    if (name.endsWith('.json') && handle.kind === 'file') {
      try {
        const file = await (handle as FileSystemFileHandle).getFile();
        const text = await file.text();
        docs.push(JSON.parse(text));
      } catch {
        // Skip corrupted files
      }
    }
  }

  return docs;
}

/**
 * Put a document in a collection
 */
async function putDocument(collection: string, doc: Document): Promise<Document> {
  const dir = await getCollectionDir(collection);
  const fileHandle = await dir.getFileHandle(`${doc._id}.json`, { create: true });

  // Use sync access handle for better performance if available
  const hasSyncAccess = 'createSyncAccessHandle' in fileHandle;
  if (hasSyncAccess) {
    const accessHandle = await (fileHandle as FileSystemFileHandle).createSyncAccessHandle();
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(doc));
    accessHandle.truncate(0);
    accessHandle.write(data);
    accessHandle.flush();
    accessHandle.close();
  } else {
    const writable = await (fileHandle as FileSystemFileHandle).createWritable();
    await writable.write(JSON.stringify(doc));
    await writable.close();
  }

  return doc;
}

/**
 * Bulk put documents
 */
async function bulkPutDocuments(collection: string, docs: Document[]): Promise<Document[]> {
  const results: Document[] = [];
  for (const doc of docs) {
    results.push(await putDocument(collection, doc));
  }
  return results;
}

/**
 * Delete a document from a collection
 */
async function deleteDocument(collection: string, id: string): Promise<void> {
  try {
    const dir = await getCollectionDir(collection);
    await dir.removeEntry(`${id}.json`);
  } catch {
    // File might not exist
  }
}

/**
 * Clear all documents from a collection
 */
async function clearCollection(collection: string): Promise<void> {
  const dir = await getCollectionDir(collection);

  const entries: string[] = [];
  for await (const [name] of dir.entries()) {
    entries.push(name);
  }

  for (const name of entries) {
    await dir.removeEntry(name);
  }
}

/**
 * Close the worker
 */
function close(): void {
  rootDir = null;
  dbDir = null;
  collectionDirs.clear();
}

/**
 * Handle incoming messages
 */
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  let response: WorkerResponse;

  try {
    switch (request.type) {
      case 'init':
        await init(request.dbName);
        response = { type: 'success' };
        break;

      case 'get': {
        const doc = await getDocument(request.collection, request.id);
        response = { type: 'success', data: doc };
        break;
      }

      case 'getAll': {
        const docs = await getAllDocuments(request.collection);
        response = { type: 'success', data: docs };
        break;
      }

      case 'put': {
        const saved = await putDocument(request.collection, request.doc);
        response = { type: 'success', data: saved };
        break;
      }

      case 'bulkPut': {
        const savedDocs = await bulkPutDocuments(request.collection, request.docs);
        response = { type: 'success', data: savedDocs };
        break;
      }

      case 'delete':
        await deleteDocument(request.collection, request.id);
        response = { type: 'success' };
        break;

      case 'clear':
        await clearCollection(request.collection);
        response = { type: 'success' };
        break;

      case 'close':
        close();
        response = { type: 'success' };
        break;

      default:
        response = { type: 'error', message: 'Unknown request type' };
    }
  } catch (error) {
    response = {
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  self.postMessage(response);
};
