import type { GeneratedFile, SchemaDiff, SchemaDefinition } from './types.js';

export interface MigrationGenerator {
  generate(fromSchema: SchemaDefinition, toSchema: SchemaDefinition): GeneratedFile[];
  detectChanges(from: SchemaDefinition, to: SchemaDefinition): SchemaDiff[];
}

/**
 * Creates a generator that produces migration files between schema versions.
 */
export function createMigrationGenerator(): MigrationGenerator {
  function detectChanges(from: SchemaDefinition, to: SchemaDefinition): SchemaDiff[] {
    const diffs: SchemaDiff[] = [];

    const fromCollections = new Map(from.collections.map((c) => [c.name, c]));
    const toCollections = new Map(to.collections.map((c) => [c.name, c]));

    // Detect removed collections
    for (const name of fromCollections.keys()) {
      if (!toCollections.has(name)) {
        diffs.push({ type: 'remove-collection', collection: name });
      }
    }

    // Detect added collections
    for (const name of toCollections.keys()) {
      if (!fromCollections.has(name)) {
        diffs.push({ type: 'add-collection', collection: name });
      }
    }

    // Detect field changes in existing collections
    for (const [name, toCol] of toCollections) {
      const fromCol = fromCollections.get(name);
      if (!fromCol) continue;

      const fromFields = new Map(fromCol.fields.map((f) => [f.name, f]));
      const toFields = new Map(toCol.fields.map((f) => [f.name, f]));

      for (const fieldName of fromFields.keys()) {
        if (!toFields.has(fieldName)) {
          diffs.push({ type: 'remove-field', collection: name, field: fieldName });
        }
      }

      for (const [fieldName, toField] of toFields) {
        const fromField = fromFields.get(fieldName);
        if (!fromField) {
          diffs.push({ type: 'add-field', collection: name, field: fieldName });
        } else if (fromField.type !== toField.type) {
          diffs.push({
            type: 'change-field-type',
            collection: name,
            field: fieldName,
            from: fromField.type,
            to: toField.type,
          });
        }
      }
    }

    return diffs;
  }

  function generate(fromSchema: SchemaDefinition, toSchema: SchemaDefinition): GeneratedFile[] {
    const diffs = detectChanges(fromSchema, toSchema);
    if (diffs.length === 0) {
      return [];
    }

    const timestamp = Date.now();
    const lines: string[] = [
      '// Auto-generated migration by @pocket/codegen-fullstack',
      `// From version ${fromSchema.version} to ${toSchema.version}`,
      '// Do not edit manually',
      '',
      'export const migration = {',
      `  version: '${toSchema.version}',`,
      `  timestamp: ${timestamp},`,
      '',
      '  async up(db: any) {',
    ];

    for (const diff of diffs) {
      switch (diff.type) {
        case 'add-collection':
          lines.push(`    await db.createCollection('${diff.collection}');`);
          break;
        case 'remove-collection':
          lines.push(`    await db.dropCollection('${diff.collection}');`);
          break;
        case 'add-field':
          lines.push(`    await db.addField('${diff.collection}', '${diff.field}');`);
          break;
        case 'remove-field':
          lines.push(`    await db.removeField('${diff.collection}', '${diff.field}');`);
          break;
        case 'change-field-type':
          lines.push(`    await db.changeFieldType('${diff.collection}', '${diff.field}', '${diff.to}');`);
          break;
      }
    }

    lines.push('  },');
    lines.push('');
    lines.push('  async down(db: any) {');

    // Reverse operations
    for (const diff of [...diffs].reverse()) {
      switch (diff.type) {
        case 'add-collection':
          lines.push(`    await db.dropCollection('${diff.collection}');`);
          break;
        case 'remove-collection':
          lines.push(`    await db.createCollection('${diff.collection}');`);
          break;
        case 'add-field':
          lines.push(`    await db.removeField('${diff.collection}', '${diff.field}');`);
          break;
        case 'remove-field':
          lines.push(`    await db.addField('${diff.collection}', '${diff.field}');`);
          break;
        case 'change-field-type':
          lines.push(`    await db.changeFieldType('${diff.collection}', '${diff.field}', '${diff.from}');`);
          break;
      }
    }

    lines.push('  },');
    lines.push('};');
    lines.push('');

    return [
      {
        path: `migrations/${timestamp}-${fromSchema.version}-to-${toSchema.version}.ts`,
        content: lines.join('\n'),
        overwrite: false,
      },
    ];
  }

  return { generate, detectChanges };
}
