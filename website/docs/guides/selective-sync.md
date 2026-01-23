---
sidebar_position: 14
title: Selective Sync
description: Control what data syncs with filters, policies, and field projections
---

# Selective Sync

Pocket's selective sync allows you to control exactly which documents sync between devices and the server. Filter by document fields, time ranges, or custom rules to optimize bandwidth, storage, and performance.

## Overview

Selective sync provides:
- **Document filters** using MongoDB-style query operators
- **Time-based filters** for syncing recent documents
- **Field projections** to include/exclude specific fields
- **Sync policies** with named rules for dynamic control
- **Per-collection configuration** with priorities and rate limits
- **Custom filter functions** for complex logic

## Installation

```bash
npm install @pocket/core @pocket/sync
```

## Quick Start

```typescript
import { Database, createIndexedDBStorage } from 'pocket';
import { createSyncEngine } from '@pocket/sync';

const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
});

// Create sync engine with selective sync configuration
const syncEngine = createSyncEngine(db, {
  serverUrl: 'wss://sync.example.com',
  selectiveSync: {
    collections: {
      // Only sync user's own notes
      notes: {
        name: 'notes',
        filter: { userId: currentUserId },
      },
      // Sync all settings (no filter)
      settings: {
        name: 'settings',
      },
      // Don't sync drafts
      drafts: {
        name: 'drafts',
        enabled: false,
      },
    },
  },
});
```

## Collection Configuration

### Basic Configuration

Configure sync behavior per collection:

```typescript
const selectiveConfig = {
  collections: {
    notes: {
      name: 'notes',
      // Enable/disable sync for this collection
      enabled: true,
      // Document filter - only sync matching documents
      filter: {
        userId: 'user-123',
        status: { $in: ['published', 'shared'] },
      },
      // Time-based filter
      timeFilter: {
        since: Date.now() - 7 * 24 * 60 * 60 * 1000, // Last 7 days
      },
      // Fields to include (whitelist)
      includeFields: ['title', 'content', 'tags'],
      // Or fields to exclude (blacklist)
      // excludeFields: ['localDraft', 'tempData'],
      // Sync priority (higher = sync first)
      priority: 10,
      // Sync direction
      direction: 'both', // 'push' | 'pull' | 'both' | 'none'
      // Batch size for this collection
      batchSize: 100,
      // Rate limit (max syncs per minute)
      rateLimit: 60,
    },
  },
};
```

### Default Configuration

Set defaults for unlisted collections:

```typescript
const config = {
  collections: {
    notes: { name: 'notes', priority: 10 },
    tasks: { name: 'tasks', priority: 5 },
  },
  // Applied to collections not explicitly listed
  defaultConfig: {
    enabled: true,
    direction: 'both',
    priority: 0,
    batchSize: 50,
  },
};
```

### Sync Order

Control the order collections are synced:

```typescript
const config = {
  collections: { /* ... */ },
  // Options: 'priority' | 'alphabetical' | 'size' | 'lastModified'
  syncOrder: 'priority',
};
```

## Document Filters

### Filter Operators

Use MongoDB-style query operators:

```typescript
const config = {
  collections: {
    notes: {
      name: 'notes',
      filter: {
        // Equal
        status: 'published',
        // Or explicitly
        status: { $eq: 'published' },

        // Not equal
        deleted: { $ne: true },

        // Greater than / less than
        priority: { $gt: 5 },
        updatedAt: { $gte: someTimestamp },
        size: { $lt: 10000 },
        age: { $lte: 30 },

        // In array
        category: { $in: ['work', 'personal'] },

        // Not in array
        status: { $nin: ['draft', 'archived'] },

        // Field exists
        publishedAt: { $exists: true },
        deletedAt: { $exists: false },
      },
    },
  },
};
```

### Combined Filters

All conditions are combined with AND:

```typescript
filter: {
  userId: currentUserId,           // AND
  status: { $in: ['active', 'pending'] }, // AND
  createdAt: { $gte: lastWeek },   // AND
  isArchived: { $ne: true },
}
```

### Custom Filter Function

For complex logic, use a custom filter:

```typescript
const config = {
  collections: { /* ... */ },
  // Custom filter applied to all documents
  customFilter: (doc, collection) => {
    // Complex filtering logic
    if (collection === 'notes') {
      return doc.userId === currentUserId || doc.isShared;
    }
    if (collection === 'tasks') {
      return doc.assignee === currentUserId || doc.watchers?.includes(currentUserId);
    }
    return true;
  },
};
```

## Time-Based Filters

### Recent Documents

Sync only recently modified documents:

```typescript
import { createRecentDocumentsFilter } from '@pocket/sync';

const config = {
  collections: {
    notes: {
      name: 'notes',
      // Last 7 days
      timeFilter: createRecentDocumentsFilter(7 * 24 * 60 * 60 * 1000),
    },
  },
};
```

### Date Range

Sync documents within a specific date range:

```typescript
import { createDateRangeFilter } from '@pocket/sync';

const config = {
  collections: {
    logs: {
      name: 'logs',
      timeFilter: createDateRangeFilter(
        new Date('2024-01-01'),
        new Date('2024-12-31')
      ),
    },
  },
};
```

### Global Time Filter

Apply to all collections:

```typescript
const config = {
  collections: { /* ... */ },
  // Only sync documents from the last 30 days
  globalTimeFilter: {
    since: Date.now() - 30 * 24 * 60 * 60 * 1000,
  },
};
```

### Use Creation Time

By default, time filters use `_updatedAt`. To use `_createdAt`:

```typescript
timeFilter: {
  since: lastMonth,
  useCreatedAt: true, // Use creation time instead of update time
}
```

## Field Projections

### Include Fields (Whitelist)

Only sync specific fields:

```typescript
const config = {
  collections: {
    users: {
      name: 'users',
      // Only sync these fields
      includeFields: ['name', 'email', 'avatar', 'preferences'],
      // System fields (_id, _rev, _deleted, _updatedAt) are always included
    },
  },
};
```

### Exclude Fields (Blacklist)

Exclude sensitive or large fields:

```typescript
const config = {
  collections: {
    users: {
      name: 'users',
      // Don't sync these fields
      excludeFields: ['password', 'privateKey', 'localCache'],
    },
  },
};
```

### Document Size Limits

Skip large documents:

```typescript
const config = {
  collections: { /* ... */ },
  // Skip documents larger than 1MB
  maxDocumentSize: 1024 * 1024,
};
```

## Sync Policies

Policies provide named, reusable rules that can be dynamically added and removed.

### Creating Policies

```typescript
import type { SyncPolicy } from '@pocket/sync';

const workspacePolicy: SyncPolicy = {
  name: 'workspace-filter',
  description: 'Only sync documents from current workspace',
  rules: [
    {
      name: 'workspace-notes',
      collection: 'notes',
      filter: { workspaceId: currentWorkspaceId },
      action: 'include',
      priority: 10,
    },
    {
      name: 'workspace-tasks',
      collection: 'tasks',
      filter: { workspaceId: currentWorkspaceId },
      action: 'include',
      priority: 10,
    },
  ],
  active: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};
```

### Adding Policies

```typescript
// Add policy at runtime
syncEngine.selectiveSync.addPolicy(workspacePolicy);

// Remove policy
syncEngine.selectiveSync.removePolicy('workspace-filter');
```

### Exclude Rules

Exclude matching documents from sync:

```typescript
const excludeArchivedPolicy: SyncPolicy = {
  name: 'exclude-archived',
  rules: [
    {
      name: 'no-archived-notes',
      collection: 'notes',
      filter: { isArchived: true },
      action: 'exclude', // Exclude matching documents
      priority: 100, // Higher priority = checked first
    },
  ],
  active: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};
```

### Expiring Rules

Rules can automatically expire:

```typescript
const temporaryRule: SyncRule = {
  name: 'emergency-sync',
  collection: 'alerts',
  filter: { level: 'critical' },
  action: 'include',
  // Rule expires in 24 hours
  expiresAt: Date.now() + 24 * 60 * 60 * 1000,
};
```

## Sync Scopes

Create temporary sync scopes for specific operations.

### Recent Documents Scope

```typescript
// Sync recent documents from specific collections
const scope = syncEngine.selectiveSync.createRecentDocumentsScope(
  ['notes', 'tasks'],
  7 * 24 * 60 * 60 * 1000 // Last 7 days
);

// Use scope for pull
const pullRequest = syncEngine.selectiveSync.buildPullRequest(scope);
```

### ID-Based Scope

Sync specific documents by ID:

```typescript
const scope = syncEngine.selectiveSync.createIdBasedScope({
  notes: ['note-1', 'note-2', 'note-3'],
  tasks: ['task-1'],
});

const pullRequest = syncEngine.selectiveSync.buildPullRequest(scope);
```

### Custom Scope

```typescript
import type { SyncScope } from '@pocket/sync';

const customScope: SyncScope = {
  collections: ['notes', 'tasks'],
  globalFilter: {
    userId: currentUserId,
  },
  timeRange: {
    since: Date.now() - 24 * 60 * 60 * 1000, // Last 24 hours
  },
  includeIds: {
    notes: ['important-note-1'], // Always include these
  },
  excludeIds: {
    notes: ['temp-note'], // Never include these
  },
};
```

## Monitoring and Statistics

### Sync State

```typescript
// Subscribe to selective sync state
syncEngine.selectiveSync.getState().subscribe((state) => {
  console.log('Active policies:', state.activePolicies);
  console.log('Synced collections:', state.syncedCollections);
  console.log('Pending by collection:', state.pendingByCollection);
  console.log('Filter hash:', state.filterHash);
  console.log('Last sync:', state.lastSyncAt);
});

// Get current state snapshot
const state = syncEngine.selectiveSync.getStateSnapshot();
```

### Sync Statistics

```typescript
const stats = syncEngine.selectiveSync.getSyncStats();

console.log('Total pending:', stats.totalPending);
console.log('Pending by collection:', stats.pendingByCollection);
console.log('Cache size:', stats.cacheSize);
```

### Evaluate Document

Check if a specific document would be synced:

```typescript
const shouldSync = syncEngine.selectiveSync.shouldSyncDocument(
  document,
  'notes'
);

if (shouldSync) {
  console.log('Document will sync');
} else {
  console.log('Document filtered out');
}
```

## React Integration

### useSelectiveSync Hook

```tsx
import { useState, useEffect, useCallback } from 'react';
import type { SelectiveSyncState } from '@pocket/sync';

function useSelectiveSync(syncEngine: SyncEngine) {
  const [state, setState] = useState<SelectiveSyncState | null>(null);

  useEffect(() => {
    const sub = syncEngine.selectiveSync.getState().subscribe(setState);
    return () => sub.unsubscribe();
  }, [syncEngine]);

  const addPolicy = useCallback(
    (policy: SyncPolicy) => {
      syncEngine.selectiveSync.addPolicy(policy);
    },
    [syncEngine]
  );

  const removePolicy = useCallback(
    (name: string) => {
      syncEngine.selectiveSync.removePolicy(name);
    },
    [syncEngine]
  );

  const updateConfig = useCallback(
    (config: Partial<SelectiveSyncConfig>) => {
      syncEngine.selectiveSync.updateConfig(config);
    },
    [syncEngine]
  );

  return {
    state,
    addPolicy,
    removePolicy,
    updateConfig,
  };
}
```

### Workspace Switcher

```tsx
function WorkspaceSwitcher({ syncEngine, workspaces }: Props) {
  const [currentWorkspace, setCurrentWorkspace] = useState<string | null>(null);

  const switchWorkspace = (workspaceId: string) => {
    // Remove old workspace policy
    if (currentWorkspace) {
      syncEngine.selectiveSync.removePolicy(`workspace-${currentWorkspace}`);
    }

    // Add new workspace policy
    const policy: SyncPolicy = {
      name: `workspace-${workspaceId}`,
      rules: [
        {
          name: 'workspace-docs',
          collection: 'documents',
          filter: { workspaceId },
          action: 'include',
        },
        {
          name: 'workspace-tasks',
          collection: 'tasks',
          filter: { workspaceId },
          action: 'include',
        },
      ],
      active: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    syncEngine.selectiveSync.addPolicy(policy);
    setCurrentWorkspace(workspaceId);

    // Trigger sync for new workspace
    syncEngine.pull();
  };

  return (
    <select
      value={currentWorkspace ?? ''}
      onChange={(e) => switchWorkspace(e.target.value)}
    >
      <option value="">Select Workspace</option>
      {workspaces.map((ws) => (
        <option key={ws.id} value={ws.id}>
          {ws.name}
        </option>
      ))}
    </select>
  );
}
```

### Sync Status Component

```tsx
function SyncStatus({ syncEngine }: Props) {
  const { state } = useSelectiveSync(syncEngine);

  if (!state) return null;

  const totalPending = Object.values(state.pendingByCollection).reduce(
    (sum, n) => sum + n,
    0
  );

  return (
    <div className="sync-status">
      <div className="collections">
        Syncing: {state.syncedCollections.join(', ')}
      </div>

      {totalPending > 0 && (
        <div className="pending">
          {totalPending} changes pending
          <ul>
            {Object.entries(state.pendingByCollection).map(([col, count]) => (
              <li key={col}>
                {col}: {count}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="policies">
        Active policies: {state.activePolicies.join(', ') || 'None'}
      </div>

      {state.lastSyncAt && (
        <div className="last-sync">
          Last sync: {new Date(state.lastSyncAt).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
```

## Common Patterns

### User Data Isolation

Sync only the current user's data:

```typescript
const config = {
  collections: {
    notes: {
      name: 'notes',
      filter: { ownerId: currentUserId },
    },
    tasks: {
      name: 'tasks',
      filter: {
        $or: [
          { assignee: currentUserId },
          { createdBy: currentUserId },
        ],
      },
    },
  },
};
```

### Offline-First with Recent Data

Prioritize recent data for offline use:

```typescript
const config = {
  collections: {
    // High priority: sync all recent documents
    documents: {
      name: 'documents',
      timeFilter: { since: Date.now() - 7 * 24 * 60 * 60 * 1000 },
      priority: 10,
    },
    // Medium priority: sync important old documents
    starred: {
      name: 'documents',
      filter: { isStarred: true },
      priority: 5,
    },
    // Low priority: sync the rest
    archive: {
      name: 'documents',
      filter: { isArchived: true },
      priority: 1,
      batchSize: 10, // Smaller batches
    },
  },
};
```

### Role-Based Sync

Different sync rules based on user role:

```typescript
function getSelectiveSyncConfig(userRole: string): SelectiveSyncConfig {
  const baseConfig = {
    collections: {
      documents: { name: 'documents', enabled: true },
    },
  };

  if (userRole === 'admin') {
    return {
      ...baseConfig,
      collections: {
        ...baseConfig.collections,
        auditLogs: { name: 'auditLogs', enabled: true },
        userManagement: { name: 'userManagement', enabled: true },
      },
    };
  }

  if (userRole === 'viewer') {
    return {
      ...baseConfig,
      collections: {
        documents: {
          name: 'documents',
          direction: 'pull', // Read-only
          filter: { isPublic: true },
        },
      },
    };
  }

  return baseConfig;
}
```

### Bandwidth Optimization

Minimize bandwidth for mobile devices:

```typescript
const mobileConfig: SelectiveSyncConfig = {
  collections: {
    notes: {
      name: 'notes',
      // Only sync metadata, not full content
      includeFields: ['title', 'summary', 'tags', 'updatedAt'],
      timeFilter: { since: Date.now() - 3 * 24 * 60 * 60 * 1000 }, // 3 days
      batchSize: 20,
    },
  },
  maxDocumentSize: 100 * 1024, // Skip documents > 100KB
};
```

## Best Practices

### 1. Start with Restrictive Filters

```typescript
// Good: Start restrictive, expand as needed
const config = {
  collections: {
    notes: {
      name: 'notes',
      filter: { userId: currentUserId },
      timeFilter: { since: lastWeek },
    },
  },
};

// Avoid: Syncing everything by default
const config = {
  collections: {
    notes: { name: 'notes' }, // No filters = sync all
  },
};
```

### 2. Use Priorities Wisely

```typescript
// Good: Important data syncs first
const config = {
  collections: {
    userSettings: { name: 'userSettings', priority: 100 },
    activeNotes: { name: 'notes', filter: { isActive: true }, priority: 50 },
    archivedNotes: { name: 'notes', filter: { isArchived: true }, priority: 1 },
  },
};
```

### 3. Handle Filter Changes

```typescript
// When filters change significantly, clear local data
function switchUser(newUserId: string) {
  // Update filter
  syncEngine.selectiveSync.updateConfig({
    collections: {
      notes: {
        name: 'notes',
        filter: { userId: newUserId },
      },
    },
  });

  // Clear cache
  syncEngine.selectiveSync.clearCache();

  // Re-sync from server
  syncEngine.pull();
}
```

### 4. Monitor Filter Hash

```typescript
// Filter hash changes when config changes
syncEngine.selectiveSync.getState().subscribe((state) => {
  const storedHash = localStorage.getItem('filterHash');

  if (storedHash && storedHash !== state.filterHash) {
    console.log('Filter configuration changed, re-syncing...');
    syncEngine.pull();
  }

  localStorage.setItem('filterHash', state.filterHash);
});
```

### 5. Test Filters Before Deployment

```typescript
// Validate that filters work as expected
async function testFilters() {
  const allDocs = await db.collection('notes').find().exec();

  for (const doc of allDocs) {
    const shouldSync = syncEngine.selectiveSync.shouldSyncDocument(doc, 'notes');
    console.log(`${doc._id}: ${shouldSync ? 'SYNC' : 'SKIP'}`);
  }
}
```

## Complete Example

```typescript
import { Database, createIndexedDBStorage } from 'pocket';
import { createSyncEngine, type SyncPolicy } from '@pocket/sync';

interface Note {
  _id: string;
  title: string;
  content: string;
  userId: string;
  workspaceId: string;
  isArchived: boolean;
  tags: string[];
}

async function initializeApp(userId: string, workspaceId: string) {
  const db = await Database.create({
    name: 'notes-app',
    storage: createIndexedDBStorage(),
  });

  // Create sync engine with selective sync
  const syncEngine = createSyncEngine(db, {
    serverUrl: 'wss://sync.example.com',
    selectiveSync: {
      collections: {
        notes: {
          name: 'notes',
          // Only sync user's notes in current workspace
          filter: {
            userId,
            workspaceId,
            isArchived: { $ne: true },
          },
          // Sync recent notes first
          timeFilter: {
            since: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days
          },
          // Don't sync local-only fields
          excludeFields: ['localDraft', 'offlineChanges'],
          priority: 10,
        },
        settings: {
          name: 'settings',
          filter: { userId },
          priority: 100, // Sync settings first
        },
      },
      defaultConfig: {
        enabled: false, // Don't sync unlisted collections
      },
      maxDocumentSize: 5 * 1024 * 1024, // 5MB limit
      syncOrder: 'priority',
    },
  });

  // Start monitoring for changes
  syncEngine.selectiveSync.startMonitoring();

  // Initial sync
  await syncEngine.pull();

  return { db, syncEngine };
}

// Switch workspace
function switchWorkspace(
  syncEngine: SyncEngine,
  userId: string,
  newWorkspaceId: string
) {
  // Update notes filter for new workspace
  syncEngine.selectiveSync.updateConfig({
    collections: {
      notes: {
        name: 'notes',
        filter: {
          userId,
          workspaceId: newWorkspaceId,
          isArchived: { $ne: true },
        },
        timeFilter: {
          since: Date.now() - 30 * 24 * 60 * 60 * 1000,
        },
        excludeFields: ['localDraft', 'offlineChanges'],
        priority: 10,
      },
    },
  });

  // Sync new workspace data
  syncEngine.pull();
}

// Add temporary policy for shared documents
function enableSharedDocuments(syncEngine: SyncEngine) {
  const policy: SyncPolicy = {
    name: 'shared-documents',
    description: 'Include shared documents',
    rules: [
      {
        name: 'shared-notes',
        collection: 'notes',
        filter: { isShared: true },
        action: 'include',
        priority: 5,
      },
    ],
    active: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  syncEngine.selectiveSync.addPolicy(policy);
}

// Usage
const { db, syncEngine } = await initializeApp('user-123', 'workspace-1');

// Monitor sync state
syncEngine.selectiveSync.getState().subscribe((state) => {
  console.log('Pending changes:', state.pendingByCollection);
});

// Later: switch workspace
switchWorkspace(syncEngine, 'user-123', 'workspace-2');

// Enable shared documents sync
enableSharedDocuments(syncEngine);
```

## See Also

- [Sync Setup](/docs/guides/sync-setup) - Basic sync configuration
- [Conflict Resolution](/docs/guides/conflict-resolution) - Handling sync conflicts
- [CRDTs](/docs/guides/crdts) - Conflict-free data types
