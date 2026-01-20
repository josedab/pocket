import React, { useState } from 'react';
import { useMutation } from '@pocket/react';
import type { Note } from './db';
import { NOTE_COLORS } from './db';

export function AddNote() {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [color, setColor] = useState(NOTE_COLORS[0]);
  const [isExpanded, setIsExpanded] = useState(false);
  const { insert, isLoading, error } = useMutation<Note>('notes');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const now = Date.now();
    try {
      await insert({
        title: title.trim(),
        content: content.trim(),
        color,
        createdAt: now,
        updatedAt: now,
      });
      setTitle('');
      setContent('');
      setColor(NOTE_COLORS[0]);
      setIsExpanded(false);
    } catch (err) {
      console.error('Failed to add note:', err);
    }
  };

  return (
    <div style={styles.container}>
      {!isExpanded ? (
        <button onClick={() => setIsExpanded(true)} style={styles.addButton}>
          + Add Note
        </button>
      ) : (
        <form onSubmit={handleSubmit} style={{ ...styles.form, backgroundColor: color }}>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Note title..."
            style={styles.titleInput}
            autoFocus
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write your note..."
            style={styles.contentInput}
            rows={4}
          />
          <div style={styles.colorPicker}>
            {NOTE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                style={{
                  ...styles.colorButton,
                  backgroundColor: c,
                  border: c === color ? '2px solid #333' : '2px solid transparent',
                }}
              />
            ))}
          </div>
          <div style={styles.actions}>
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              style={styles.cancelButton}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={styles.submitButton}
              disabled={isLoading || !title.trim()}
            >
              {isLoading ? 'Adding...' : 'Add Note'}
            </button>
          </div>
          {error && <div style={styles.error}>{error.message}</div>}
        </form>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    marginBottom: '24px',
  },
  addButton: {
    width: '100%',
    padding: '16px',
    fontSize: '16px',
    backgroundColor: '#2a2a4a',
    color: '#888',
    border: '2px dashed #3a3a5a',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  form: {
    padding: '16px',
    borderRadius: '12px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
  },
  titleInput: {
    width: '100%',
    padding: '8px 0',
    fontSize: '18px',
    fontWeight: 'bold',
    backgroundColor: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#333',
  },
  contentInput: {
    width: '100%',
    padding: '8px 0',
    fontSize: '14px',
    backgroundColor: 'transparent',
    border: 'none',
    outline: 'none',
    resize: 'vertical',
    color: '#333',
    fontFamily: 'inherit',
  },
  colorPicker: {
    display: 'flex',
    gap: '8px',
    marginTop: '12px',
  },
  colorButton: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    cursor: 'pointer',
    transition: 'transform 0.2s',
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    marginTop: '12px',
  },
  cancelButton: {
    padding: '8px 16px',
    fontSize: '14px',
    backgroundColor: 'transparent',
    color: '#333',
    border: '1px solid #33333333',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  submitButton: {
    padding: '8px 16px',
    fontSize: '14px',
    backgroundColor: '#333',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  error: {
    color: '#dc3545',
    fontSize: '14px',
    marginTop: '8px',
  },
};
