import { createDatabase, type Database, type Document } from '@pocket/core';
import { PocketProvider, useLiveQuery, useMutation } from '@pocket/react';
import { createMemoryStorage } from '@pocket/storage-memory';
import React, { useEffect, useState } from 'react';

// Define the Todo document type
interface Todo extends Document {
  _id: string;
  text: string;
  completed: boolean;
  createdAt: number;
}

// Create the database with memory storage (for demo purposes)
async function initDatabase(): Promise<Database> {
  const storage = createMemoryStorage();
  const db = await createDatabase({
    name: 'todo-db',
    storage,
  });
  return db;
}

// TodoItem component
function TodoItem({ todo }: { todo: Todo }) {
  const { update, remove } = useMutation<Todo>('todos');

  const toggleComplete = () => {
    update(todo._id, { completed: !todo.completed });
  };

  const deleteTodo = () => {
    remove(todo._id);
  };

  return (
    <div style={styles.todoItem}>
      <input
        type="checkbox"
        checked={todo.completed}
        onChange={toggleComplete}
        style={styles.checkbox}
      />
      <span
        style={{
          ...styles.todoText,
          textDecoration: todo.completed ? 'line-through' : 'none',
          opacity: todo.completed ? 0.6 : 1,
        }}
      >
        {todo.text}
      </span>
      <button onClick={deleteTodo} style={styles.deleteButton}>
        Delete
      </button>
    </div>
  );
}

// AddTodo component
function AddTodo() {
  const [text, setText] = useState('');
  const { insert } = useMutation<Todo>('todos');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;

    insert({
      text: text.trim(),
      completed: false,
      createdAt: Date.now(),
    });
    setText('');
  };

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What needs to be done?"
        style={styles.input}
      />
      <button type="submit" style={styles.addButton}>
        Add
      </button>
    </form>
  );
}

// TodoList component
function TodoList() {
  const { data: todos, isLoading } = useLiveQuery<Todo>('todos', (collection) =>
    collection.find().sort('createdAt', 'desc')
  );

  if (isLoading) {
    return <div style={styles.loading}>Loading todos...</div>;
  }

  const completedCount = todos.filter((t) => t.completed).length;

  return (
    <div>
      <div style={styles.stats}>
        {todos.length} todos ({completedCount} completed)
      </div>
      {todos.length === 0 ? (
        <div style={styles.empty}>No todos yet. Add one above!</div>
      ) : (
        <div style={styles.todoList}>
          {todos.map((todo) => (
            <TodoItem key={todo._id} todo={todo} />
          ))}
        </div>
      )}
    </div>
  );
}

// Main App component
export function App() {
  const [db, setDb] = useState<Database | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initDatabase()
      .then(setDb)
      .catch((err) => setError(err.message));
  }, []);

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.error}>Error: {error}</div>
        </div>
      </div>
    );
  }

  if (!db) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.loading}>Initializing database...</div>
        </div>
      </div>
    );
  }

  return (
    <PocketProvider database={db}>
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.title}>Pocket Todo</h1>
          <p style={styles.subtitle}>A local-first todo app powered by Pocket database</p>
          <AddTodo />
          <TodoList />
          <div style={styles.footer}>Data persists in memory. Refresh to reset.</div>
        </div>
      </div>
    </PocketProvider>
  );
}

// Inline styles
const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
  },
  card: {
    background: 'white',
    borderRadius: '16px',
    padding: '32px',
    maxWidth: '480px',
    width: '100%',
    boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
  },
  title: {
    fontSize: '2rem',
    fontWeight: 700,
    color: '#333',
    marginBottom: '8px',
    textAlign: 'center',
  },
  subtitle: {
    color: '#666',
    marginBottom: '24px',
    textAlign: 'center',
    fontSize: '0.9rem',
  },
  form: {
    display: 'flex',
    gap: '8px',
    marginBottom: '24px',
  },
  input: {
    flex: 1,
    padding: '12px 16px',
    border: '2px solid #e0e0e0',
    borderRadius: '8px',
    fontSize: '1rem',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  addButton: {
    padding: '12px 24px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'transform 0.2s, box-shadow 0.2s',
  },
  todoList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  todoItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    background: '#f8f9fa',
    borderRadius: '8px',
    transition: 'background 0.2s',
  },
  checkbox: {
    width: '20px',
    height: '20px',
    cursor: 'pointer',
  },
  todoText: {
    flex: 1,
    fontSize: '1rem',
    color: '#333',
  },
  deleteButton: {
    padding: '6px 12px',
    background: '#fee2e2',
    color: '#dc2626',
    border: 'none',
    borderRadius: '6px',
    fontSize: '0.85rem',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background 0.2s',
  },
  stats: {
    fontSize: '0.85rem',
    color: '#666',
    marginBottom: '16px',
    textAlign: 'center',
  },
  empty: {
    textAlign: 'center',
    color: '#999',
    padding: '24px',
    background: '#f8f9fa',
    borderRadius: '8px',
  },
  loading: {
    textAlign: 'center',
    color: '#666',
    padding: '24px',
  },
  error: {
    textAlign: 'center',
    color: '#dc2626',
    padding: '24px',
  },
  footer: {
    marginTop: '24px',
    padding: '12px',
    background: '#f0f9ff',
    borderRadius: '8px',
    fontSize: '0.8rem',
    color: '#0369a1',
    textAlign: 'center',
  },
};
