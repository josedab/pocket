import '@testing-library/jest-dom/vitest';

// Mock window.crypto for environments that don't have it
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = {
    randomUUID: () => {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    },
    getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
      if (array) {
        const bytes = new Uint8Array(
          array.buffer,
          array.byteOffset,
          array.byteLength
        );
        for (let i = 0; i < bytes.length; i++) {
          bytes[i] = Math.floor(Math.random() * 256);
        }
      }
      return array;
    },
  } as Crypto;
}

// Clean up after each test
afterEach(() => {
  // Clean up any mounted components
});
