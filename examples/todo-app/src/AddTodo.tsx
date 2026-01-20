import React, { useState } from 'react';
import { useMutation } from '@pocket/react';
import type { Todo } from './db';

export function AddTodo() {
  const [title, setTitle] = useState('');
  const { insert, isLoading, error } = useMutation<Todo>('todos');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    try {
      await insert({
        title: title.trim(),
        completed: false,
        createdAt: Date.now(),
      });
      setTitle('');
    } catch (err) {
      console.error('Failed to add todo:', err);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What needs to be done?"
        style={styles.input}
        disabled={isLoading}
      />
      <button type="submit" style={styles.button} disabled={isLoading || !title.trim()}>
        {isLoading ? 'Adding...' : 'Add'}
      </button>
      {error && <div style={styles.error}>{error.message}</div>}
    </form>
  );
}

const styles: Record<string, React.CSSProperties> = {
  form: {
    display: 'flex',
    gap: '10px',
    marginBottom: '20px',
  },
  input: {
    flex: 1,
    padding: '12px 16px',
    fontSize: '16px',
    border: '2px solid #e0e0e0',
    borderRadius: '8px',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  button: {
    padding: '12px 24px',
    fontSize: '16px',
    backgroundColor: '#007bff',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  error: {
    color: '#dc3545',
    fontSize: '14px',
    marginTop: '8px',
  },
};
