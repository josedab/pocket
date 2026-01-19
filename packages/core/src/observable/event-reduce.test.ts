import { describe, expect, it } from 'vitest';
import type { ChangeEvent, Document } from '../types/document.js';
import type { QuerySpec } from '../types/query.js';
import { applyAction, reduceEvent, type EventReduceAction } from './event-reduce.js';

interface Todo extends Document {
  _id: string;
  title: string;
  priority: number;
  completed: boolean;
}

function createTodo(id: string, title: string, priority: number, completed = false): Todo {
  return { _id: id, title, priority, completed };
}

function createChangeEvent<T extends Document>(
  operation: 'insert' | 'update' | 'delete',
  documentId: string,
  document: T | null,
  previousDocument?: T
): ChangeEvent<T> {
  return {
    operation,
    documentId,
    document,
    previousDocument,
    isFromSync: false,
    timestamp: Date.now(),
  };
}

describe('reduceEvent', () => {
  describe('insert operations', () => {
    it('should return no-change when document does not match filter', () => {
      const results: Todo[] = [];
      const spec: QuerySpec<Todo> = { filter: { completed: true } };
      const newDoc = createTodo('1', 'New task', 1, false);
      const event = createChangeEvent('insert', '1', newDoc);

      const action = reduceEvent(event, results, spec);
      expect(action.type).toBe('no-change');
    });

    it('should return insert-at when document matches filter', () => {
      const results: Todo[] = [];
      const spec: QuerySpec<Todo> = { filter: { completed: false } };
      const newDoc = createTodo('1', 'New task', 1, false);
      const event = createChangeEvent('insert', '1', newDoc);

      const action = reduceEvent(event, results, spec);
      expect(action.type).toBe('insert-at');
      if (action.type === 'insert-at') {
        expect(action.index).toBe(0);
        expect(action.document).toEqual(newDoc);
      }
    });

    it('should insert at correct position based on sort', () => {
      const results: Todo[] = [createTodo('1', 'First', 1), createTodo('3', 'Third', 3)];
      const spec: QuerySpec<Todo> = {
        sort: [{ field: 'priority', direction: 'asc' }],
      };
      const newDoc = createTodo('2', 'Second', 2);
      const event = createChangeEvent('insert', '2', newDoc);

      const action = reduceEvent(event, results, spec);
      expect(action.type).toBe('insert-at');
      if (action.type === 'insert-at') {
        expect(action.index).toBe(1);
      }
    });

    it('should return no-change when insert is beyond limit', () => {
      const results: Todo[] = [createTodo('1', 'First', 1), createTodo('2', 'Second', 2)];
      const spec: QuerySpec<Todo> = {
        sort: [{ field: 'priority', direction: 'asc' }],
        limit: 2,
      };
      const newDoc = createTodo('3', 'Third', 3);
      const event = createChangeEvent('insert', '3', newDoc);

      const action = reduceEvent(event, results, spec);
      expect(action.type).toBe('no-change');
    });

    it('should insert when new doc has higher priority than last', () => {
      const results: Todo[] = [createTodo('2', 'Second', 2), createTodo('3', 'Third', 3)];
      const spec: QuerySpec<Todo> = {
        sort: [{ field: 'priority', direction: 'asc' }],
        limit: 2,
      };
      const newDoc = createTodo('1', 'First', 1);
      const event = createChangeEvent('insert', '1', newDoc);

      const action = reduceEvent(event, results, spec);
      expect(action.type).toBe('insert-at');
      if (action.type === 'insert-at') {
        expect(action.index).toBe(0);
      }
    });
  });

  describe('update operations', () => {
    it('should remove document when it no longer matches filter', () => {
      const results: Todo[] = [createTodo('1', 'Task', 1, false)];
      const spec: QuerySpec<Todo> = { filter: { completed: false } };
      const updatedDoc = createTodo('1', 'Task', 1, true);
      const event = createChangeEvent('update', '1', updatedDoc, results[0]);

      const action = reduceEvent(event, results, spec);
      expect(action.type).toBe('remove-at');
      if (action.type === 'remove-at') {
        expect(action.index).toBe(0);
      }
    });

    it('should insert document when it starts matching filter', () => {
      const results: Todo[] = [];
      const spec: QuerySpec<Todo> = { filter: { completed: true } };
      const updatedDoc = createTodo('1', 'Task', 1, true);
      const previousDoc = createTodo('1', 'Task', 1, false);
      const event = createChangeEvent('update', '1', updatedDoc, previousDoc);

      const action = reduceEvent(event, results, spec);
      expect(action.type).toBe('insert-at');
    });

    it('should update in place when sort fields unchanged', () => {
      const results: Todo[] = [createTodo('1', 'Old title', 1, false)];
      const spec: QuerySpec<Todo> = {
        sort: [{ field: 'priority', direction: 'asc' }],
      };
      const updatedDoc = createTodo('1', 'New title', 1, false);
      const event = createChangeEvent('update', '1', updatedDoc, results[0]);

      const action = reduceEvent(event, results, spec);
      expect(action.type).toBe('update-at');
      if (action.type === 'update-at') {
        expect(action.index).toBe(0);
        expect(action.document.title).toBe('New title');
      }
    });

    it('should move document when sort field changes', () => {
      const results: Todo[] = [
        createTodo('1', 'First', 1),
        createTodo('2', 'Second', 2),
        createTodo('3', 'Third', 3),
      ];
      const spec: QuerySpec<Todo> = {
        sort: [{ field: 'priority', direction: 'asc' }],
      };
      // Update first item to have priority 4
      const updatedDoc = createTodo('1', 'First', 4);
      const event = createChangeEvent('update', '1', updatedDoc, results[0]);

      const action = reduceEvent(event, results, spec);
      expect(action.type).toBe('move');
      if (action.type === 'move') {
        expect(action.fromIndex).toBe(0);
        // toIndex is the position in the current array (before removal)
        // Since priority 4 > 3, it goes after index 2, which is index 3 in original array
        // But findInsertPosition skips the element being moved, so it returns 2
        expect(action.toIndex).toBe(2);
      }
    });

    it('should update in place when no sort specified', () => {
      const results: Todo[] = [createTodo('1', 'Task', 1)];
      const spec: QuerySpec<Todo> = {};
      const updatedDoc = createTodo('1', 'Updated Task', 5);
      const event = createChangeEvent('update', '1', updatedDoc, results[0]);

      const action = reduceEvent(event, results, spec);
      expect(action.type).toBe('update-at');
    });

    it('should return no-change when document not in results and does not match', () => {
      const results: Todo[] = [];
      const spec: QuerySpec<Todo> = { filter: { completed: true } };
      const updatedDoc = createTodo('1', 'Task', 1, false);
      const event = createChangeEvent('update', '1', updatedDoc);

      const action = reduceEvent(event, results, spec);
      expect(action.type).toBe('no-change');
    });
  });

  describe('delete operations', () => {
    it('should return no-change when deleted document not in results', () => {
      const results: Todo[] = [];
      const spec: QuerySpec<Todo> = {};
      const event = createChangeEvent<Todo>('delete', '1', null);

      const action = reduceEvent(event, results, spec);
      expect(action.type).toBe('no-change');
    });

    it('should remove document at correct index', () => {
      const results: Todo[] = [
        createTodo('1', 'First', 1),
        createTodo('2', 'Second', 2),
        createTodo('3', 'Third', 3),
      ];
      const spec: QuerySpec<Todo> = {};
      const event = createChangeEvent<Todo>('delete', '2', null);

      const action = reduceEvent(event, results, spec);
      expect(action.type).toBe('remove-at');
      if (action.type === 'remove-at') {
        expect(action.index).toBe(1);
      }
    });

    it('should re-execute when at limit and deletion occurs', () => {
      const results: Todo[] = [createTodo('1', 'First', 1), createTodo('2', 'Second', 2)];
      const spec: QuerySpec<Todo> = { limit: 2 };
      const event = createChangeEvent<Todo>('delete', '1', null);

      const action = reduceEvent(event, results, spec);
      expect(action.type).toBe('re-execute');
    });

    it('should remove when not at limit', () => {
      const results: Todo[] = [createTodo('1', 'First', 1), createTodo('2', 'Second', 2)];
      const spec: QuerySpec<Todo> = { limit: 10 };
      const event = createChangeEvent<Todo>('delete', '1', null);

      const action = reduceEvent(event, results, spec);
      expect(action.type).toBe('remove-at');
    });
  });
});

describe('applyAction', () => {
  const spec: QuerySpec<Todo> = {};

  it('should return same array for no-change', () => {
    const results: Todo[] = [createTodo('1', 'Task', 1)];
    const action: EventReduceAction<Todo> = { type: 'no-change' };

    const newResults = applyAction(results, action, spec);
    expect(newResults).toBe(results);
  });

  it('should return null for re-execute', () => {
    const results: Todo[] = [createTodo('1', 'Task', 1)];
    const action: EventReduceAction<Todo> = { type: 're-execute' };

    const newResults = applyAction(results, action, spec);
    expect(newResults).toBeNull();
  });

  it('should insert document at specified index', () => {
    const results: Todo[] = [createTodo('1', 'First', 1), createTodo('3', 'Third', 3)];
    const newDoc = createTodo('2', 'Second', 2);
    const action: EventReduceAction<Todo> = {
      type: 'insert-at',
      index: 1,
      document: newDoc,
    };

    const newResults = applyAction(results, action, spec);
    expect(newResults).toHaveLength(3);
    expect(newResults![1]._id).toBe('2');
  });

  it('should trim to limit after insert', () => {
    const results: Todo[] = [createTodo('1', 'First', 1), createTodo('2', 'Second', 2)];
    const specWithLimit: QuerySpec<Todo> = { limit: 2 };
    const newDoc = createTodo('0', 'Zero', 0);
    const action: EventReduceAction<Todo> = {
      type: 'insert-at',
      index: 0,
      document: newDoc,
    };

    const newResults = applyAction(results, action, specWithLimit);
    expect(newResults).toHaveLength(2);
    expect(newResults![0]._id).toBe('0');
    expect(newResults![1]._id).toBe('1');
  });

  it('should remove document at specified index', () => {
    const results: Todo[] = [
      createTodo('1', 'First', 1),
      createTodo('2', 'Second', 2),
      createTodo('3', 'Third', 3),
    ];
    const action: EventReduceAction<Todo> = { type: 'remove-at', index: 1 };

    const newResults = applyAction(results, action, spec);
    expect(newResults).toHaveLength(2);
    expect(newResults![0]._id).toBe('1');
    expect(newResults![1]._id).toBe('3');
  });

  it('should update document at specified index', () => {
    const results: Todo[] = [createTodo('1', 'Old', 1)];
    const updatedDoc = createTodo('1', 'New', 1);
    const action: EventReduceAction<Todo> = {
      type: 'update-at',
      index: 0,
      document: updatedDoc,
    };

    const newResults = applyAction(results, action, spec);
    expect(newResults).toHaveLength(1);
    expect(newResults![0].title).toBe('New');
  });

  it('should move document from one index to another (forward)', () => {
    const results: Todo[] = [
      createTodo('1', 'First', 1),
      createTodo('2', 'Second', 2),
      createTodo('3', 'Third', 3),
    ];
    const movedDoc = createTodo('1', 'First', 4);
    const action: EventReduceAction<Todo> = {
      type: 'move',
      fromIndex: 0,
      toIndex: 3,
      document: movedDoc,
    };

    const newResults = applyAction(results, action, spec);
    expect(newResults).toHaveLength(3);
    expect(newResults![0]._id).toBe('2');
    expect(newResults![1]._id).toBe('3');
    expect(newResults![2]._id).toBe('1');
  });

  it('should move document from one index to another (backward)', () => {
    const results: Todo[] = [
      createTodo('1', 'First', 1),
      createTodo('2', 'Second', 2),
      createTodo('3', 'Third', 3),
    ];
    const movedDoc = createTodo('3', 'Third', 0);
    const action: EventReduceAction<Todo> = {
      type: 'move',
      fromIndex: 2,
      toIndex: 0,
      document: movedDoc,
    };

    const newResults = applyAction(results, action, spec);
    expect(newResults).toHaveLength(3);
    expect(newResults![0]._id).toBe('3');
    expect(newResults![1]._id).toBe('1');
    expect(newResults![2]._id).toBe('2');
  });

  it('should not mutate original array', () => {
    const original: Todo[] = [createTodo('1', 'Task', 1)];
    const action: EventReduceAction<Todo> = {
      type: 'insert-at',
      index: 1,
      document: createTodo('2', 'New', 2),
    };

    const newResults = applyAction(original, action, spec);
    expect(original).toHaveLength(1);
    expect(newResults).toHaveLength(2);
  });
});

describe('integration: reduceEvent + applyAction', () => {
  it('should efficiently update results on series of changes', () => {
    let results: Todo[] = [];
    const spec: QuerySpec<Todo> = {
      filter: { completed: false },
      sort: [{ field: 'priority', direction: 'asc' }],
      limit: 5,
    };

    // Insert first task
    let event = createChangeEvent('insert', '1', createTodo('1', 'Task 1', 2, false));
    let action = reduceEvent(event, results, spec);
    results = applyAction(results, action, spec) ?? results;
    expect(results).toHaveLength(1);

    // Insert second task with lower priority (should be first)
    event = createChangeEvent('insert', '2', createTodo('2', 'Task 2', 1, false));
    action = reduceEvent(event, results, spec);
    results = applyAction(results, action, spec) ?? results;
    expect(results).toHaveLength(2);
    expect(results[0]._id).toBe('2');

    // Update task 2 to completed (should be removed)
    event = createChangeEvent('update', '2', createTodo('2', 'Task 2', 1, true), results[0]);
    action = reduceEvent(event, results, spec);
    results = applyAction(results, action, spec) ?? results;
    expect(results).toHaveLength(1);
    expect(results[0]._id).toBe('1');

    // Delete task 1
    event = createChangeEvent<Todo>('delete', '1', null);
    action = reduceEvent(event, results, spec);
    results = applyAction(results, action, spec) ?? results;
    expect(results).toHaveLength(0);
  });
});
