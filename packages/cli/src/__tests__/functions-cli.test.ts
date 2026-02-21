import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  functionsInitCommand,
  functionsDeployCommand,
  functionsListCommand,
  functionsRemoveCommand,
} from '../commands/functions.js';

describe('functions commands', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-fn-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('functionsInitCommand', () => {
    it('should create config and handler files', async () => {
      const result = await functionsInitCommand(tmpDir);

      expect(result.success).toBe(true);
      expect(result.action).toBe('init');
      expect(fs.existsSync(path.join(tmpDir, 'pocket-functions.json'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'onUserInsert.ts'))).toBe(true);

      const config = JSON.parse(
        fs.readFileSync(path.join(tmpDir, 'pocket-functions.json'), 'utf-8'),
      );
      expect(config).toHaveLength(1);
      expect(config[0].name).toBe('onUserInsert');
    });
  });

  describe('functionsDeployCommand', () => {
    it('should read config and generate manifest', async () => {
      // Setup config
      const configPath = path.join(tmpDir, 'pocket-functions.json');
      const defs = [
        { name: 'fn1', collection: 'items', trigger: 'afterInsert', handlerFile: './fn1.ts' },
      ];
      fs.writeFileSync(configPath, JSON.stringify(defs));

      const outDir = path.join(tmpDir, 'deploy');
      const result = await functionsDeployCommand(configPath, outDir);

      expect(result.success).toBe(true);
      expect(result.action).toBe('deploy');
      expect(result.functions).toHaveLength(1);

      const manifest = JSON.parse(
        fs.readFileSync(path.join(outDir, 'functions-manifest.json'), 'utf-8'),
      );
      expect(manifest.version).toBe('1.0.0');
      expect(manifest.functions).toHaveLength(1);
      expect(manifest.functions[0].name).toBe('fn1');
    });

    it('should return error for invalid config', async () => {
      const configPath = path.join(tmpDir, 'bad.json');
      fs.writeFileSync(configPath, '{ not valid json }}}');

      const result = await functionsDeployCommand(configPath);

      expect(result.success).toBe(false);
      expect(result.action).toBe('deploy');
    });

    it('should return error when required fields are missing', async () => {
      const configPath = path.join(tmpDir, 'pocket-functions.json');
      const defs = [{ name: 'fn1', handlerFile: './fn1.ts' }];
      fs.writeFileSync(configPath, JSON.stringify(defs));

      const result = await functionsDeployCommand(configPath);

      expect(result.success).toBe(false);
      expect(result.message).toContain('collection');
    });
  });

  describe('functionsListCommand', () => {
    it('should return function definitions', async () => {
      const configPath = path.join(tmpDir, 'pocket-functions.json');
      const defs = [
        { name: 'fn1', collection: 'items', trigger: 'afterInsert', handlerFile: './fn1.ts' },
        { name: 'fn2', collection: 'users', trigger: 'afterUpdate', handlerFile: './fn2.ts' },
      ];
      fs.writeFileSync(configPath, JSON.stringify(defs));

      const result = await functionsListCommand(configPath);

      expect(result.success).toBe(true);
      expect(result.action).toBe('list');
      expect(result.functions).toHaveLength(2);
      expect(result.functions![0]!.trigger).toBe('afterInsert');
      expect(result.functions![1]!.trigger).toBe('afterUpdate');
    });
  });

  describe('functionsRemoveCommand', () => {
    it('should delete a function from config', async () => {
      const configPath = path.join(tmpDir, 'pocket-functions.json');
      const defs = [
        { name: 'fn1', collection: 'items', trigger: 'afterInsert', handlerFile: './fn1.ts' },
        { name: 'fn2', collection: 'users', trigger: 'afterUpdate', handlerFile: './fn2.ts' },
      ];
      fs.writeFileSync(configPath, JSON.stringify(defs));

      const result = await functionsRemoveCommand(configPath, 'fn1');

      expect(result.success).toBe(true);
      expect(result.action).toBe('remove');
      expect(result.functions).toHaveLength(1);
      expect(result.functions![0]!.name).toBe('fn2');

      // Verify file was updated
      const updated = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(updated).toHaveLength(1);
    });

    it('should return error when function not found', async () => {
      const configPath = path.join(tmpDir, 'pocket-functions.json');
      fs.writeFileSync(configPath, JSON.stringify([]));

      const result = await functionsRemoveCommand(configPath, 'nonexistent');

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });
  });
});
