import React, { useState } from 'react';
import { useLiveQuery, useMutation } from '@pocket/react';
import type { Note } from './db';
import { NOTE_COLORS } from './db';

export function NoteList() {
  const { data: notes, isLoading, error } = useLiveQuery<Note>(
    'notes',
    (collection) => collection.find().sort('updatedAt', 'desc')
  );

  if (isLoading) {
    return <div style={styles.loading}>Loading notes...</div>;
  }

  if (error) {
    return <div style={styles.error}>Error: {error.message}</div>;
  }

  if (notes.length === 0) {
    return (
      <div style={styles.empty}>
        No notes yet. Create your first note!
      </div>
    );
  }

  return (
    <div style={styles.grid}>
      {notes.map((note) => (
        <NoteCard key={note._id} note={note} />
      ))}
    </div>
  );
}

function NoteCard({ note }: { note: Note }) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [color, setColor] = useState(note.color);
  const { update, remove } = useMutation<Note>('notes');

  const handleSave = async () => {
    if (!title.trim()) return;
    try {
      await update(note._id, {
        title: title.trim(),
        content: content.trim(),
        color,
        updatedAt: Date.now(),
      });
      setIsEditing(false);
    } catch (err) {
      console.error('Failed to update note:', err);
    }
  };

  const handleDelete = async () => {
    if (confirm('Delete this note?')) {
      try {
        await remove(note._id);
      } catch (err) {
        console.error('Failed to delete note:', err);
      }
    }
  };

  const handleCancel = () => {
    setTitle(note.title);
    setContent(note.content);
    setColor(note.color);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div style={{ ...styles.card, backgroundColor: color }}>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={styles.titleInput}
          autoFocus
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
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
        <div style={styles.editActions}>
          <button onClick={handleCancel} style={styles.cancelButton}>
            Cancel
          </button>
          <button onClick={handleSave} style={styles.saveButton}>
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ ...styles.card, backgroundColor: note.color }}
      onClick={() => setIsEditing(true)}
    >
      <h3 style={styles.title}>{note.title}</h3>
      {note.content && <p style={styles.content}>{note.content}</p>}
      <div style={styles.footer}>
        <span style={styles.date}>
          {new Date(note.updatedAt).toLocaleDateString()}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleDelete();
          }}
          style={styles.deleteButton}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
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
  empty: {
    textAlign: 'center',
    padding: '3rem',
    color: '#666',
    backgroundColor: '#2a2a4a',
    borderRadius: '12px',
    border: '2px dashed #3a3a5a',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
    gap: '16px',
  },
  card: {
    padding: '16px',
    borderRadius: '12px',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    transition: 'transform 0.2s, box-shadow 0.2s',
    minHeight: '150px',
    display: 'flex',
    flexDirection: 'column',
  },
  title: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '8px',
    wordBreak: 'break-word',
  },
  content: {
    fontSize: '14px',
    color: '#555',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    wordBreak: 'break-word',
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: '12px',
    paddingTop: '8px',
    borderTop: '1px solid rgba(0,0,0,0.1)',
  },
  date: {
    fontSize: '12px',
    color: '#666',
  },
  deleteButton: {
    padding: '4px 8px',
    fontSize: '12px',
    backgroundColor: 'rgba(255,0,0,0.1)',
    color: '#c33',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  titleInput: {
    width: '100%',
    padding: '8px 0',
    fontSize: '16px',
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
    flex: 1,
  },
  colorPicker: {
    display: 'flex',
    gap: '6px',
    marginTop: '8px',
  },
  colorButton: {
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    cursor: 'pointer',
  },
  editActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    marginTop: '12px',
  },
  cancelButton: {
    padding: '6px 12px',
    fontSize: '12px',
    backgroundColor: 'transparent',
    color: '#333',
    border: '1px solid rgba(0,0,0,0.2)',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  saveButton: {
    padding: '6px 12px',
    fontSize: '12px',
    backgroundColor: '#333',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
};
