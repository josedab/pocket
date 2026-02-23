# @pocket/portable-export

Portable data export/import for Pocket databases — JSON, CSV, SQL, and NDJSON formats.

## Installation

```bash
pnpm add @pocket/portable-export
```

## Features

- Export to JSON, CSV, SQL, and NDJSON formats
- Import data from multiple formats with auto-detection
- Encrypted backup and restore
- Streaming export for large datasets
- Data integrity verification
- Competitor database import support

## Usage

```typescript
import { createExportManager, createJsonExporter } from '@pocket/portable-export';

const manager = createExportManager(db);
await manager.export({ format: 'json', output: './backup.json' });

const json = createJsonExporter();
const data = await json.export(collection);
```

## API Reference

- `createExportManager` — Orchestrate exports across formats
- `createJsonExporter` — JSON format exporter
- `createCsvExporter` — CSV format exporter
- `createSqlExporter` — SQL format exporter
- `createNdjsonExporter` — NDJSON format exporter
- `createImporter` — Multi-format importer
- `createStreamingExporter` — Stream-based export for large datasets
- `createEncryptedBackup` — Encrypted backup/restore
- `createIntegrityChecker` — Verify export data integrity
- `createCompetitorImporter` — Import from other databases
- `createFormatDetector` — Auto-detect file format

## License

MIT
