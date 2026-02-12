import type { ConsistencyCheckResult, DataDifference, TestClient } from './types.js';

export interface ConsistencyChecker {
  assertEventualConsistency(clients: TestClient[], timeoutMs?: number): Promise<ConsistencyCheckResult>;
  checkPairwise(clientA: TestClient, clientB: TestClient): DataDifference[];
  assertDocumentExists(client: TestClient, collection: string, docId: string): void;
  assertDocumentEquals(client: TestClient, collection: string, docId: string, expected: unknown): void;
}

export function createConsistencyChecker(): ConsistencyChecker {
  function checkPairwise(clientA: TestClient, clientB: TestClient): DataDifference[] {
    const differences: DataDifference[] = [];
    const dataA = clientA.getData();
    const dataB = clientB.getData();

    const allKeys = new Set([...dataA.keys(), ...dataB.keys()]);

    for (const key of allKeys) {
      const valA = dataA.get(key);
      const valB = dataB.get(key);

      if (valA === undefined && valB !== undefined) {
        differences.push({
          collection: 'default',
          documentId: key,
          field: '_exists',
          localValue: undefined,
          remoteValue: valB,
        });
      } else if (valA !== undefined && valB === undefined) {
        differences.push({
          collection: 'default',
          documentId: key,
          field: '_exists',
          localValue: valA,
          remoteValue: undefined,
        });
      } else if (JSON.stringify(valA) !== JSON.stringify(valB)) {
        // Compare field-level differences for objects
        if (typeof valA === 'object' && typeof valB === 'object' && valA !== null && valB !== null) {
          const objA = valA as Record<string, unknown>;
          const objB = valB as Record<string, unknown>;
          const allFields = new Set([...Object.keys(objA), ...Object.keys(objB)]);

          for (const field of allFields) {
            if (JSON.stringify(objA[field]) !== JSON.stringify(objB[field])) {
              differences.push({
                collection: 'default',
                documentId: key,
                field,
                localValue: objA[field],
                remoteValue: objB[field],
              });
            }
          }
        } else {
          differences.push({
            collection: 'default',
            documentId: key,
            field: '_value',
            localValue: valA,
            remoteValue: valB,
          });
        }
      }
    }

    return differences;
  }

  async function assertEventualConsistency(
    clients: TestClient[],
    timeoutMs = 5000,
  ): Promise<ConsistencyCheckResult> {
    const startTime = Date.now();
    let allDifferences: DataDifference[] = [];

    while (Date.now() - startTime < timeoutMs) {
      allDifferences = [];

      for (let i = 0; i < clients.length - 1; i++) {
        for (let j = i + 1; j < clients.length; j++) {
          const diffs = checkPairwise(clients[i]!, clients[j]!);
          allDifferences.push(...diffs);
        }
      }

      if (allDifferences.length === 0) {
        return {
          consistent: true,
          differences: [],
          checkedAt: Date.now(),
        };
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return {
      consistent: false,
      differences: allDifferences,
      checkedAt: Date.now(),
    };
  }

  function assertDocumentExists(client: TestClient, collection: string, docId: string): void {
    const key = `${collection}:${docId}`;
    const data = client.getData();
    if (!data.has(key)) {
      throw new Error(`Document "${docId}" not found in collection "${collection}" on client "${client.id}"`);
    }
  }

  function assertDocumentEquals(client: TestClient, collection: string, docId: string, expected: unknown): void {
    const key = `${collection}:${docId}`;
    const data = client.getData();
    const actual = data.get(key);

    if (actual === undefined) {
      throw new Error(`Document "${docId}" not found in collection "${collection}" on client "${client.id}"`);
    }

    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `Document "${docId}" in collection "${collection}" does not match expected value.\n` +
          `Expected: ${JSON.stringify(expected)}\n` +
          `Actual: ${JSON.stringify(actual)}`,
      );
    }
  }

  return {
    assertEventualConsistency,
    checkPairwise,
    assertDocumentExists,
    assertDocumentEquals,
  };
}
