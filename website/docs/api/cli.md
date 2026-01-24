---
sidebar_position: 6
title: CLI Reference
description: Command-line interface for Pocket database
---

# CLI Reference

The Pocket CLI (`@pocket/cli`) provides command-line tools for managing your Pocket database projects.

## Installation

```bash
npm install -g @pocket/cli

# Or use locally via npx
npx pocket <command>
```

## Commands

### pocket init

Initialize a new Pocket project.

```bash
pocket init [name]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `name` | Project name (optional, defaults to directory name) |

**Options:**

| Option | Description |
|--------|-------------|
| `--force` | Overwrite existing configuration |
| `--skip-migrations` | Don't create migrations directory |

**Example:**

```bash
# Initialize in current directory
pocket init

# Initialize with specific name
pocket init my-app

# Force overwrite existing config
pocket init --force
```

**Output:**

Creates `pocket.config.ts` and `migrations/` directory:

```typescript
// pocket.config.ts
import { defineConfig } from '@pocket/cli';

export default defineConfig({
  database: {
    name: 'my-app',
  },
  storage: 'indexeddb',
  collections: {
    // Define your collections here
  },
  migrations: {
    directory: './migrations',
  },
});
```

---

### pocket migrate create

Create a new migration file.

```bash
pocket migrate create <name>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `name` | Migration name (kebab-case recommended) |

**Example:**

```bash
pocket migrate create add-users-collection
```

**Output:**

Creates a timestamped migration file:

```
Created migration: migrations/20240115143022_add-users-collection.ts
```

```typescript
// migrations/20240115143022_add-users-collection.ts
import type { Migration, MigrationContext } from '@pocket/core';

export const migration: Migration = {
  version: 20240115143022,
  name: 'add-users-collection',

  async up(ctx: MigrationContext): Promise<void> {
    // Add your migration logic here
    await ctx.createCollection('users', {
      schema: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string' },
          name: { type: 'string' },
        },
      },
    });
  },

  async down(ctx: MigrationContext): Promise<void> {
    // Rollback logic
    await ctx.dropCollection('users');
  },
};
```

---

### pocket migrate up

Run pending migrations.

```bash
pocket migrate up [count]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `count` | Number of migrations to run (optional, runs all pending) |

**Options:**

| Option | Description |
|--------|-------------|
| `--dry-run` | Show what would be run without executing |

**Example:**

```bash
# Run all pending migrations
pocket migrate up

# Run only next 2 migrations
pocket migrate up 2

# Preview without running
pocket migrate up --dry-run
```

**Output:**

```
Running migrations...
  ✓ 20240115143022_add-users-collection (15ms)
  ✓ 20240116091500_add-email-index (8ms)

Completed 2 migrations in 23ms
```

---

### pocket migrate down

Rollback migrations.

```bash
pocket migrate down [count]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `count` | Number of migrations to rollback (default: 1) |

**Options:**

| Option | Description |
|--------|-------------|
| `--dry-run` | Show what would be rolled back without executing |

**Example:**

```bash
# Rollback last migration
pocket migrate down

# Rollback last 3 migrations
pocket migrate down 3

# Preview without rolling back
pocket migrate down 2 --dry-run
```

**Output:**

```
Rolling back migrations...
  ✓ 20240116091500_add-email-index (5ms)

Rolled back 1 migration in 5ms
```

---

### pocket migrate status

Show migration status.

```bash
pocket migrate status
```

**Output:**

```
Migration Status
================

  Status    Version           Name
  ───────── ───────────────── ────────────────────────────
  ✓ Applied 20240115143022    add-users-collection
  ✓ Applied 20240116091500    add-email-index
  ○ Pending 20240117120000    add-posts-collection

Applied: 2
Pending: 1
```

---

### pocket studio

Launch the data inspection UI.

```bash
pocket studio
```

**Options:**

| Option | Description |
|--------|-------------|
| `--port <port>` | Server port (default: 4983) |
| `--no-open` | Don't open browser automatically |

**Example:**

```bash
# Start studio on default port
pocket studio

# Start on custom port
pocket studio --port 8080

# Don't open browser
pocket studio --no-open
```

**Output:**

```
Pocket Studio is running at http://localhost:4983
Press Ctrl+C to stop
```

The Studio UI provides:
- Collection browser
- Document viewer and editor
- Query builder
- Index management
- Sync status monitoring

---

### pocket export

Export data to JSON or NDJSON.

```bash
pocket export [collection]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `collection` | Collection name (optional, exports all if omitted) |

**Options:**

| Option | Description |
|--------|-------------|
| `-o, --output <file>` | Output file path |
| `--format <format>` | Output format: `json` or `ndjson` (default: `json`) |
| `--pretty` | Pretty-print JSON output |

**Example:**

```bash
# Export all collections to stdout
pocket export

# Export specific collection
pocket export users

# Export to file
pocket export users -o users-backup.json

# Export as NDJSON (newline-delimited JSON)
pocket export users --format ndjson -o users.ndjson

# Pretty-print
pocket export users --pretty
```

**Output (JSON):**

```json
{
  "collection": "users",
  "exportedAt": "2024-01-15T14:30:00.000Z",
  "count": 150,
  "documents": [
    { "_id": "user-1", "email": "alice@example.com", "name": "Alice" },
    { "_id": "user-2", "email": "bob@example.com", "name": "Bob" }
  ]
}
```

**Output (NDJSON):**

```
{"_id":"user-1","email":"alice@example.com","name":"Alice"}
{"_id":"user-2","email":"bob@example.com","name":"Bob"}
```

---

### pocket import

Import data from JSON or NDJSON.

```bash
pocket import <file>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `file` | Input file path |

**Options:**

| Option | Description |
|--------|-------------|
| `--collection <name>` | Target collection (required for NDJSON) |
| `--clear` | Clear collection before importing |
| `--dry-run` | Validate without importing |

**Example:**

```bash
# Import from JSON export
pocket import users-backup.json

# Import NDJSON to specific collection
pocket import users.ndjson --collection users

# Clear and replace
pocket import users-backup.json --clear

# Validate only
pocket import users-backup.json --dry-run
```

**Output:**

```
Importing to 'users' collection...
  ✓ Imported 150 documents in 245ms

Summary:
  - Inserted: 148
  - Updated: 2
  - Errors: 0
```

---

### pocket generate types

Generate TypeScript types from your schema.

```bash
pocket generate types
```

**Options:**

| Option | Description |
|--------|-------------|
| `-o, --output <file>` | Output file path (default: `src/pocket-types.ts`) |

**Example:**

```bash
# Generate to default location
pocket generate types

# Generate to custom location
pocket generate types -o src/types/db.ts
```

**Output:**

```
Generated TypeScript types: src/pocket-types.ts
  - 4 collections
  - 12 interfaces
```

```typescript
// src/pocket-types.ts (generated)

export interface User {
  _id: string;
  email: string;
  name?: string;
  createdAt: Date;
}

export interface Post {
  _id: string;
  title: string;
  content: string;
  authorId: string;
  publishedAt?: Date;
}

// ... more interfaces
```

---

## Configuration

### pocket.config.ts

The configuration file defines your database schema and settings:

```typescript
import { defineConfig } from '@pocket/cli';

export default defineConfig({
  // Database settings
  database: {
    name: 'my-app',
    version: 1,
  },

  // Storage adapter
  storage: 'indexeddb', // or 'opfs', 'memory'

  // Collection definitions
  collections: {
    users: {
      schema: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' },
          name: { type: 'string' },
          role: { type: 'string', enum: ['user', 'admin'] },
          createdAt: { type: 'date' },
        },
      },
      indexes: [
        { fields: ['email'], unique: true },
        { fields: ['role'] },
      ],
    },

    posts: {
      schema: {
        type: 'object',
        required: ['title', 'authorId'],
        properties: {
          title: { type: 'string' },
          content: { type: 'string' },
          authorId: { type: 'string', ref: 'users' },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
      indexes: [
        { fields: ['authorId'] },
        { fields: ['tags'], type: 'multikey' },
      ],
    },
  },

  // Migration settings
  migrations: {
    directory: './migrations',
  },

  // Sync settings (optional)
  sync: {
    serverUrl: 'wss://api.example.com/sync',
    collections: ['users', 'posts'],
  },
});
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `POCKET_CONFIG` | Path to config file (default: `pocket.config.ts`) |
| `POCKET_ENV` | Environment name (default: `development`) |

---

## Global Options

These options work with all commands:

| Option | Description |
|--------|-------------|
| `--help, -h` | Show help |
| `--version, -v` | Show version |

---

## See Also

- [Migrations Guide](/docs/guides/migrations) - Writing migrations
- [Schema Validation](/docs/guides/schema-validation) - Schema syntax
- [Getting Started](/docs/intro) - Quick start guide
