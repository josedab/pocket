import type { ConflictScenario } from './types.js';

export interface ConflictInjector {
  injectConflict<T extends Record<string, unknown>>(scenario: ConflictScenario): { localDoc: T; remoteDoc: T };
  generateConcurrentEdits(docId: string, count: number): ConflictScenario[];
  generateFieldConflict(docId: string, field: string, localVal: unknown, remoteVal: unknown): ConflictScenario;
}

export function createConflictInjector(): ConflictInjector {
  function injectConflict<T extends Record<string, unknown>>(scenario: ConflictScenario): { localDoc: T; remoteDoc: T } {
    const localDoc = {
      _id: scenario.documentId,
      ...scenario.localChanges,
    } as unknown as T;

    const remoteDoc = {
      _id: scenario.documentId,
      ...scenario.remoteChanges,
    } as unknown as T;

    return { localDoc, remoteDoc };
  }

  function generateConcurrentEdits(docId: string, count: number): ConflictScenario[] {
    const scenarios: ConflictScenario[] = [];

    for (let i = 0; i < count; i++) {
      scenarios.push({
        documentId: docId,
        localChanges: { [`field_${i}`]: `local_value_${i}`, _updatedAt: Date.now() + i },
        remoteChanges: { [`field_${i}`]: `remote_value_${i}`, _updatedAt: Date.now() + i + 1 },
      });
    }

    return scenarios;
  }

  function generateFieldConflict(docId: string, field: string, localVal: unknown, remoteVal: unknown): ConflictScenario {
    return {
      documentId: docId,
      localChanges: { [field]: localVal },
      remoteChanges: { [field]: remoteVal },
    };
  }

  return {
    injectConflict,
    generateConcurrentEdits,
    generateFieldConflict,
  };
}
