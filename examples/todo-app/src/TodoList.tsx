import React from 'react';
import { useLiveQuery, useMutation } from '@pocket/react';
import type { Todo } from './db';

export function TodoList() {
  const { data: todos, isLoading, error } = useLiveQuery<Todo>(
    'todos',
    (collection) => collection.find().sort('createdAt', 'desc')
  );

  const { update, remove } = useMutation<Todo>('todos');

  const handleToggle = async (todo: Todo) => {
    try {
      await update(todo._id, { completed: !todo.completed });
    } catch (err) {
      console.error('Failed to toggle todo:', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await remove(id);
    } catch (err) {
      console.error('Failed to delete todo:', err);
    }
  };

  if (isLoading) {
    return <div style={styles.loading}>Loading todos...</div>;
  }

  if (error) {
    return <div style={styles.error}>Error: {error.message}</div>;
  }

  if (todos.length === 0) {
    return (
      <div style={styles.empty}>
        No todos yet. Add one above!
      </div>
    );
  }

  const completedCount = todos.filter((t) => t.completed).length;
  const totalCount = todos.length;

  return (
    <div>
      <div style={styles.stats}>
        {completedCount} of {totalCount} completed
      </div>
      <ul style={styles.list}>
        {todos.map((todo) => (
          <li key={todo._id} style={styles.item}>
            <label style={styles.label}>
              <input
                type="checkbox"
                checked={todo.completed}
                onChange={() => handleToggle(todo)}
                style={styles.checkbox}
              />
              <span
                style={{
                  ...styles.title,
                  textDecoration: todo.completed ? 'line-through' : 'none',
                  color: todo.completed ? '#999' : '#333',
                }}
              >
                {todo.title}
              </span>
            </label>
            <button
              onClick={() => handleDelete(todo._id)}
              style={styles.deleteButton}
              aria-label="Delete todo"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
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
  empty: {
    textAlign: 'center',
    padding: '2rem',
    color: '#666',
    backgroundColor: '#fafafa',
    borderRadius: '8px',
    border: '2px dashed #e0e0e0',
  },
  stats: {
    marginBottom: '16px',
    color: '#666',
    fontSize: '14px',
  },
  list: {
    listStyle: 'none',
    padding: 0,
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    backgroundColor: 'white',
    borderRadius: '8px',
    marginBottom: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  label: {
    display: 'flex',
    alignItems: 'center',
    flex: 1,
    cursor: 'pointer',
  },
  checkbox: {
    width: '20px',
    height: '20px',
    marginRight: '12px',
    cursor: 'pointer',
  },
  title: {
    fontSize: '16px',
    transition: 'color 0.2s',
  },
  deleteButton: {
    padding: '6px 12px',
    fontSize: '14px',
    backgroundColor: '#dc3545',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    marginLeft: '12px',
  },
};
