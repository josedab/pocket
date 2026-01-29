---
sidebar_position: 6
title: Angular Integration
description: Using Pocket with Angular signals and observables
---

# Angular Integration

Pocket provides native Angular support with both modern signals (Angular 16+) and RxJS observables for reactive data management.

## Installation

```bash
npm install @pocket/core @pocket/angular
```

## Setup

### 1. Create Your Database

```typescript
// src/app/db.ts
import { Database, createIndexedDBStorage } from '@pocket/core';

export interface Todo {
  _id: string;
  title: string;
  completed: boolean;
  createdAt: Date;
}

export const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
});
```

### 2. Configure the Module

```typescript
// src/app/app.module.ts
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { PocketModule } from '@pocket/angular';
import { db } from './db';
import { AppComponent } from './app.component';

@NgModule({
  declarations: [AppComponent],
  imports: [
    BrowserModule,
    PocketModule.forRoot({ database: db }),
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
```

For standalone components (Angular 14+):

```typescript
// src/app/app.config.ts
import { ApplicationConfig } from '@angular/core';
import { providePocket } from '@pocket/angular';
import { db } from './db';

export const appConfig: ApplicationConfig = {
  providers: [
    providePocket({ database: db }),
  ],
};
```

## Using Signals (Angular 16+)

### liveQuery Signal

Create reactive queries with Angular signals:

```typescript
import { Component, computed } from '@angular/core';
import { liveQuery } from '@pocket/angular';
import type { Todo } from './db';

@Component({
  selector: 'app-todo-list',
  template: `
    @if (todos.isLoading()) {
      <div>Loading...</div>
    } @else {
      <ul>
        @for (todo of todos.data(); track todo._id) {
          <li>{{ todo.title }}</li>
        }
      </ul>
      <p>Total: {{ count() }}</p>
    }
  `,
})
export class TodoListComponent {
  todos = liveQuery<Todo>('todos', (c) =>
    c.find().where('completed').equals(false)
  );

  // Computed values work seamlessly
  count = computed(() => this.todos.data().length);
}
```

### Signal Return Type

```typescript
interface LiveQuerySignal<T> {
  data: Signal<T[]>;        // Query results
  isLoading: Signal<boolean>;  // True during initial load
  error: Signal<Error | null>; // Any error that occurred
  refresh: () => void;      // Force refresh the query
}
```

### documentSignal

Subscribe to a single document:

```typescript
import { Component, input } from '@angular/core';
import { documentSignal } from '@pocket/angular';
import type { Todo } from './db';

@Component({
  selector: 'app-todo-detail',
  template: `
    @if (todo.data(); as t) {
      <h2>{{ t.title }}</h2>
      <p>Status: {{ t.completed ? 'Done' : 'Pending' }}</p>
    } @else {
      <p>Not found</p>
    }
  `,
})
export class TodoDetailComponent {
  id = input.required<string>();
  todo = documentSignal<Todo>('todos', this.id);
}
```

### mutationSignal

Execute write operations:

```typescript
import { Component } from '@angular/core';
import { mutationSignal } from '@pocket/angular';

@Component({
  selector: 'app-add-todo',
  template: `
    <button (click)="addTodo()" [disabled]="mutation.isLoading()">
      {{ mutation.isLoading() ? 'Adding...' : 'Add Todo' }}
    </button>
  `,
})
export class AddTodoComponent {
  mutation = mutationSignal(async (db, title: string) => {
    return db.collection('todos').insert({
      _id: crypto.randomUUID(),
      title,
      completed: false,
      createdAt: new Date(),
    });
  });

  addTodo() {
    this.mutation.mutate('New todo');
  }
}
```

## Using Observables

For projects preferring RxJS or using older Angular versions:

### PocketService

```typescript
import { Component, OnInit, OnDestroy } from '@angular/core';
import { PocketService } from '@pocket/angular';
import { Subject, takeUntil } from 'rxjs';
import type { Todo } from './db';

@Component({
  selector: 'app-todo-list',
  template: `
    <ul>
      <li *ngFor="let todo of todos">{{ todo.title }}</li>
    </ul>
  `,
})
export class TodoListComponent implements OnInit, OnDestroy {
  todos: Todo[] = [];
  private destroy$ = new Subject<void>();

  constructor(private pocket: PocketService) {}

  ngOnInit() {
    this.pocket
      .liveQuery<Todo>('todos', (c) =>
        c.find().where('completed').equals(false)
      )
      .pipe(takeUntil(this.destroy$))
      .subscribe((todos) => {
        this.todos = todos;
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
```

### Observable Methods

```typescript
@Injectable()
class PocketService {
  // Live query as Observable
  liveQuery<T>(
    collection: string,
    queryFn?: (c: Collection<T>) => QueryBuilder<T>
  ): Observable<T[]>

  // Single document as Observable
  document<T>(collection: string, id: string): Observable<T | null>

  // Collection access
  collection<T>(name: string): Collection<T>

  // Sync status
  syncStatus$: Observable<SyncStatus>
}
```

### Combining with AsyncPipe

```typescript
import { Component } from '@angular/core';
import { PocketService } from '@pocket/angular';
import { map } from 'rxjs/operators';
import type { Todo } from './db';

@Component({
  selector: 'app-todo-stats',
  template: `
    <div *ngIf="stats$ | async as stats">
      <p>Incomplete: {{ stats.incomplete }}</p>
      <p>Completed: {{ stats.completed }}</p>
    </div>
  `,
})
export class TodoStatsComponent {
  stats$ = this.pocket.liveQuery<Todo>('todos').pipe(
    map((todos) => ({
      incomplete: todos.filter((t) => !t.completed).length,
      completed: todos.filter((t) => t.completed).length,
    }))
  );

  constructor(private pocket: PocketService) {}
}
```

## Patterns

### Reactive Forms Integration

```typescript
import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { mutationSignal } from '@pocket/angular';

@Component({
  selector: 'app-todo-form',
  template: `
    <form [formGroup]="form" (ngSubmit)="onSubmit()">
      <input formControlName="title" placeholder="Todo title" />
      <button type="submit" [disabled]="form.invalid || addTodo.isLoading()">
        Add
      </button>
    </form>
  `,
})
export class TodoFormComponent {
  form: FormGroup;

  addTodo = mutationSignal(async (db, data: { title: string }) => {
    return db.collection('todos').insert({
      _id: crypto.randomUUID(),
      title: data.title,
      completed: false,
      createdAt: new Date(),
    });
  });

  constructor(private fb: FormBuilder) {
    this.form = this.fb.group({
      title: ['', Validators.required],
    });
  }

  onSubmit() {
    if (this.form.valid) {
      this.addTodo.mutate(this.form.value);
      this.form.reset();
    }
  }
}
```

### Route-Based Queries

```typescript
import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { PocketService } from '@pocket/angular';
import type { Todo } from './db';

@Component({
  selector: 'app-todo-detail',
  template: `
    @if (todo()) {
      <h1>{{ todo()!.title }}</h1>
    }
  `,
})
export class TodoDetailComponent {
  private route = inject(ActivatedRoute);
  private pocket = inject(PocketService);

  todo = toSignal(
    this.route.params.pipe(
      switchMap((params) =>
        this.pocket.document<Todo>('todos', params['id'])
      )
    )
  );
}
```

### Filtering with Signals

```typescript
import { Component, signal, computed } from '@angular/core';
import { liveQuery } from '@pocket/angular';
import type { Todo } from './db';

@Component({
  selector: 'app-filtered-todos',
  template: `
    <select (change)="filter.set($event.target.value)">
      <option value="all">All</option>
      <option value="active">Active</option>
      <option value="completed">Completed</option>
    </select>

    <ul>
      @for (todo of filteredTodos(); track todo._id) {
        <li>{{ todo.title }}</li>
      }
    </ul>
  `,
})
export class FilteredTodosComponent {
  filter = signal<'all' | 'active' | 'completed'>('all');

  allTodos = liveQuery<Todo>('todos');

  filteredTodos = computed(() => {
    const todos = this.allTodos.data();
    switch (this.filter()) {
      case 'active':
        return todos.filter((t) => !t.completed);
      case 'completed':
        return todos.filter((t) => t.completed);
      default:
        return todos;
    }
  });
}
```

### Pagination

```typescript
import { Component, signal } from '@angular/core';
import { liveQuery } from '@pocket/angular';
import type { Todo } from './db';

@Component({
  selector: 'app-paginated-todos',
  template: `
    <ul>
      @for (todo of todos.data(); track todo._id) {
        <li>{{ todo.title }}</li>
      }
    </ul>
    <button (click)="prevPage()" [disabled]="page() === 0">Previous</button>
    <span>Page {{ page() + 1 }}</span>
    <button (click)="nextPage()">Next</button>
  `,
})
export class PaginatedTodosComponent {
  page = signal(0);
  pageSize = 10;

  todos = liveQuery<Todo>('todos', (c) =>
    c.find()
      .sort('createdAt', 'desc')
      .skip(this.page() * this.pageSize)
      .limit(this.pageSize)
  );

  prevPage() {
    this.page.update((p) => Math.max(0, p - 1));
  }

  nextPage() {
    this.page.update((p) => p + 1);
  }
}
```

## Sync Status

Monitor synchronization status:

```typescript
import { Component } from '@angular/core';
import { syncStatusSignal } from '@pocket/angular';

@Component({
  selector: 'app-sync-indicator',
  template: `
    <div class="sync-status">
      @switch (syncStatus.status()) {
        @case ('syncing') {
          <span class="syncing">Syncing...</span>
        }
        @case ('error') {
          <span class="error">Sync error</span>
        }
        @case ('offline') {
          <span class="offline">Offline</span>
        }
        @default {
          <span class="synced">Synced</span>
        }
      }
    </div>
  `,
})
export class SyncIndicatorComponent {
  syncStatus = syncStatusSignal();
}
```

## TypeScript Support

### Typed Collections

```typescript
interface Todo {
  _id: string;
  title: string;
  completed: boolean;
  userId: string;
}

interface User {
  _id: string;
  name: string;
  email: string;
}

// Types are inferred from generics
const todos = liveQuery<Todo>('todos');
const users = liveQuery<User>('users');
```

### Strict Mode Compatibility

The library is fully compatible with Angular's strict mode and TypeScript strict checks.

## Next Steps

- [Sync Setup](/docs/guides/sync-setup) - Add real-time synchronization
- [Offline-First App](/docs/guides/offline-first-app) - Build offline-capable apps
- [Schema Validation](/docs/guides/schema-validation) - Add runtime type checking
