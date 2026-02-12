# @pocket/vue

[![npm](https://img.shields.io/npm/v/@pocket/vue.svg)](https://www.npmjs.com/package/@pocket/vue)

Vue composables and plugin for Pocket — reactive queries, mutations, and sync status for local-first apps.

## Installation

```bash
npm install @pocket/vue @pocket/core
```

**Peer dependency:** `vue` >= 3.3.0

## Quick Start

### Plugin Setup

```typescript
import { createApp } from 'vue';
import { createPocketPlugin } from '@pocket/vue';

const app = createApp(App);
app.use(createPocketPlugin({ name: 'my-app' }));
```

### Using Composables

```vue
<script setup lang="ts">
import { useLiveQuery, useMutation, useSyncStatus } from '@pocket/vue';

const { data: todos, loading } = useLiveQuery<Todo>('todos', {
  filter: { completed: false },
  sort: { field: 'createdAt', direction: 'desc' }
});

const { mutate: addTodo } = useMutation<Todo>('todos');
const { status } = useSyncStatus();
</script>
```

### Single Document

```vue
<script setup lang="ts">
import { useDocument } from '@pocket/vue';

const { data: todo, loading } = useDocument<Todo>('todos', props.id);
</script>
```

## API

| Export | Description |
|--------|-------------|
| `createPocketPlugin(config)` | Vue plugin for providing Pocket context |
| `useDatabase()` | Access the database instance |
| `useCollection(name)` | Access a collection |
| `useLiveQuery(collection, opts?)` | Reactive live query |
| `useQuery(collection, opts?)` | One-time reactive query |
| `useDocument(collection, id)` | Reactive single document |
| `useFindOne(collection, filter)` | Reactive find-one query |
| `useMutation(collection)` | Insert, update, and delete operations |
| `useOptimisticMutation(collection)` | Optimistic mutation with rollback |
| `useSyncStatus()` | Reactive sync state |
| `useOnlineStatus()` | Reactive online/offline state |

## Documentation

- [Full Documentation](https://pocket.dev/docs)
- [API Reference](https://pocket.dev/docs/api/vue)

## License

MIT
