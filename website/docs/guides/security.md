---
sidebar_position: 21
title: Security
description: Security best practices for Pocket applications
---

# Security

This guide covers security best practices for applications using Pocket.

## Data Storage Security

### Browser Storage Limitations

Pocket stores data in the browser using IndexedDB or OPFS. This data is:

- **Not encrypted by default** - Data is stored in plain text
- **Accessible to JavaScript** - Any script on your origin can read it
- **Potentially clearable** - Users or browsers can clear storage
- **Origin-bound** - Other domains cannot access your data

### Request Persistent Storage

Prevent browsers from evicting data during storage pressure:

```typescript
if (navigator.storage?.persist) {
  const persisted = await navigator.storage.persist();
  if (!persisted) {
    console.warn('Storage may be cleared by browser');
  }
}
```

### Data at Rest Encryption

For sensitive data, use the encryption plugin:

```typescript
import { createEncryptedCollection } from '@pocket/encryption';

const users = await createEncryptedCollection(db, 'users', {
  encryptionKey: await deriveKey(userPassword),
  encryptedFields: ['email', 'phone', 'ssn'],
});

// Data is encrypted before storage
await users.insert({
  _id: '1',
  name: 'Alice',          // Stored in plain text
  email: 'alice@test.com', // Encrypted
  ssn: '123-45-6789',     // Encrypted
});
```

### Key Management

Never hardcode encryption keys:

```typescript
// Bad: Key in source code
const key = 'my-secret-key';

// Good: Derive from user credentials
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Good: Store key in secure storage
const key = await getKeyFromSecureStorage();
```

## Input Validation

### Schema Validation

Always define schemas to validate input:

```typescript
const db = await Database.create({
  collections: [{
    name: 'users',
    schema: {
      type: 'object',
      required: ['email'],
      additionalProperties: false, // Reject unknown fields
      properties: {
        email: {
          type: 'string',
          format: 'email',
          maxLength: 255,
        },
        name: {
          type: 'string',
          maxLength: 100,
          pattern: '^[a-zA-Z\\s]+$', // Only letters and spaces
        },
        age: {
          type: 'number',
          minimum: 0,
          maximum: 150,
        },
      },
    },
  }],
});
```

### Sanitize User Input

Don't trust user input in queries:

```typescript
// Bad: Direct user input in query
const results = await users.find({ role: userInput });

// Good: Validate and sanitize
const allowedRoles = ['user', 'admin', 'moderator'];
if (!allowedRoles.includes(userInput)) {
  throw new Error('Invalid role');
}
const results = await users.find({ role: userInput });
```

### Validate IDs

```typescript
function isValidId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length < 256;
}

// Usage
const id = req.params.id;
if (!isValidId(id)) {
  throw new Error('Invalid ID');
}
const doc = await collection.get(id);
```

## Authentication & Authorization

### Server-Side Validation

Never trust client-side data for authorization:

```typescript
// Client-side: Store user info
await users.insert({
  _id: userId,
  role: 'user', // Don't trust this for permissions
});

// Server-side: Always verify
app.post('/admin/action', async (req, res) => {
  const user = await verifyToken(req.headers.authorization);
  const dbUser = await db.users.get(user.id);

  if (dbUser.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Proceed with admin action
});
```

### Sync Authentication

Always authenticate sync connections:

```typescript
const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync',
  authToken: getAuthToken(),
  collections: ['todos'],
});

// Server-side: Verify token
wss.on('connection', async (ws, req) => {
  const token = req.headers['authorization'];
  const user = await verifyToken(token);

  if (!user) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  // Continue with authenticated connection
});
```

### Row-Level Security

Implement document-level access control:

```typescript
// Add owner field to documents
await todos.insert({
  _id: crypto.randomUUID(),
  title: 'My Todo',
  ownerId: currentUserId, // Owner of this document
});

// Query only owned documents
const myTodos = await todos
  .find()
  .where('ownerId').equals(currentUserId)
  .exec();

// Server sync: Filter by user
function filterDocumentsForUser(docs, userId) {
  return docs.filter(doc => doc.ownerId === userId);
}
```

## Sync Security

### Use HTTPS/WSS

Always use encrypted connections:

```typescript
// Bad: Unencrypted
const sync = createSyncEngine(db, {
  serverUrl: 'ws://api.example.com/sync', // HTTP
});

// Good: Encrypted
const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync', // HTTPS
});
```

### Validate Server Data

Don't blindly trust data from the server:

```typescript
// Validate incoming sync data
function validateSyncData(data: unknown): boolean {
  if (!isObject(data)) return false;
  if (!isValidId(data._id)) return false;
  // Additional validation...
  return true;
}
```

### Rate Limiting

Implement rate limiting on the server:

```typescript
// Server-side rate limiting
const rateLimiter = new RateLimiter({
  windowMs: 60000, // 1 minute
  max: 100, // 100 requests per minute
});

app.use('/sync', rateLimiter);
```

## XSS Prevention

### Sanitize Output

Always sanitize data before rendering:

```tsx
// Bad: Direct rendering
<div dangerouslySetInnerHTML={{ __html: todo.description }} />

// Good: Use text content
<div>{todo.description}</div>

// If HTML is needed, sanitize
import DOMPurify from 'dompurify';
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(todo.description) }} />
```

### Content Security Policy

Set appropriate CSP headers:

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'">
```

## Sensitive Data Handling

### What Not to Store

Avoid storing in local storage:

- Passwords (even hashed)
- Credit card numbers
- Full SSNs
- Medical records
- Other PII without encryption

### Minimal Data Storage

Only store what you need:

```typescript
// Bad: Storing full user object
await users.insert({
  password: hashedPassword, // Don't store locally
  creditCard: '4111...', // Never store
  ...fullUserData,
});

// Good: Store minimal data
await users.insert({
  _id: userId,
  name: user.name,
  preferences: user.preferences,
  // Sensitive data stays on server
});
```

### Clear Sensitive Data

Clear data on logout:

```typescript
async function logout() {
  // Clear sensitive collections
  await sessions.clear();
  await drafts.clear();

  // Or clear entire database
  await db.close();
  await indexedDB.deleteDatabase('my-app');
}
```

## Error Handling

### Don't Expose Internal Details

```typescript
// Bad: Exposing internal errors
try {
  await collection.insert(data);
} catch (error) {
  showError(error.stack); // Exposes internals
}

// Good: User-friendly errors
try {
  await collection.insert(data);
} catch (error) {
  if (PocketError.isCategory(error, 'validation')) {
    showError('Please check your input');
  } else {
    showError('Something went wrong');
    console.error(error); // Log for debugging
  }
}
```

### Log Security Events

```typescript
function logSecurityEvent(event: string, details: object) {
  console.warn('Security event:', event, details);
  // Send to monitoring service
  analytics.track('security_event', { event, ...details });
}

// Usage
if (loginAttempts > 5) {
  logSecurityEvent('brute_force_attempt', { userId, attempts: loginAttempts });
}
```

## Security Checklist

### Before Production

- [ ] Schema validation enabled for all collections
- [ ] Encryption configured for sensitive fields
- [ ] HTTPS/WSS for all sync connections
- [ ] Authentication required for sync
- [ ] Rate limiting on server endpoints
- [ ] CSP headers configured
- [ ] No sensitive data in local storage without encryption
- [ ] Proper error handling without exposing internals
- [ ] Input validation and sanitization
- [ ] Row-level security implemented

### Regular Audits

- [ ] Review stored data for sensitive information
- [ ] Check for unused collections/data
- [ ] Verify encryption is working
- [ ] Test authentication flows
- [ ] Review access patterns

## Next Steps

- [Encryption Guide](/docs/guides/encryption) - Full encryption setup
- [Sync Setup](/docs/guides/sync-setup) - Secure sync configuration
- [Schema Validation](/docs/guides/schema-validation) - Input validation
