# Security Policy

## Supported Versions

We release patches for security vulnerabilities in the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take security seriously at Pocket. If you discover a security vulnerability, please follow responsible disclosure practices.

### How to Report

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please report them via one of the following methods:

1. **GitHub Security Advisory** (Preferred)
   - Go to the [Security Advisories](https://github.com/pocket-db/pocket/security/advisories) page
   - Click "Report a vulnerability"
   - Fill out the form with as much detail as possible

2. **Email**
   - Send details to: security@pocket-db.dev
   - Use our PGP key (available on our website) for sensitive information

### What to Include

Please include the following information in your report:

- **Description**: A clear description of the vulnerability
- **Impact**: What an attacker could achieve by exploiting this vulnerability
- **Reproduction Steps**: Detailed steps to reproduce the issue
- **Affected Versions**: Which versions are affected
- **Suggested Fix**: If you have a suggested fix, please include it
- **Your Contact Info**: So we can follow up with questions

### Example Report

```
## Summary
SQL injection vulnerability in query builder

## Impact
An attacker could execute arbitrary queries by crafting malicious filter inputs

## Steps to Reproduce
1. Create a collection with user-controlled input
2. Pass the following payload: { title: { $regex: ".*" } }
3. Observe the query execution

## Affected Versions
All versions before 1.2.3

## Suggested Fix
Sanitize regex patterns before query execution
```

## What to Expect

After you submit a report:

1. **Acknowledgment**: We'll acknowledge receipt within 48 hours
2. **Investigation**: We'll investigate and determine the severity
3. **Updates**: We'll keep you informed of our progress
4. **Resolution**: We'll develop and test a fix
5. **Disclosure**: We'll coordinate disclosure with you

### Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Resolution Target**: Within 30 days for critical issues

## Security Best Practices

When using Pocket in your applications:

### 1. Validate User Input

```typescript
// Always validate before inserting
function createTodo(userInput: unknown) {
  const validated = validateTodoSchema(userInput);
  if (!validated.success) {
    throw new Error('Invalid input');
  }
  return todos.insert(validated.data);
}
```

### 2. Use Schema Validation

```typescript
const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
  collections: [{
    name: 'users',
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email' },
        name: { type: 'string', maxLength: 100 },
      },
      required: ['email', 'name'],
      additionalProperties: false,
    },
  }],
});
```

### 3. Secure Sync Configuration

```typescript
const sync = createSyncEngine(db, {
  serverUrl: 'wss://api.example.com/sync', // Always use TLS
  authToken: securelyStoredToken,
});
```

### 4. Sanitize Regex Patterns

```typescript
// Escape user input for regex queries
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const results = await todos
  .find()
  .where('title').matches(new RegExp(escapeRegex(userInput)))
  .exec();
```

### 5. Limit Query Results

```typescript
// Prevent denial of service from large result sets
const MAX_RESULTS = 1000;

const results = await todos
  .find(userFilter)
  .limit(Math.min(userLimit, MAX_RESULTS))
  .exec();
```

## Security Features

Pocket includes several built-in security features:

- **No eval()**: No dynamic code execution
- **Parameterized Queries**: Query operators don't allow injection
- **TypeScript**: Type safety prevents many common vulnerabilities
- **Sandboxed Storage**: Browser storage APIs are origin-isolated

## Known Security Considerations

### Client-Side Storage

Data stored in IndexedDB and OPFS is:
- Accessible to JavaScript running on the same origin
- Not encrypted by default
- Clearable by users

For sensitive data, consider:
- Encrypting data before storage
- Using short-lived tokens
- Implementing additional access controls

### Sync Security

When using sync:
- Always use TLS (wss:// or https://)
- Implement proper authentication
- Validate data on the server
- Use authorization rules per collection

## Recognition

We appreciate security researchers who help keep Pocket secure. With your permission, we'll acknowledge your contribution in our release notes and security advisories.

## Updates

This security policy may be updated from time to time. Please check back regularly for any changes.

---

Thank you for helping keep Pocket and its users safe!
