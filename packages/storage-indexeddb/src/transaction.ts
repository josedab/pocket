/**
 * Promise-based wrapper for IndexedDB transactions
 */
export class IDBTransactionWrapper {
  private readonly transaction: IDBTransaction;
  private readonly promise: Promise<void>;
  private resolve!: () => void;
  private reject!: (error: Error) => void;

  constructor(transaction: IDBTransaction) {
    this.transaction = transaction;

    this.promise = new Promise<void>((res, rej) => {
      this.resolve = res;
      this.reject = rej;
    });

    transaction.oncomplete = () => this.resolve();
    transaction.onerror = () =>
      this.reject(new Error(transaction.error?.message ?? 'Transaction failed'));
    transaction.onabort = () => this.reject(new Error('Transaction aborted'));
  }

  /**
   * Get an object store
   */
  objectStore(name: string): IDBObjectStore {
    return this.transaction.objectStore(name);
  }

  /**
   * Wait for transaction to complete
   */
  async complete(): Promise<void> {
    return this.promise;
  }

  /**
   * Abort the transaction
   */
  abort(): void {
    this.transaction.abort();
  }
}

/**
 * Promise wrapper for IDBRequest
 */
export function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(request.error?.message ?? 'Request failed'));
  });
}

/**
 * Promise wrapper for cursor iteration
 */
export async function iterateCursor(
  request: IDBRequest<IDBCursorWithValue | null>,
  callback: (value: unknown, cursor: IDBCursorWithValue) => boolean | undefined
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    request.onsuccess = (): void => {
      const cursor = request.result;
      if (cursor) {
        const shouldContinue = callback(cursor.value as unknown, cursor);
        if (shouldContinue !== false) {
          cursor.continue();
        } else {
          resolve();
        }
      } else {
        resolve();
      }
    };
    request.onerror = (): void => {
      reject(new Error(request.error?.message ?? 'Cursor iteration failed'));
    };
  });
}

/**
 * Collect all values from a cursor
 */
export async function collectCursor<T>(
  request: IDBRequest<IDBCursorWithValue | null>,
  limit?: number
): Promise<T[]> {
  const results: T[] = [];

  await iterateCursor(request, (value): boolean | undefined => {
    results.push(value as T);
    if (limit && results.length >= limit) {
      return false;
    }
    return undefined;
  });

  return results;
}

/**
 * Open an IndexedDB database
 */
export function openDatabase(
  name: string,
  version: number,
  onUpgrade: (db: IDBDatabase, oldVersion: number, newVersion: number) => void
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;
      const newVersion = event.newVersion ?? version;
      onUpgrade(db, oldVersion, newVersion);
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(request.error?.message ?? 'Failed to open database'));
    request.onblocked = () => reject(new Error('Database blocked - close other tabs'));
  });
}

/**
 * Delete an IndexedDB database
 */
export function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(new Error(request.error?.message ?? 'Failed to delete database'));
  });
}
