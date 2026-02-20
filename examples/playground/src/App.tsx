import { createDatabase, type Database, type Document } from '@pocket/core';
import { PocketProvider, useLiveQuery, useMutation } from '@pocket/react';
import { createMemoryStorage } from '@pocket/storage-memory';
import React, { useEffect, useState } from 'react';

interface Todo extends Document {
  _id: string;
  text: string;
  completed: boolean;
  createdAt: number;
}

async function initDatabase(): Promise<Database> {
  const storage = createMemoryStorage();
  return createDatabase({ name: 'playground-db', storage });
}

function TodoItem({ todo }: { todo: Todo }) {
  const { update, remove } = useMutation<Todo>('todos');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#f8f9fa', borderRadius: 6, marginBottom: 4 }}>
      <input type="checkbox" checked={todo.completed} onChange={() => update(todo._id, { completed: !todo.completed })} />
      <span style={{ flex: 1, textDecoration: todo.completed ? 'line-through' : 'none', opacity: todo.completed ? 0.5 : 1 }}>{todo.text}</span>
      <button onClick={() => remove(todo._id)} style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 4, padding: '4px 8px', cursor: 'pointer' }}>✕</button>
    </div>
  );
}

function TodoSection() {
  const [text, setText] = useState('');
  const { insert } = useMutation<Todo>('todos');
  const { data: todos, isLoading } = useLiveQuery<Todo>('todos', (c) => c.find().sort('createdAt', 'desc'));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    insert({ text: text.trim(), completed: false, createdAt: Date.now() });
    setText('');
  };

  return (
    <section style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: '1.1rem', marginBottom: 8 }}>📝 Todo List</h2>
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a todo..." style={{ flex: 1, padding: '8px 12px', border: '2px solid #e0e0e0', borderRadius: 6, fontSize: '0.95rem' }} />
        <button type="submit" style={{ padding: '8px 16px', background: '#667eea', color: 'white', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}>Add</button>
      </form>
      {isLoading ? (
        <div style={{ color: '#999', textAlign: 'center', padding: 16 }}>Loading...</div>
      ) : todos.length === 0 ? (
        <div style={{ color: '#999', textAlign: 'center', padding: 16, background: '#f8f9fa', borderRadius: 6 }}>No todos yet. Add one above!</div>
      ) : (
        todos.map((todo) => <TodoItem key={todo._id} todo={todo} />)
      )}
    </section>
  );
}

function QueryExplorer() {
  const [filter, setFilter] = useState('{}');
  const [parsedFilter, setParsedFilter] = useState<Record<string, unknown>>({});
  const [parseError, setParseError] = useState('');

  const { data: results, isLoading } = useLiveQuery<Todo>('todos', (c) => c.find(parsedFilter).sort('createdAt', 'desc'));

  const handleFilterChange = (value: string) => {
    setFilter(value);
    try {
      const parsed = JSON.parse(value);
      setParsedFilter(parsed);
      setParseError('');
    } catch {
      setParseError('Invalid JSON');
    }
  };

  return (
    <section style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: '1.1rem', marginBottom: 8 }}>🔍 Query Explorer</h2>
      <p style={{ fontSize: '0.8rem', color: '#666', marginBottom: 8 }}>Type a filter query as JSON — e.g. {`{"completed": true}`}</p>
      <textarea
        value={filter}
        onChange={(e) => handleFilterChange(e.target.value)}
        style={{ width: '100%', padding: '8px 12px', border: '2px solid #e0e0e0', borderRadius: 6, fontFamily: 'monospace', fontSize: '0.85rem', minHeight: 48, resize: 'vertical', boxSizing: 'border-box' }}
      />
      {parseError && <div style={{ color: '#dc2626', fontSize: '0.8rem', marginTop: 4 }}>{parseError}</div>}
      <div style={{ marginTop: 8, padding: 12, background: '#f0f4ff', borderRadius: 6, fontFamily: 'monospace', fontSize: '0.8rem', maxHeight: 200, overflow: 'auto' }}>
        {isLoading ? 'Loading...' : (
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {`// ${results.length} result(s)\n`}{JSON.stringify(results, null, 2)}
          </pre>
        )}
      </div>
    </section>
  );
}

function StatusBar() {
  const { data: todos } = useLiveQuery<Todo>('todos', (c) => c.find());
  const completed = todos.filter((t) => t.completed).length;
  return (
    <div style={{ padding: '10px 16px', background: '#f0f9ff', borderRadius: 8, fontSize: '0.8rem', color: '#0369a1', textAlign: 'center' }}>
      📊 {todos.length} document(s) &middot; {completed} completed &middot; {todos.length - completed} active &middot; Memory storage (refresh to reset)
    </div>
  );
}

export function App() {
  const [db, setDb] = useState<Database | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initDatabase().then(setDb).catch((err) => setError(err.message));
  }, []);

  if (error) return <div style={{ padding: 32, color: '#dc2626', textAlign: 'center' }}>Error: {error}</div>;
  if (!db) return <div style={{ padding: 32, color: '#666', textAlign: 'center' }}>Initializing database...</div>;

  return (
    <PocketProvider database={db}>
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ background: 'white', borderRadius: 16, padding: 32, maxWidth: 540, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 700, textAlign: 'center', marginBottom: 4 }}>⚡ Pocket Playground</h1>
          <p style={{ color: '#666', textAlign: 'center', fontSize: '0.85rem', marginBottom: 24 }}>Interactive explorer for the Pocket local-first database</p>
          <TodoSection />
          <QueryExplorer />
          <StatusBar />
        </div>
      </div>
    </PocketProvider>
  );
}
