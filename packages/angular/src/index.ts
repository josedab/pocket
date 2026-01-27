/**
 * @pocket/angular - Angular Integration
 *
 * Provides Angular services, signals, and observables for Pocket database.
 *
 * @module @pocket/angular
 */

// Module
// eslint-disable-next-line @typescript-eslint/no-deprecated -- Re-exporting for backwards compatibility
export { PocketModule, providePocket } from './pocket.module.js';

// Service
export { PocketService, type PocketServiceConfig } from './pocket.service.js';

// Signals (Angular 16+)
export {
  liveDocument,
  liveQuery,
  syncStatus,
  type LiveQuerySignal,
} from './signals/live-query.signal.js';

// Observables
export {
  fromDocument,
  fromLiveQuery,
  fromSyncStatus,
  type LiveQueryObservable,
} from './observables/live-query.observable.js';

// Types
export type { Collection, Database, Document, QueryBuilder } from '@pocket/core';
