import { createServerLoader } from '@pocket/next';
import { serverLoaderConfig } from '@/lib/pocket';
import type { Todo } from '@/lib/pocket';
import { TodoList } from './todo-list';

/**
 * Server Component page.
 *
 * Creates a PocketServerLoader, fetches the `todos` collection on the server,
 * and passes the serialised data to the client component for hydration.
 */
export default async function HomePage() {
  let initialTodos: Todo[] = [];
  let serverTimestamp = Date.now();

  try {
    const loader = createServerLoader(serverLoaderConfig);
    const result = await loader.loadCollection<Todo>('todos');
    initialTodos = result.data;
    serverTimestamp = result.timestamp;
  } catch {
    // If the sync server is unreachable, start with an empty list.
    // The client will operate in local-first mode from this point.
  }

  return (
    <main>
      <h1>🗂️ Pocket + Next.js</h1>
      <p style={{ color: '#666' }}>
        Server-loaded {initialTodos.length} todo(s) — client takes over below.
      </p>
      <TodoList initialTodos={initialTodos} serverTimestamp={serverTimestamp} />
    </main>
  );
}
