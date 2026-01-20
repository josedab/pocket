import React, { useEffect, useState } from 'react';
import { PocketProvider } from '@pocket/react';
import type { Database } from '@pocket/core';
import { getDatabase } from './db';
import { TodoList } from './TodoList';
import { AddTodo } from './AddTodo';

export function App() {
  const [db, setDb] = useState<Database | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDatabase()
      .then(setDb)
      .catch((err) => setError(err.message));
  }, []);

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.error}>Error: {error}</div>
      </div>
    );
  }

  if (!db) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading...</div>
      </div>
    );
  }

  return (
    <PocketProvider database={db}>
      <div style={styles.container}>
        <h1 style={styles.title}>Pocket Todo App</h1>
        <p style={styles.subtitle}>A local-first todo app powered by Pocket</p>
        <AddTodo />
        <TodoList />
      </div>
    </PocketProvider>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '600px',
    margin: '0 auto',
    padding: '20px',
  },
  title: {
    fontSize: '2rem',
    marginBottom: '0.5rem',
    color: '#333',
  },
  subtitle: {
    color: '#666',
    marginBottom: '2rem',
  },
  loading: {
    textAlign: 'center',
    padding: '2rem',
    color: '#666',
  },
  error: {
    textAlign: 'center',
    padding: '2rem',
    color: '#dc3545',
  },
};
