import type { DatabaseSnapshot, DataIntegrity } from './types.js';

export interface IntegrityChecker {
  generateChecksum(data: string): string;
  verify(data: string, checksum: string): boolean;
  computeStats(snapshot: DatabaseSnapshot): DataIntegrity;
}

// Simple hash function for checksum generation (FNV-1a inspired)
function simpleHash(data: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Convert to unsigned 32-bit and then to hex
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createIntegrityChecker(): IntegrityChecker {
  function generateChecksum(data: string): string {
    return simpleHash(data);
  }

  function verify(data: string, checksum: string): boolean {
    return generateChecksum(data) === checksum;
  }

  function computeStats(snapshot: DatabaseSnapshot): DataIntegrity {
    let documentCount = 0;
    for (const collection of snapshot.collections) {
      documentCount += collection.documents.length;
    }

    const serialized = JSON.stringify(snapshot);
    const checksum = generateChecksum(serialized);

    return {
      checksum,
      documentCount,
      valid: true,
    };
  }

  return {
    generateChecksum,
    verify,
    computeStats,
  };
}
