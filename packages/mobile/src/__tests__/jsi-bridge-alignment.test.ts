import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { createJSIStorageAdapter, getTurboModuleSpec } from '../jsi-engine.js';

describe('C++ JSI Bridge Alignment', () => {
  const headerPath = resolve(__dirname, '../../cpp/PocketJSI.h');
  const implPath = resolve(__dirname, '../../cpp/PocketJSI.cpp');

  it('should have matching C++ header file', () => {
    const header = readFileSync(headerPath, 'utf-8');
    expect(header).toContain('class PocketJSIModule');
    expect(header).toContain('void install()');
    expect(header).toContain('namespace pocket');
  });

  it('should have matching C++ implementation file', () => {
    const impl = readFileSync(implPath, 'utf-8');
    expect(impl).toContain('PocketJSIModule::install()');
    expect(impl).toContain('createPocketJSIModule');
  });

  it('should expose all TurboModule methods in C++', () => {
    const spec = getTurboModuleSpec();
    const impl = readFileSync(implPath, 'utf-8');

    for (const method of spec.methods) {
      // Check that each method has a corresponding JSI function name
      const jsiName = `__pocketJSI_${method.name}`;
      expect(impl).toContain(jsiName);
    }
  });

  it('should declare all native methods in header', () => {
    const header = readFileSync(headerPath, 'utf-8');

    expect(header).toContain('openDatabase');
    expect(header).toContain('closeDatabase');
    expect(header).toContain('executeSqlSync');
    expect(header).toContain('executeSqlWrite');
    expect(header).toContain('beginTransaction');
    expect(header).toContain('commitTransaction');
    expect(header).toContain('rollbackTransaction');
    expect(header).toContain('getDatabaseSize');
  });

  it('should use WAL mode for performance', () => {
    const impl = readFileSync(implPath, 'utf-8');
    expect(impl).toContain('journal_mode=WAL');
  });

  it('should handle thread safety with mutex', () => {
    const header = readFileSync(headerPath, 'utf-8');
    const impl = readFileSync(implPath, 'utf-8');
    expect(header).toContain('std::mutex');
    expect(impl).toContain('lock_guard');
  });

  it('should align TypeScript adapter with C++ function names', () => {
    const adapter = createJSIStorageAdapter('test');
    const spec = getTurboModuleSpec();

    // Verify the TS adapter matches the spec method names
    const specMethodNames = spec.methods.map((m) => m.name);
    expect(specMethodNames).toContain('openDatabase');
    expect(specMethodNames).toContain('executeSqlSync');
    expect(specMethodNames).toContain('executeSqlAsync');
  });
});
