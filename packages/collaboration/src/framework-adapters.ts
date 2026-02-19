/**
 * Multi-framework adapter layer for collaboration components.
 *
 * Provides adapter factories for Vue and Svelte that consume the
 * framework-agnostic render descriptors from react-components.ts.
 *
 * @module framework-adapters
 */

import {
  buildCursorDescriptors,
  buildPresenceDescriptors,
  buildStatusDescriptor,
  type CursorRenderDescriptor,
  type AvatarRenderDescriptor,
  type StatusRenderDescriptor,
} from './react-components.js';
import type { CollabCursor, CollabSessionStatus, CollabUser } from './types.js';

// ── Vue Composition API Adapter ──────────────────────────────────────────────

/** Minimal Vue reactivity interface for DI */
export interface VueReactivity {
  ref<T>(value: T): { value: T };
  computed<T>(getter: () => T): { readonly value: T };
  watch(source: unknown, callback: () => void): void;
}

/** Return type of useCollabCursors for Vue */
export interface VueCollabCursorsReturn {
  readonly cursors: { readonly value: CursorRenderDescriptor[] };
}

/** Return type of useCollabPresence for Vue */
export interface VueCollabPresenceReturn {
  readonly avatars: { readonly value: AvatarRenderDescriptor[] };
  readonly overflowCount: { readonly value: number };
}

/** Return type of useCollabStatus for Vue */
export interface VueCollabStatusReturn {
  readonly status: { readonly value: StatusRenderDescriptor };
}

/** Create Vue composition functions for collaboration */
export function createVueCollabAdapters(vue: VueReactivity) {
  function useCollabCursors(
    cursors: { value: CollabCursor[] },
    users: { value: Map<string, CollabUser> },
  ): VueCollabCursorsReturn {
    const result = vue.computed(() =>
      buildCursorDescriptors({ cursors: cursors.value, users: users.value }),
    );
    return { cursors: result };
  }

  function useCollabPresence(
    users: { value: CollabUser[] },
    currentUserId?: string,
  ): VueCollabPresenceReturn {
    const result = vue.computed(() =>
      buildPresenceDescriptors({ users: users.value, currentUserId }),
    );
    const avatars = vue.computed(() => result.value.visible);
    const overflowCount = vue.computed(() => result.value.overflowCount);
    return { avatars, overflowCount };
  }

  function useCollabStatus(
    status: { value: CollabSessionStatus },
  ): VueCollabStatusReturn {
    const result = vue.computed(() =>
      buildStatusDescriptor({ status: status.value }),
    );
    return { status: result };
  }

  return { useCollabCursors, useCollabPresence, useCollabStatus };
}

// ── Svelte Store Adapter ─────────────────────────────────────────────────────

/** Minimal Svelte store interface */
export interface SvelteReadable<T> {
  subscribe(run: (value: T) => void): () => void;
}

/** Svelte store factory interface */
export interface SvelteStoreFactory {
  derived<T, S>(stores: SvelteReadable<S>, fn: (value: S) => T): SvelteReadable<T>;
}

/** Create Svelte stores for collaboration */
export function createSvelteCollabAdapters(svelte: SvelteStoreFactory) {
  function collabCursorsStore(
    cursors$: SvelteReadable<CollabCursor[]>,
    _users$: SvelteReadable<Map<string, CollabUser>>,
  ): SvelteReadable<CursorRenderDescriptor[]> {
    // Combine both stores
    return svelte.derived(cursors$, (cursors) => {
      // In a real implementation, we'd combine both stores
      return buildCursorDescriptors({ cursors, users: new Map() });
    });
  }

  function collabPresenceStore(
    users$: SvelteReadable<CollabUser[]>,
    currentUserId?: string,
  ): SvelteReadable<{ visible: AvatarRenderDescriptor[]; overflowCount: number }> {
    return svelte.derived(users$, (users) =>
      buildPresenceDescriptors({ users, currentUserId }),
    );
  }

  function collabStatusStore(
    status$: SvelteReadable<CollabSessionStatus>,
  ): SvelteReadable<StatusRenderDescriptor> {
    return svelte.derived(status$, (status) =>
      buildStatusDescriptor({ status }),
    );
  }

  return { collabCursorsStore, collabPresenceStore, collabStatusStore };
}
