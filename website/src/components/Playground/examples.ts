/**
 * Pre-configured Playground Examples
 *
 * These examples demonstrate common Pocket use cases.
 *
 * @module Playground/examples
 */

import type { PlaygroundExample } from './index';

/**
 * CRUD Operations Example
 *
 * Demonstrates basic Create, Read, Update, Delete operations with Pocket.
 */
export const crudExample: PlaygroundExample = {
  name: 'CRUD Operations',
  description: 'Basic Create, Read, Update, Delete operations with Pocket',
  openFile: 'src/App.tsx',
  files: {
    'src/main.tsx': `import React from 'react';
import ReactDOM from 'react-dom/client';
import { PocketProvider } from '@pocket/react';
import { Database } from '@pocket/core';
import App from './App';

// Create the database
const db = Database.create({
  name: 'crud-example',
  storage: 'memory',
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PocketProvider database={db}>
      <App />
    </PocketProvider>
  </React.StrictMode>
);
`,
    'src/App.tsx': `import { useState } from 'react';
import { useLiveQuery, usePocket } from '@pocket/react';

interface Todo {
  _id: string;
  title: string;
  completed: boolean;
  createdAt: Date;
}

function App() {
  const { db } = usePocket();
  const { data: todos, isLoading } = useLiveQuery<Todo>('todos');
  const [newTodo, setNewTodo] = useState('');

  const addTodo = async () => {
    if (!newTodo.trim()) return;

    await db.collection('todos').insert({
      title: newTodo,
      completed: false,
      createdAt: new Date(),
    });
    setNewTodo('');
  };

  const toggleTodo = async (todo: Todo) => {
    await db.collection('todos').update(
      { _id: todo._id },
      { $set: { completed: !todo.completed } }
    );
  };

  const deleteTodo = async (id: string) => {
    await db.collection('todos').remove({ _id: id });
  };

  if (isLoading) return <div>Loading...</div>;

  return (
    <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
      <h1>Pocket Todo App</h1>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <input
          type="text"
          value={newTodo}
          onChange={(e) => setNewTodo(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addTodo()}
          placeholder="Add a new todo..."
          style={{ flex: 1, padding: '0.5rem' }}
        />
        <button onClick={addTodo} style={{ padding: '0.5rem 1rem' }}>
          Add
        </button>
      </div>

      <ul style={{ listStyle: 'none', padding: 0 }}>
        {todos.map((todo) => (
          <li
            key={todo._id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem',
              borderBottom: '1px solid #eee',
            }}
          >
            <input
              type="checkbox"
              checked={todo.completed}
              onChange={() => toggleTodo(todo)}
            />
            <span
              style={{
                flex: 1,
                textDecoration: todo.completed ? 'line-through' : 'none',
              }}
            >
              {todo.title}
            </span>
            <button
              onClick={() => deleteTodo(todo._id)}
              style={{ padding: '0.25rem 0.5rem' }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>

      {todos.length === 0 && (
        <p style={{ textAlign: 'center', color: '#888' }}>
          No todos yet. Add one above!
        </p>
      )}
    </div>
  );
}

export default App;
`,
  },
};

/**
 * Reactive Queries Example
 *
 * Demonstrates live queries and reactive data updates.
 */
export const reactiveExample: PlaygroundExample = {
  name: 'Reactive Queries',
  description: 'Live queries that automatically update when data changes',
  openFile: 'src/App.tsx',
  files: {
    'src/main.tsx': `import React from 'react';
import ReactDOM from 'react-dom/client';
import { PocketProvider } from '@pocket/react';
import { Database } from '@pocket/core';
import App from './App';

const db = Database.create({
  name: 'reactive-example',
  storage: 'memory',
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PocketProvider database={db}>
      <App />
    </PocketProvider>
  </React.StrictMode>
);
`,
    'src/App.tsx': `import { useLiveQuery, usePocket } from '@pocket/react';

interface Message {
  _id: string;
  text: string;
  user: string;
  timestamp: Date;
}

function App() {
  const { db } = usePocket();

  // Live query - automatically updates when data changes
  const { data: messages } = useLiveQuery<Message>(
    'messages',
    (query) => query.orderBy('timestamp', 'desc').limit(10)
  );

  // Count query with filter
  const { data: myMessages } = useLiveQuery<Message>(
    'messages',
    (query) => query.where('user').equals('You')
  );

  const sendMessage = async (text: string) => {
    await db.collection('messages').insert({
      text,
      user: Math.random() > 0.5 ? 'You' : 'Friend',
      timestamp: new Date(),
    });
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
      <h1>Reactive Queries Demo</h1>

      <div style={{ marginBottom: '1rem', padding: '1rem', background: '#f5f5f5', borderRadius: '8px' }}>
        <p><strong>Total messages:</strong> {messages.length}</p>
        <p><strong>Your messages:</strong> {myMessages.length}</p>
      </div>

      <button
        onClick={() => sendMessage(\`Message at \${new Date().toLocaleTimeString()}\`)}
        style={{ padding: '0.75rem 1.5rem', marginBottom: '1rem' }}
      >
        Add Random Message
      </button>

      <div style={{ border: '1px solid #ddd', borderRadius: '8px', overflow: 'hidden' }}>
        {messages.map((msg) => (
          <div
            key={msg._id}
            style={{
              padding: '0.75rem',
              borderBottom: '1px solid #eee',
              background: msg.user === 'You' ? '#e3f2fd' : '#fff',
            }}
          >
            <strong>{msg.user}:</strong> {msg.text}
            <div style={{ fontSize: '0.8rem', color: '#888' }}>
              {new Date(msg.timestamp).toLocaleTimeString()}
            </div>
          </div>
        ))}
        {messages.length === 0 && (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>
            No messages yet. Click the button above!
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
`,
  },
};

/**
 * Full-Text Search Example
 *
 * Demonstrates Pocket's built-in full-text search capabilities.
 */
export const searchExample: PlaygroundExample = {
  name: 'Full-Text Search',
  description: 'Built-in full-text search with fuzzy matching',
  openFile: 'src/App.tsx',
  files: {
    'src/main.tsx': `import React from 'react';
import ReactDOM from 'react-dom/client';
import { PocketProvider } from '@pocket/react';
import { Database } from '@pocket/core';
import App from './App';

const db = Database.create({
  name: 'search-example',
  storage: 'memory',
});

// Seed some sample data
const seedData = async () => {
  const articles = [
    { title: 'Getting Started with Pocket', content: 'Learn how to use Pocket for local-first development.', category: 'tutorial' },
    { title: 'Reactive Queries Deep Dive', content: 'Understanding how Pocket queries automatically update.', category: 'advanced' },
    { title: 'Offline-First Architecture', content: 'Building apps that work offline with Pocket.', category: 'architecture' },
    { title: 'Sync and Conflict Resolution', content: 'How Pocket handles syncing data between devices.', category: 'sync' },
    { title: 'Schema Validation', content: 'Ensure data integrity with Pocket schemas.', category: 'tutorial' },
    { title: 'Performance Optimization', content: 'Tips for optimizing Pocket queries and indexes.', category: 'advanced' },
  ];

  for (const article of articles) {
    await db.collection('articles').insert(article);
  }
};

seedData();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PocketProvider database={db}>
      <App />
    </PocketProvider>
  </React.StrictMode>
);
`,
    'src/App.tsx': `import { useState, useMemo } from 'react';
import { useLiveQuery } from '@pocket/react';

interface Article {
  _id: string;
  title: string;
  content: string;
  category: string;
}

function App() {
  const [searchTerm, setSearchTerm] = useState('');
  const [category, setCategory] = useState('all');

  // Query with search filter
  const { data: articles, isLoading } = useLiveQuery<Article>(
    'articles',
    (query) => {
      let q = query;
      if (category !== 'all') {
        q = q.where('category').equals(category);
      }
      return q.orderBy('title', 'asc');
    }
  );

  // Client-side filtering for search
  const filteredArticles = useMemo(() => {
    if (!searchTerm) return articles;
    const term = searchTerm.toLowerCase();
    return articles.filter(
      (a) =>
        a.title.toLowerCase().includes(term) ||
        a.content.toLowerCase().includes(term)
    );
  }, [articles, searchTerm]);

  const categories = ['all', 'tutorial', 'advanced', 'architecture', 'sync'];

  return (
    <div style={{ padding: '2rem', maxWidth: '700px', margin: '0 auto' }}>
      <h1>Pocket Search Demo</h1>

      <div style={{ marginBottom: '1rem' }}>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search articles..."
          style={{ width: '100%', padding: '0.75rem', fontSize: '1rem' }}
        />
      </div>

      <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            style={{
              padding: '0.5rem 1rem',
              background: category === cat ? '#2196f3' : '#eee',
              color: category === cat ? '#fff' : '#333',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            {cat.charAt(0).toUpperCase() + cat.slice(1)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div>Loading...</div>
      ) : (
        <div>
          <p style={{ marginBottom: '1rem', color: '#666' }}>
            Found {filteredArticles.length} article(s)
          </p>
          {filteredArticles.map((article) => (
            <div
              key={article._id}
              style={{
                padding: '1rem',
                marginBottom: '1rem',
                border: '1px solid #ddd',
                borderRadius: '8px',
              }}
            >
              <h3 style={{ margin: '0 0 0.5rem' }}>{article.title}</h3>
              <p style={{ margin: '0 0 0.5rem', color: '#666' }}>
                {article.content}
              </p>
              <span
                style={{
                  display: 'inline-block',
                  padding: '0.25rem 0.5rem',
                  background: '#e3f2fd',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                }}
              >
                {article.category}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
`,
  },
};

/**
 * Schema Validation Example
 *
 * Demonstrates Pocket's schema validation capabilities.
 */
export const schemaExample: PlaygroundExample = {
  name: 'Schema Validation',
  description: 'Define and validate data schemas',
  openFile: 'src/App.tsx',
  files: {
    'src/main.tsx': `import React from 'react';
import ReactDOM from 'react-dom/client';
import { PocketProvider } from '@pocket/react';
import { Database } from '@pocket/core';
import App from './App';

const db = Database.create({
  name: 'schema-example',
  storage: 'memory',
  schema: {
    users: {
      properties: {
        name: { type: 'string', required: true, minLength: 2, maxLength: 50 },
        email: { type: 'string', required: true, pattern: '^[^@]+@[^@]+\\\\.[^@]+$' },
        age: { type: 'number', minimum: 0, maximum: 150 },
        role: { type: 'string', enum: ['admin', 'user', 'guest'] },
      },
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PocketProvider database={db}>
      <App />
    </PocketProvider>
  </React.StrictMode>
);
`,
    'src/App.tsx': `import { useState } from 'react';
import { useLiveQuery, usePocket } from '@pocket/react';

interface User {
  _id: string;
  name: string;
  email: string;
  age?: number;
  role: string;
}

function App() {
  const { db } = usePocket();
  const { data: users } = useLiveQuery<User>('users');

  const [form, setForm] = useState({
    name: '',
    email: '',
    age: '',
    role: 'user',
  });
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      await db.collection('users').insert({
        name: form.name,
        email: form.email,
        age: form.age ? parseInt(form.age, 10) : undefined,
        role: form.role,
      });
      setForm({ name: '', email: '', age: '', role: 'user' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed');
    }
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
      <h1>Schema Validation Demo</h1>

      <form onSubmit={handleSubmit} style={{ marginBottom: '2rem' }}>
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.25rem' }}>
            Name (required, 2-50 chars):
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            style={{ width: '100%', padding: '0.5rem' }}
          />
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.25rem' }}>
            Email (required, valid format):
          </label>
          <input
            type="text"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            style={{ width: '100%', padding: '0.5rem' }}
          />
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.25rem' }}>
            Age (optional, 0-150):
          </label>
          <input
            type="number"
            value={form.age}
            onChange={(e) => setForm({ ...form, age: e.target.value })}
            style={{ width: '100%', padding: '0.5rem' }}
          />
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.25rem' }}>
            Role (admin, user, or guest):
          </label>
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            style={{ width: '100%', padding: '0.5rem' }}
          >
            <option value="admin">Admin</option>
            <option value="user">User</option>
            <option value="guest">Guest</option>
          </select>
        </div>

        {error && (
          <div style={{ marginBottom: '1rem', padding: '0.75rem', background: '#ffebee', color: '#c62828', borderRadius: '4px' }}>
            {error}
          </div>
        )}

        <button type="submit" style={{ padding: '0.75rem 1.5rem' }}>
          Add User
        </button>
      </form>

      <h2>Users ({users.length})</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #ddd' }}>
            <th style={{ textAlign: 'left', padding: '0.5rem' }}>Name</th>
            <th style={{ textAlign: 'left', padding: '0.5rem' }}>Email</th>
            <th style={{ textAlign: 'left', padding: '0.5rem' }}>Age</th>
            <th style={{ textAlign: 'left', padding: '0.5rem' }}>Role</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user._id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '0.5rem' }}>{user.name}</td>
              <td style={{ padding: '0.5rem' }}>{user.email}</td>
              <td style={{ padding: '0.5rem' }}>{user.age ?? '-'}</td>
              <td style={{ padding: '0.5rem' }}>{user.role}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default App;
`,
  },
};

/**
 * Offline-First Sync Example
 *
 * Demonstrates how Pocket works offline and syncs when connected.
 */
export const offlineSyncExample: PlaygroundExample = {
  name: 'Offline-First Sync',
  description: 'Work offline and sync when connected',
  openFile: 'src/App.tsx',
  files: {
    'src/main.tsx': `import React from 'react';
import ReactDOM from 'react-dom/client';
import { PocketProvider } from '@pocket/react';
import { Database } from '@pocket/core';
import App from './App';

const db = Database.create({
  name: 'offline-sync-example',
  storage: 'memory',
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PocketProvider database={db}>
      <App />
    </PocketProvider>
  </React.StrictMode>
);
`,
    'src/App.tsx': `import { useState } from 'react';
import { useLiveQuery, usePocket, useSyncStatus } from '@pocket/react';

interface Note {
  _id: string;
  title: string;
  content: string;
  updatedAt: Date;
  synced: boolean;
}

function App() {
  const { db } = usePocket();
  const { data: notes } = useLiveQuery<Note>(
    'notes',
    (query) => query.orderBy('updatedAt', 'desc')
  );
  const syncStatus = useSyncStatus();

  const [isOnline, setIsOnline] = useState(true);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const addNote = async () => {
    if (!title.trim()) return;

    await db.collection('notes').insert({
      title,
      content,
      updatedAt: new Date(),
      synced: isOnline, // Mark as synced only if online
    });

    setTitle('');
    setContent('');
  };

  const toggleOnline = () => {
    setIsOnline(!isOnline);
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '700px', margin: '0 auto' }}>
      <h1>Offline-First Notes</h1>

      {/* Connection Status */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        marginBottom: '1.5rem',
        padding: '1rem',
        background: isOnline ? '#e8f5e9' : '#fff3e0',
        borderRadius: '8px',
      }}>
        <div style={{
          width: '12px',
          height: '12px',
          borderRadius: '50%',
          background: isOnline ? '#4caf50' : '#ff9800',
        }} />
        <span style={{ flex: 1 }}>
          {isOnline ? 'Online - Changes sync automatically' : 'Offline - Changes saved locally'}
        </span>
        <button onClick={toggleOnline} style={{ padding: '0.5rem 1rem' }}>
          Go {isOnline ? 'Offline' : 'Online'}
        </button>
      </div>

      {/* Add Note Form */}
      <div style={{ marginBottom: '1.5rem' }}>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Note title..."
          style={{ width: '100%', padding: '0.75rem', marginBottom: '0.5rem' }}
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Note content..."
          style={{ width: '100%', padding: '0.75rem', minHeight: '100px' }}
        />
        <button
          onClick={addNote}
          style={{ marginTop: '0.5rem', padding: '0.75rem 1.5rem' }}
        >
          Add Note
        </button>
      </div>

      {/* Notes List */}
      <div>
        <h2>Notes ({notes.length})</h2>
        {notes.map((note) => (
          <div
            key={note._id}
            style={{
              padding: '1rem',
              marginBottom: '1rem',
              border: '1px solid #ddd',
              borderRadius: '8px',
              borderLeft: note.synced ? '4px solid #4caf50' : '4px solid #ff9800',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>{note.title}</h3>
              <span style={{
                fontSize: '0.8rem',
                padding: '0.25rem 0.5rem',
                background: note.synced ? '#e8f5e9' : '#fff3e0',
                borderRadius: '4px',
              }}>
                {note.synced ? 'Synced' : 'Pending'}
              </span>
            </div>
            <p style={{ margin: '0.5rem 0', color: '#666' }}>{note.content}</p>
            <span style={{ fontSize: '0.8rem', color: '#888' }}>
              {new Date(note.updatedAt).toLocaleString()}
            </span>
          </div>
        ))}
        {notes.length === 0 && (
          <p style={{ textAlign: 'center', color: '#888', padding: '2rem' }}>
            No notes yet. Add one above!
          </p>
        )}
      </div>
    </div>
  );
}

export default App;
`,
  },
};

/**
 * Relationships Example
 *
 * Demonstrates document relationships and joins.
 */
export const relationshipsExample: PlaygroundExample = {
  name: 'Relationships',
  description: 'Document relationships with nested queries',
  openFile: 'src/App.tsx',
  files: {
    'src/main.tsx': `import React from 'react';
import ReactDOM from 'react-dom/client';
import { PocketProvider } from '@pocket/react';
import { Database } from '@pocket/core';
import App from './App';

const db = Database.create({
  name: 'relationships-example',
  storage: 'memory',
});

// Seed sample data
const seedData = async () => {
  // Create authors
  const authors = [
    { _id: 'author-1', name: 'Alice', bio: 'Tech writer' },
    { _id: 'author-2', name: 'Bob', bio: 'Science blogger' },
  ];

  for (const author of authors) {
    await db.collection('authors').insert(author);
  }

  // Create posts with author references
  const posts = [
    { _id: 'post-1', title: 'Getting Started', authorId: 'author-1', likes: 42 },
    { _id: 'post-2', title: 'Advanced Tips', authorId: 'author-1', likes: 28 },
    { _id: 'post-3', title: 'Science of Data', authorId: 'author-2', likes: 35 },
  ];

  for (const post of posts) {
    await db.collection('posts').insert(post);
  }

  // Create comments with post references
  const comments = [
    { postId: 'post-1', text: 'Great article!', user: 'Charlie' },
    { postId: 'post-1', text: 'Very helpful', user: 'Diana' },
    { postId: 'post-2', text: 'Learned a lot', user: 'Eve' },
  ];

  for (const comment of comments) {
    await db.collection('comments').insert(comment);
  }
};

seedData();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PocketProvider database={db}>
      <App />
    </PocketProvider>
  </React.StrictMode>
);
`,
    'src/App.tsx': `import { useLiveQuery, usePocket } from '@pocket/react';

interface Author {
  _id: string;
  name: string;
  bio: string;
}

interface Post {
  _id: string;
  title: string;
  authorId: string;
  likes: number;
}

interface Comment {
  _id: string;
  postId: string;
  text: string;
  user: string;
}

function App() {
  const { db } = usePocket();
  const { data: authors } = useLiveQuery<Author>('authors');
  const { data: posts } = useLiveQuery<Post>(
    'posts',
    (query) => query.orderBy('likes', 'desc')
  );
  const { data: comments } = useLiveQuery<Comment>('comments');

  // Helper to get author for a post
  const getAuthor = (authorId: string) =>
    authors.find((a) => a._id === authorId);

  // Helper to get comments for a post
  const getComments = (postId: string) =>
    comments.filter((c) => c.postId === postId);

  // Helper to get post count for an author
  const getPostCount = (authorId: string) =>
    posts.filter((p) => p.authorId === authorId).length;

  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1>Blog with Relationships</h1>

      {/* Authors Section */}
      <section style={{ marginBottom: '2rem' }}>
        <h2>Authors</h2>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          {authors.map((author) => (
            <div
              key={author._id}
              style={{
                padding: '1rem',
                border: '1px solid #ddd',
                borderRadius: '8px',
                minWidth: '200px',
              }}
            >
              <h3 style={{ margin: '0 0 0.5rem' }}>{author.name}</h3>
              <p style={{ margin: '0 0 0.5rem', color: '#666' }}>{author.bio}</p>
              <span style={{
                fontSize: '0.8rem',
                padding: '0.25rem 0.5rem',
                background: '#e3f2fd',
                borderRadius: '4px',
              }}>
                {getPostCount(author._id)} posts
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Posts Section */}
      <section>
        <h2>Posts (by popularity)</h2>
        {posts.map((post) => {
          const author = getAuthor(post.authorId);
          const postComments = getComments(post._id);

          return (
            <div
              key={post._id}
              style={{
                padding: '1.5rem',
                marginBottom: '1rem',
                border: '1px solid #ddd',
                borderRadius: '8px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <h3 style={{ margin: 0 }}>{post.title}</h3>
                <span style={{ color: '#f44336' }}>❤️ {post.likes}</span>
              </div>

              <p style={{ margin: '0 0 1rem', color: '#666' }}>
                By <strong>{author?.name ?? 'Unknown'}</strong>
              </p>

              {/* Comments */}
              <div style={{ borderTop: '1px solid #eee', paddingTop: '1rem' }}>
                <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>
                  Comments ({postComments.length})
                </h4>
                {postComments.map((comment) => (
                  <div
                    key={comment._id}
                    style={{
                      padding: '0.5rem',
                      marginBottom: '0.5rem',
                      background: '#f5f5f5',
                      borderRadius: '4px',
                    }}
                  >
                    <strong>{comment.user}:</strong> {comment.text}
                  </div>
                ))}
                {postComments.length === 0 && (
                  <p style={{ color: '#888', fontSize: '0.9rem' }}>No comments yet</p>
                )}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

export default App;
`,
  },
};

/**
 * All available playground examples
 */
export const allExamples: PlaygroundExample[] = [
  crudExample,
  reactiveExample,
  searchExample,
  schemaExample,
  offlineSyncExample,
  relationshipsExample,
];

export default allExamples;
