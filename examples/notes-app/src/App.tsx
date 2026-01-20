import React, { useEffect, useState } from 'react';
import { PocketProvider } from '@pocket/react';
import type { Database } from '@pocket/core';
import type { SyncEngine } from '@pocket/sync';
import { getDatabase, getSyncEngine } from './db';
import { NoteList } from './NoteList';
import { AddNote } from './AddNote';
import { SyncStatus } from './SyncStatus';

export function App() {
  const [db, setDb] = useState<Database | null>(null);
  const [syncEngine, setSyncEngine] = useState<SyncEngine | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDatabase()
      .then((database) => {
        setDb(database);
        const sync = getSyncEngine(database);
        setSyncEngine(sync);
        // Start sync if server is available
        sync.start().catch(() => {
          console.log('Sync server not available, running offline');
        });
      })
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
        <header style={styles.header}>
          <div>
            <h1 style={styles.title}>Pocket Notes</h1>
            <p style={styles.subtitle}>Local-first notes with sync</p>
          </div>
          {syncEngine && <SyncStatus syncEngine={syncEngine} />}
        </header>
        <AddNote />
        <NoteList />
      </div>
    </PocketProvider>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '900px',
    margin: '0 auto',
    padding: '20px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '2rem',
  },
  title: {
    fontSize: '2rem',
    marginBottom: '0.5rem',
    color: '#fff',
  },
  subtitle: {
    color: '#888',
  },
  loading: {
    textAlign: 'center',
    padding: '2rem',
    color: '#888',
  },
  error: {
    textAlign: 'center',
    padding: '2rem',
    color: '#ff6b6b',
  },
};
