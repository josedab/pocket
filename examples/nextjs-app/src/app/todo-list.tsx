'use client';

import { useEffect, useState, useCallback } from 'react';
import { PocketProvider, useLiveQuery, useMutation } from '@pocket/react';
import type { Database } from '@pocket/core';
import { createClientDatabase, type Todo } from '@/lib/pocket';

// ---------------------------------------------------------------------------
// Inner component – uses Pocket hooks inside the PocketProvider
// ---------------------------------------------------------------------------

function TodoApp({ initialTodos }: { initialTodos: Todo[] }) {
  const { data: todos, isLoading } = useLiveQuery<Todo>('todos');
  const { insert, update, remove } = useMutation<Todo>('todos');
  const [text, setText] = useState('');
  const [seeded, setSeeded] = useState(false);

  // Seed the local database with server-provided data on first mount.
  useEffect(() => {
    if (seeded) return;

    async function seed() {
      for (const todo of initialTodos) {
        await insert(todo);
      }
      setSeeded(true);
    }

    seed();
  }, [initialTodos, insert, seeded]);

  const handleAdd = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    await insert({
      id: crypto.randomUUID(),
      text: trimmed,
      completed: false,
      createdAt: Date.now(),
    } as Todo);

    setText('');
  }, [text, insert]);

  const handleToggle = useCallback(
    async (todo: Todo) => {
      await update(todo.id, { completed: !todo.completed });
    },
    [update],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await remove(id);
    },
    [remove],
  );

  if (isLoading && !seeded) {
    return <p>Loading…</p>;
  }

  const items = todos ?? [];

  return (
    <div>
      {/* Add form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleAdd();
        }}
        style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}
      >
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What needs to be done?"
          style={{
            flex: 1,
            padding: '0.5rem',
            borderRadius: '4px',
            border: '1px solid #ccc',
          }}
        />
        <button
          type="submit"
          style={{
            padding: '0.5rem 1rem',
            borderRadius: '4px',
            border: 'none',
            background: '#0070f3',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          Add
        </button>
      </form>

      {/* Todo list */}
      {items.length === 0 ? (
        <p style={{ color: '#999' }}>No todos yet — add one above!</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {items.map((todo) => (
            <li
              key={todo.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 0',
                borderBottom: '1px solid #eee',
              }}
            >
              <input
                type="checkbox"
                checked={todo.completed}
                onChange={() => handleToggle(todo)}
              />
              <span
                style={{
                  flex: 1,
                  textDecoration: todo.completed ? 'line-through' : 'none',
                  color: todo.completed ? '#999' : 'inherit',
                }}
              >
                {todo.text}
              </span>
              <button
                onClick={() => handleDelete(todo.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#e00',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <p style={{ marginTop: '1rem', fontSize: '0.85rem', color: '#999' }}>
        {items.length} item(s) — running in local-first mode 🟢
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outer wrapper – initialises the Pocket database and provides it
// ---------------------------------------------------------------------------

interface TodoListProps {
  initialTodos: Todo[];
  serverTimestamp: number;
}

export function TodoList({ initialTodos, serverTimestamp }: TodoListProps) {
  const [db, setDb] = useState<Database | null>(null);

  useEffect(() => {
    createClientDatabase().then(setDb);
  }, []);

  if (!db) {
    return (
      <p>
        Initialising local database…{' '}
        <small>(server snapshot from {new Date(serverTimestamp).toLocaleTimeString()})</small>
      </p>
    );
  }

  return (
    <PocketProvider database={db}>
      <TodoApp initialTodos={initialTodos} />
    </PocketProvider>
  );
}
