/**
 * Dataset Loader — Pre-built datasets for playground and documentation examples.
 *
 * Provides ready-to-use sample data for the interactive REPL,
 * allowing users to immediately run queries without manual setup.
 */

/** A pre-loaded dataset with name, description, and records. */
export interface Dataset {
  readonly name: string;
  readonly description: string;
  readonly collections: Record<string, readonly Record<string, unknown>[]>;
}

/** E-commerce product catalog dataset. */
const ecommerceDataset: Dataset = {
  name: 'ecommerce',
  description: 'Product catalog with categories, prices, and reviews',
  collections: {
    products: [
      {
        id: 'p1',
        name: 'Wireless Headphones',
        category: 'electronics',
        price: 79.99,
        rating: 4.5,
        inStock: true,
      },
      {
        id: 'p2',
        name: 'USB-C Cable',
        category: 'electronics',
        price: 12.99,
        rating: 4.2,
        inStock: true,
      },
      {
        id: 'p3',
        name: 'Standing Desk',
        category: 'furniture',
        price: 449.0,
        rating: 4.8,
        inStock: false,
      },
      {
        id: 'p4',
        name: 'Mechanical Keyboard',
        category: 'electronics',
        price: 149.99,
        rating: 4.7,
        inStock: true,
      },
      {
        id: 'p5',
        name: 'Ergonomic Chair',
        category: 'furniture',
        price: 599.0,
        rating: 4.6,
        inStock: true,
      },
      {
        id: 'p6',
        name: 'Monitor Arm',
        category: 'furniture',
        price: 89.99,
        rating: 4.3,
        inStock: true,
      },
      {
        id: 'p7',
        name: 'Webcam HD',
        category: 'electronics',
        price: 69.99,
        rating: 4.1,
        inStock: true,
      },
      {
        id: 'p8',
        name: 'Desk Lamp',
        category: 'furniture',
        price: 34.99,
        rating: 4.4,
        inStock: false,
      },
    ],
    orders: [
      { id: 'o1', productId: 'p1', userId: 'u1', quantity: 1, total: 79.99, status: 'delivered' },
      { id: 'o2', productId: 'p4', userId: 'u2', quantity: 1, total: 149.99, status: 'shipped' },
      { id: 'o3', productId: 'p2', userId: 'u1', quantity: 3, total: 38.97, status: 'delivered' },
      { id: 'o4', productId: 'p5', userId: 'u3', quantity: 1, total: 599.0, status: 'processing' },
    ],
    users: [
      { id: 'u1', name: 'Alice', email: 'alice@example.com', tier: 'premium' },
      { id: 'u2', name: 'Bob', email: 'bob@example.com', tier: 'basic' },
      { id: 'u3', name: 'Charlie', email: 'charlie@example.com', tier: 'premium' },
    ],
  },
};

/** Task management dataset. */
const taskManagerDataset: Dataset = {
  name: 'tasks',
  description: 'Project management with tasks, assignees, and tags',
  collections: {
    tasks: [
      {
        id: 't1',
        title: 'Design landing page',
        status: 'done',
        priority: 'high',
        assignee: 'Alice',
        tags: ['design', 'frontend'],
        dueDate: '2026-01-15',
      },
      {
        id: 't2',
        title: 'Implement auth',
        status: 'in_progress',
        priority: 'high',
        assignee: 'Bob',
        tags: ['backend', 'security'],
        dueDate: '2026-02-01',
      },
      {
        id: 't3',
        title: 'Write API docs',
        status: 'todo',
        priority: 'medium',
        assignee: 'Charlie',
        tags: ['docs'],
        dueDate: '2026-02-15',
      },
      {
        id: 't4',
        title: 'Add unit tests',
        status: 'todo',
        priority: 'medium',
        assignee: 'Alice',
        tags: ['testing'],
        dueDate: '2026-02-20',
      },
      {
        id: 't5',
        title: 'Setup CI/CD',
        status: 'done',
        priority: 'high',
        assignee: 'Bob',
        tags: ['devops'],
        dueDate: '2026-01-20',
      },
      {
        id: 't6',
        title: 'Performance audit',
        status: 'in_progress',
        priority: 'low',
        assignee: 'Charlie',
        tags: ['performance'],
        dueDate: '2026-03-01',
      },
    ],
    projects: [
      { id: 'proj1', name: 'Website Redesign', status: 'active', taskIds: ['t1', 't2', 't3'] },
      { id: 'proj2', name: 'Infrastructure', status: 'active', taskIds: ['t4', 't5', 't6'] },
    ],
  },
};

/** Blog content dataset. */
const blogDataset: Dataset = {
  name: 'blog',
  description: 'Blog posts with authors, comments, and tags',
  collections: {
    posts: [
      {
        id: 'post1',
        title: 'Getting Started with Local-First',
        authorId: 'a1',
        content: 'Local-first apps store data on the client...',
        likes: 142,
        publishedAt: '2026-01-10',
      },
      {
        id: 'post2',
        title: 'Understanding CRDTs',
        authorId: 'a2',
        content: 'Conflict-free Replicated Data Types enable...',
        likes: 89,
        publishedAt: '2026-01-20',
      },
      {
        id: 'post3',
        title: 'Offline-First Patterns',
        authorId: 'a1',
        content: 'Building resilient apps that work offline...',
        likes: 203,
        publishedAt: '2026-02-05',
      },
      {
        id: 'post4',
        title: 'Real-Time Sync Deep Dive',
        authorId: 'a3',
        content: 'Synchronizing data across devices in real-time...',
        likes: 67,
        publishedAt: '2026-02-15',
      },
    ],
    authors: [
      { id: 'a1', name: 'Sarah Chen', bio: 'Frontend architect, local-first advocate' },
      { id: 'a2', name: 'Marcus Rivera', bio: 'Distributed systems engineer' },
      { id: 'a3', name: 'Yuki Tanaka', bio: 'Full-stack developer, sync enthusiast' },
    ],
    comments: [
      { id: 'c1', postId: 'post1', author: 'Reader1', text: 'Great introduction!' },
      { id: 'c2', postId: 'post1', author: 'Reader2', text: 'Very helpful, thanks!' },
      { id: 'c3', postId: 'post3', author: 'Reader1', text: 'This changed how I build apps.' },
      { id: 'c4', postId: 'post2', author: 'Reader3', text: 'CRDTs are fascinating.' },
    ],
  },
};

/** All available datasets. */
const DATASETS: Dataset[] = [ecommerceDataset, taskManagerDataset, blogDataset];

/** Get all available datasets. */
export function getAvailableDatasets(): readonly Dataset[] {
  return DATASETS;
}

/** Get a dataset by name. */
export function getDatasetByName(name: string): Dataset | undefined {
  return DATASETS.find((d) => d.name === name);
}

/**
 * Build a context object from a dataset that can be injected into REPL execution.
 * Creates Map-based collections for each dataset collection.
 */
export function buildDatasetContext(dataset: Dataset): Record<string, unknown> {
  const context: Record<string, unknown> = {};
  const db: Record<string, Map<string, Record<string, unknown>>> = {};

  for (const [collectionName, records] of Object.entries(dataset.collections)) {
    const map = new Map<string, Record<string, unknown>>();
    for (const record of records) {
      const id = (record.id as string) ?? `auto-${map.size}`;
      map.set(id, record);
    }
    db[collectionName] = map;
  }

  // Expose db object and helper functions
  context.db = db;
  context.find = (collection: string, predicate?: (doc: Record<string, unknown>) => boolean) => {
    const col = db[collection];
    if (!col) return [];
    const all = Array.from(col.values());
    return predicate ? all.filter(predicate) : all;
  };
  context.findById = (collection: string, id: string) => {
    return db[collection]?.get(id) ?? null;
  };
  context.count = (collection: string) => {
    return db[collection]?.size ?? 0;
  };
  context.collections = () => Object.keys(db);
  context.datasetName = dataset.name;

  return context;
}
