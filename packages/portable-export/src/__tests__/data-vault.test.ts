import { describe, expect, it } from 'vitest';
import { DataVault } from '../data-vault.js';

describe('DataVault', () => {
  const mockDb = {
    name: 'test-db',
    listCollections: async () => ['users', 'posts'],
    collection: (name: string) => ({
      find: () => ({
        exec: async () =>
          name === 'users'
            ? [
                { _id: 'u1', name: 'Alice' },
                { _id: 'u2', name: 'Bob' },
              ]
            : [{ _id: 'p1', title: 'Hello World' }],
      }),
    }),
  };

  it('should export database to vault format', async () => {
    const vault = new DataVault();
    const result = await vault.export(mockDb);

    expect(result.header.magic).toBe('POCKET_VAULT');
    expect(result.header.version).toBe(1);
    expect(result.header.collectionCount).toBe(2);
    expect(result.header.documentCount).toBe(3);
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it('should import vault data', async () => {
    const vault = new DataVault();
    const exported = await vault.export(mockDb);
    const result = await vault.import(exported.data);

    expect(result.collections).toHaveLength(2);
    expect(result.documentsImported).toBe(3);
    expect(result.errors).toHaveLength(0);
  });

  it('should inspect vault without importing', async () => {
    const vault = new DataVault();
    const exported = await vault.export(mockDb);
    const info = vault.inspect(exported.data);

    expect(info.header.magic).toBe('POCKET_VAULT');
    expect(info.collections).toHaveLength(2);
    expect(info.collections[0]!.documentCount).toBe(2);
    expect(info.collections[1]!.documentCount).toBe(1);
  });

  it('should export with encryption', async () => {
    const vault = new DataVault();
    const result = await vault.export(mockDb, { passphrase: 'my-secret' });
    expect(result.header.encrypted).toBe(true);
  });

  it('should import encrypted vault with correct passphrase', async () => {
    const vault = new DataVault();
    const exported = await vault.export(mockDb, { passphrase: 'secret123' });
    const imported = await vault.import(exported.data, { passphrase: 'secret123' });
    expect(imported.documentsImported).toBe(3);
  });

  it('should reject import without passphrase for encrypted vault', async () => {
    const vault = new DataVault();
    const exported = await vault.export(mockDb, { passphrase: 'secret' });
    await expect(vault.import(exported.data)).rejects.toThrow('passphrase');
  });

  it('should reject invalid vault format', async () => {
    const vault = new DataVault();
    await expect(vault.import(JSON.stringify({ header: { magic: 'WRONG' } }))).rejects.toThrow(
      'Invalid vault'
    );
  });

  it('should export with custom description', async () => {
    const vault = new DataVault();
    const result = await vault.export(mockDb, { description: 'Weekly backup' });
    expect(result.header.description).toBe('Weekly backup');
  });

  it('should export specific collections', async () => {
    const vault = new DataVault();
    const result = await vault.export(mockDb, { collections: ['users'] });
    expect(result.header.collectionCount).toBe(1);
    expect(result.header.documentCount).toBe(2);
  });

  it('should support collection name mapping on import', async () => {
    const vault = new DataVault();
    const exported = await vault.export(mockDb);
    const imported = await vault.import(exported.data, {
      targetCollections: { users: 'accounts' },
    });
    expect(imported.collections).toContain('accounts');
  });
});
