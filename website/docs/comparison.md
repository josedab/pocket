---
sidebar_position: 102
title: Comparison
description: How Pocket compares to other solutions
---

# Comparison

How Pocket compares to other local and client-side database solutions.

## Quick Comparison

| Feature | Pocket | PouchDB | RxDB | Dexie | Firebase |
|---------|--------|---------|------|-------|----------|
| Local-first | Yes | Yes | Yes | Yes | No |
| TypeScript | Native | Partial | Native | Good | Good |
| Reactive queries | Yes | No | Yes | Yes | Yes |
| Bundle size | ~25KB | ~46KB | ~35KB | ~22KB | ~100KB+ |
| React hooks | Built-in | No | Add-on | Add-on | Built-in |
| Sync built-in | Yes | Yes | Yes | No | Yes |
| Offline support | Full | Full | Full | Full | Partial |
| Schema validation | Yes | No | Yes | Partial | Yes |

## Pocket vs PouchDB

[PouchDB](https://pouchdb.com/) is a mature CouchDB-compatible database.

### When to choose PouchDB

- You need CouchDB/Cloudant sync compatibility
- You're already using CouchDB ecosystem
- You need attachment support

### When to choose Pocket

- You want modern TypeScript support
- You need reactive queries
- You want React hooks out of the box
- You prefer a simpler API
- Bundle size matters

### Code Comparison

```typescript
// PouchDB
const db = new PouchDB('my-db');
await db.put({ _id: '1', title: 'Todo' });
const doc = await db.get('1');

// Listen to changes (no live queries)
db.changes({ live: true }).on('change', (change) => {
  // Re-query manually
});

// Pocket
const db = await Database.create({ name: 'my-db', storage: createIndexedDBStorage() });
await todos.insert({ _id: '1', title: 'Todo' });

// Live queries
todos.find().live().subscribe((results) => {
  // Automatic updates
});
```

---

## Pocket vs RxDB

[RxDB](https://rxdb.info/) is a reactive database built on RxJS.

### When to choose RxDB

- You need advanced replication plugins
- You want GraphQL integration
- You need leader election for multi-tab

### When to choose Pocket

- You want simpler setup
- You prefer lighter bundle size
- TypeScript inference is important
- You want straightforward React integration

### Code Comparison

```typescript
// RxDB
const db = await createRxDatabase({
  name: 'my-db',
  storage: getRxStorageIndexedDB(),
});

await db.addCollections({
  todos: {
    schema: {
      version: 0,
      primaryKey: 'id',
      properties: { /* ... */ },
      required: ['title'],
    },
  },
});

// Pocket
const db = await Database.create({
  name: 'my-db',
  storage: createIndexedDBStorage(),
  collections: [
    {
      name: 'todos',
      schema: { /* ... */ },
    },
  ],
});
```

---

## Pocket vs Dexie

[Dexie](https://dexie.org/) is a popular IndexedDB wrapper.

### When to choose Dexie

- You only need IndexedDB wrapper (no sync)
- You want the smallest bundle
- You don't need built-in React support

### When to choose Pocket

- You need sync capability
- You want live reactive queries
- You want React hooks built-in
- You need schema validation

### Code Comparison

```typescript
// Dexie
const db = new Dexie('my-db');
db.version(1).stores({ todos: '_id, completed' });

await db.todos.add({ _id: '1', title: 'Todo' });
const results = await db.todos.where('completed').equals(false).toArray();

// Live query (requires useLiveQuery from dexie-react-hooks)
const todos = useLiveQuery(() =>
  db.todos.where('completed').equals(false).toArray()
);

// Pocket
const db = await Database.create({ name: 'my-db', storage: createIndexedDBStorage() });

await todos.insert({ _id: '1', title: 'Todo' });
const { data } = useLiveQuery('todos', (c) =>
  c.find().where('completed').equals(false)
);
```

---

## Pocket vs Firebase/Firestore

[Firebase](https://firebase.google.com/docs/firestore) is Google's cloud database service.

### When to choose Firebase

- You want managed infrastructure
- You need real-time collaboration at scale
- You're already in the Google Cloud ecosystem
- You need authentication built-in

### When to choose Pocket

- You want local-first (data on device)
- You need full offline support
- You want to own your data/backend
- Bundle size and performance matter
- You want to avoid vendor lock-in

### Architecture Difference

```
Firebase:                    Pocket:
┌─────────┐                 ┌─────────┐
│  User   │                 │  User   │
└────┬────┘                 └────┬────┘
     │                           │
     │ (always)                  │ (local)
     ▼                           ▼
┌─────────┐                 ┌─────────┐
│Firebase │                 │ Browser │
│ Server  │                 │   DB    │
└─────────┘                 └────┬────┘
                                 │ (when online)
                                 ▼
                            ┌─────────┐
                            │  Your   │
                            │ Server  │
                            └─────────┘
```

---

## Pocket vs Supabase

[Supabase](https://supabase.com/) is an open-source Firebase alternative with Postgres.

### When to choose Supabase

- You want SQL and Postgres features
- You need complex server-side queries
- You want managed auth/storage/functions
- Real-time at scale is important

### When to choose Pocket

- Local-first is your architecture
- Offline support is critical
- You want simpler client-side data
- You don't need a managed backend

---

## Pocket vs SQL.js/WASM SQLite

[SQL.js](https://sql.js.org/) runs SQLite in the browser via WebAssembly.

### When to choose SQL.js

- You need SQL query language
- You're migrating from SQLite
- You need complex joins/aggregations

### When to choose Pocket

- You prefer document model
- Bundle size matters (~2MB for SQL.js)
- You want reactive queries
- Simpler is better for your use case

---

## Desktop Apps: Electron vs Tauri

When building desktop applications with Pocket, you have two main options.

### Electron

[Electron](https://www.electronjs.org/) wraps your web app with Chromium and Node.js.

| Pros | Cons |
|------|------|
| Mature ecosystem | Large bundle (~150MB) |
| Full Node.js access | Higher memory usage |
| Extensive documentation | Slower startup |
| Easy debugging | Security requires care |

**Pocket with Electron:**
```typescript
import { Database } from '@pocket/core';
import { createElectronStorage } from '@pocket/electron';

const db = await Database.create({
  name: 'my-app',
  storage: createElectronStorage({
    path: path.join(app.getPath('userData'), 'pocket.db'),
  }),
});
```

See: [Electron Integration Guide](/docs/guides/electron-integration)

### Tauri

[Tauri](https://tauri.app/) uses native webviews with a Rust backend.

| Pros | Cons |
|------|------|
| Tiny bundle (~5MB) | Rust knowledge helpful |
| Low memory usage | Smaller ecosystem |
| Fast startup | Webview differences |
| Better security | Fewer built-in features |

**Pocket with Tauri:**
```typescript
import { Database } from '@pocket/core';
import { createTauriStorage } from '@pocket/tauri';

const db = await Database.create({
  name: 'my-app',
  storage: createTauriStorage({ path: 'pocket.db' }),
});
```

See: [Tauri Integration Guide](/docs/guides/tauri-integration)

### When to Choose Each

**Choose Electron if:**
- You need full Node.js APIs
- Team is more comfortable with JavaScript
- You need a mature ecosystem
- Bundle size isn't critical

**Choose Tauri if:**
- Bundle size matters
- You want better performance
- Security is a priority
- You're comfortable with some Rust

---

## Mobile Apps: React Native vs Expo

For mobile applications with Pocket.

### React Native (Bare)

Direct React Native with native modules.

| Pros | Cons |
|------|------|
| Full native access | Complex setup |
| Any native library | Native build tools needed |
| Performance control | Steeper learning curve |

### Expo

Managed workflow with pre-built native modules.

| Pros | Cons |
|------|------|
| Easy setup | Limited native modules |
| OTA updates | Larger app size |
| Expo Go for dev | Some features need eject |

**Pocket with Expo:**
```typescript
import { Database } from '@pocket/core';
import { createExpoStorage } from '@pocket/expo';

const db = await Database.create({
  name: 'my-app',
  storage: createExpoStorage(),
});
```

See: [Expo Integration Guide](/docs/guides/expo-integration) | [React Native Guide](/docs/guides/react-native)

---

## Summary: When to Use Pocket

**Choose Pocket if you:**

- Want data to live on the client first
- Need apps that work offline
- Are building with React
- Value TypeScript and type safety
- Want reactive UI updates
- Need optional server sync
- Prefer smaller bundle sizes
- Want a simple, modern API

**Consider alternatives if you:**

- Need CouchDB compatibility → PouchDB
- Need SQL queries → SQL.js
- Need managed cloud infrastructure → Firebase/Supabase
- Only need IndexedDB wrapper → Dexie
- Need advanced replication plugins → RxDB

---

## Migration Guides

Ready to migrate? Check out our comprehensive migration guides:

- [Migrating from PouchDB to Pocket](/docs/guides/migrating-from-other-databases#migrating-from-pouchdb)
- [Migrating from RxDB to Pocket](/docs/guides/migrating-from-other-databases#migrating-from-rxdb)
- [Migrating from Dexie to Pocket](/docs/guides/migrating-from-other-databases#migrating-from-dexiejs)
- [Migrating from LocalForage to Pocket](/docs/guides/migrating-from-other-databases#migrating-from-localforage)
- [Migrating from WatermelonDB to Pocket](/docs/guides/migrating-from-other-databases#migrating-from-watermelondb)

---

## See Also

- [Local-First Architecture](/docs/concepts/local-first) - Why local-first matters
- [Getting Started](/docs/intro) - Start using Pocket
- [FAQ](/docs/faq) - Common questions
