# @pocket/angular

[![npm](https://img.shields.io/npm/v/@pocket/angular.svg)](https://www.npmjs.com/package/@pocket/angular)

Angular integration for Pocket — reactive services, signals, and observables for local-first apps.

## Installation

```bash
npm install @pocket/angular @pocket/core
```

**Peer dependency:** `@angular/core` >= 16.0.0

## Quick Start

### Module Setup

```typescript
import { PocketModule } from '@pocket/angular';

@NgModule({
  imports: [PocketModule.forRoot({ name: 'my-app' })]
})
export class AppModule {}
```

### Or Standalone with `providePocket`

```typescript
import { providePocket } from '@pocket/angular';

bootstrapApplication(AppComponent, {
  providers: [providePocket({ name: 'my-app' })]
});
```

### Using Signals

```typescript
import { Component } from '@angular/core';
import { liveQuery, liveDocument, syncStatus } from '@pocket/angular';

@Component({ /* ... */ })
export class TodoListComponent {
  todos = liveQuery<Todo>('todos', { filter: { completed: false } });
  sync = syncStatus();
}
```

### Using Observables

```typescript
import { PocketService, fromLiveQuery } from '@pocket/angular';

@Component({ /* ... */ })
export class TodoListComponent {
  todos$ = fromLiveQuery<Todo>(this.pocket, 'todos');
  constructor(private pocket: PocketService) {}
}
```

## API

| Export | Description |
|--------|-------------|
| `PocketModule` | NgModule for configuring Pocket |
| `providePocket(config)` | Standalone provider function |
| `PocketService` | Injectable service for database access |
| `liveQuery(collection, opts?)` | Signal-based reactive query |
| `liveDocument(collection, id)` | Signal-based single document |
| `syncStatus()` | Signal-based sync state |
| `fromLiveQuery(service, collection)` | Observable-based reactive query |
| `fromDocument(service, collection, id)` | Observable-based single document |
| `fromSyncStatus(service)` | Observable-based sync state |

## Documentation

- [Full Documentation](https://pocket.dev/docs)
- [API Reference](https://pocket.dev/docs/api/angular)

## License

MIT
