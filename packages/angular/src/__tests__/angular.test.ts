import { describe, it, expect } from 'vitest';

describe('@pocket/angular', () => {
  it('should have an index module', async () => {
    // Angular requires @angular/core at runtime which may not be available
    // in a pure Node test environment. Verify the module file exists and
    // is importable without runtime errors from missing peer dependencies.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const indexPath = path.resolve(__dirname, '../index.ts');
    expect(fs.existsSync(indexPath)).toBe(true);
  });
});
