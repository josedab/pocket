/**
 * @module @pocket/playground/templates
 *
 * Pre-built example templates demonstrating Pocket features.
 * Used in the playground and documentation site.
 *
 * @example
 * ```typescript
 * const templates = createExampleTemplates();
 * const hello = getTemplateByName('hello-world');
 * ```
 */

export interface PlaygroundTemplate {
  name: string;
  title: string;
  description: string;
  category: 'getting-started' | 'data-modeling' | 'sync' | 'queries' | 'advanced';
  code: string;
  tags: string[];
}

const TEMPLATES: PlaygroundTemplate[] = [
  {
    name: 'hello-world',
    title: 'Hello Pocket',
    description: 'Create your first Pocket database and store data.',
    category: 'getting-started',
    code: `// Hello Pocket — Your first local-first database
const db = { docs: new Map() };

// Store a document
db.docs.set('user-1', {
  id: 'user-1',
  name: 'Alice',
  email: 'alice@example.com',
  createdAt: Date.now(),
});

// Read it back
const user = db.docs.get('user-1');
console.log('Stored user:', user);
return user;`,
    tags: ['beginner', 'basics'],
  },
  {
    name: 'crud-operations',
    title: 'CRUD Operations',
    description: 'Perform Create, Read, Update, Delete operations on documents.',
    category: 'getting-started',
    code: `// CRUD Operations with Pocket
const store = new Map();

// CREATE
store.set('todo-1', { id: 'todo-1', text: 'Learn Pocket', done: false });
store.set('todo-2', { id: 'todo-2', text: 'Build an app', done: false });
store.set('todo-3', { id: 'todo-3', text: 'Deploy to production', done: false });
console.log('Created 3 todos');

// READ
const todo = store.get('todo-1');
console.log('Read todo:', todo.text);

// UPDATE
store.set('todo-1', { ...store.get('todo-1'), done: true });
console.log('Updated todo-1: done =', store.get('todo-1').done);

// DELETE
store.delete('todo-3');
console.log('Deleted todo-3. Remaining:', store.size, 'todos');

// LIST ALL
const all = [...store.values()];
return all;`,
    tags: ['beginner', 'crud'],
  },
  {
    name: 'data-modeling',
    title: 'Schema & Data Modeling',
    description: 'Define document schemas with validation.',
    category: 'data-modeling',
    code: `// Schema & Data Modeling
function defineSchema(name, fields) {
  return {
    name,
    fields,
    validate(doc) {
      const errors = [];
      for (const [key, rule] of Object.entries(fields)) {
        const value = doc[key];
        if (rule.required && (value === undefined || value === null)) {
          errors.push(key + ' is required');
        }
        if (value !== undefined && typeof value !== rule.type) {
          errors.push(key + ' must be ' + rule.type);
        }
      }
      return { valid: errors.length === 0, errors };
    }
  };
}

const userSchema = defineSchema('User', {
  name: { type: 'string', required: true },
  email: { type: 'string', required: true },
  age: { type: 'number', required: false },
});

// Valid document
const valid = userSchema.validate({ name: 'Alice', email: 'a@b.com', age: 30 });
console.log('Valid doc:', valid);

// Invalid document
const invalid = userSchema.validate({ email: 42 });
console.log('Invalid doc:', invalid);

return { valid, invalid };`,
    tags: ['schema', 'validation'],
  },
  {
    name: 'reactive-queries',
    title: 'Reactive Queries',
    description: 'Subscribe to live query results that update automatically.',
    category: 'queries',
    code: `// Reactive Queries with Observables
const data = [
  { id: 1, category: 'fruit', name: 'Apple', price: 1.5 },
  { id: 2, category: 'fruit', name: 'Banana', price: 0.75 },
  { id: 3, category: 'vegetable', name: 'Carrot', price: 2.0 },
  { id: 4, category: 'fruit', name: 'Date', price: 5.0 },
  { id: 5, category: 'vegetable', name: 'Eggplant', price: 3.0 },
];

// Query: find all fruits sorted by price
function query(items, filter, sortBy) {
  return items
    .filter(filter)
    .sort((a, b) => a[sortBy] - b[sortBy]);
}

const fruits = query(data, item => item.category === 'fruit', 'price');
console.log('Fruits by price:', fruits.map(f => f.name + ' $' + f.price));

// Aggregation query
const avgPrice = data.reduce((sum, d) => sum + d.price, 0) / data.length;
console.log('Average price: $' + avgPrice.toFixed(2));

// Group by category
const grouped = {};
for (const item of data) {
  if (!grouped[item.category]) grouped[item.category] = [];
  grouped[item.category].push(item.name);
}
console.log('By category:', grouped);

return { fruits, avgPrice, grouped };`,
    tags: ['queries', 'reactive', 'aggregation'],
  },
  {
    name: 'conflict-resolution',
    title: 'Conflict Resolution',
    description: 'Handle concurrent edits with CRDT-style merge strategies.',
    category: 'sync',
    code: `// Conflict Resolution Strategies
function lastWriterWins(docA, docB) {
  return docA.updatedAt >= docB.updatedAt ? docA : docB;
}

function mergeFields(docA, docB) {
  const merged = { ...docA };
  for (const [key, value] of Object.entries(docB)) {
    if (key === 'id') continue;
    // If both modified, take the newer field
    if (docA[key] !== undefined && docB[key] !== undefined) {
      merged[key] = docA.updatedAt >= docB.updatedAt ? docA[key] : docB[key];
    } else if (docB[key] !== undefined) {
      merged[key] = value;
    }
  }
  return merged;
}

// Simulate concurrent edits
const base = { id: 'doc-1', title: 'Original', body: 'Hello', updatedAt: 100 };
const editA = { ...base, title: 'Edit A', updatedAt: 200 };
const editB = { ...base, body: 'World', updatedAt: 150 };

console.log('Last-writer-wins:', lastWriterWins(editA, editB).title);
console.log('Field merge:', mergeFields(editA, editB));

return { lww: lastWriterWins(editA, editB), merged: mergeFields(editA, editB) };`,
    tags: ['sync', 'crdt', 'conflicts'],
  },
  {
    name: 'encryption',
    title: 'Client-Side Encryption',
    description: 'Encrypt documents before storage for zero-knowledge privacy.',
    category: 'advanced',
    code: `// Client-Side Encryption
function simpleEncrypt(text, key) {
  const chars = text.split('');
  const keyChars = key.split('');
  return chars.map((c, i) => {
    const shift = keyChars[i % keyChars.length].charCodeAt(0);
    return String.fromCharCode(c.charCodeAt(0) ^ (shift % 128));
  }).join('');
}

function simpleDecrypt(encrypted, key) {
  // XOR is its own inverse
  return simpleEncrypt(encrypted, key);
}

const secret = { password: 'super-secret-123', notes: 'Private data' };
const serialized = JSON.stringify(secret);
const key = 'my-encryption-key';

const encrypted = simpleEncrypt(serialized, key);
console.log('Encrypted:', encrypted);

const decrypted = simpleDecrypt(encrypted, key);
const parsed = JSON.parse(decrypted);
console.log('Decrypted:', parsed);
console.log('Round-trip OK:', parsed.password === secret.password);

return { encrypted: encrypted.substring(0, 30) + '...', decrypted: parsed };`,
    tags: ['encryption', 'security', 'privacy'],
  },
  {
    name: 'offline-sync',
    title: 'Offline-First Sync',
    description: 'Accumulate changes offline and sync when connectivity returns.',
    category: 'sync',
    code: `// Offline-First Sync Pattern
const changeLog = [];
let online = false;

function applyChange(op, docId, data) {
  changeLog.push({ op, docId, data, timestamp: Date.now(), synced: false });
  console.log(op + ' ' + docId + (online ? ' (synced)' : ' (queued)'));
}

// Simulate offline edits
console.log('--- Offline Mode ---');
applyChange('create', 'note-1', { text: 'Written on the train' });
applyChange('create', 'note-2', { text: 'No wifi needed' });
applyChange('update', 'note-1', { text: 'Updated offline' });

console.log('Pending changes:', changeLog.filter(c => !c.synced).length);

// Come back online
console.log('\\n--- Going Online ---');
online = true;
let synced = 0;
for (const change of changeLog) {
  if (!change.synced) {
    change.synced = true;
    synced++;
  }
}
console.log('Synced ' + synced + ' changes');
console.log('Pending changes:', changeLog.filter(c => !c.synced).length);

return { totalChanges: changeLog.length, synced };`,
    tags: ['offline', 'sync', 'queue'],
  },
];

export function createExampleTemplates(): PlaygroundTemplate[] {
  return [...TEMPLATES];
}

export function getTemplateByName(name: string): PlaygroundTemplate | undefined {
  return TEMPLATES.find((t) => t.name === name);
}

export function getTemplatesByCategory(
  category: PlaygroundTemplate['category']
): PlaygroundTemplate[] {
  return TEMPLATES.filter((t) => t.category === category);
}

export function getTemplatesByTag(tag: string): PlaygroundTemplate[] {
  return TEMPLATES.filter((t) => t.tags.includes(tag));
}
