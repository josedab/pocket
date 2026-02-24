export type {
  HydrationProps,
  PocketNextConfig,
  ServerLoaderConfig,
  ServerLoaderResult,
} from './types.js';

export { PocketServerLoader, createServerLoader } from './server-loader.js';
export type { CollectionSpec } from './server-loader.js';

export { createHydrationProvider, createUseHydratedQueryHook } from './hydration.js';
export type { HydratedQueryResult, HydrationProvider, ReactHooks } from './hydration.js';

// ISR Adapter
export {
  createPocketDynamicLoader,
  createPocketLoader,
  createWebhookHandler,
  generateWebhookSignature,
} from './isr-adapter.js';
export type {
  PocketLoaderConfig,
  PocketLoaderResult,
  RevalidationResult,
  ServerDataSource,
  WebhookConfig,
  WebhookPayload,
} from './isr-adapter.js';

// ISR Bridge (next-gen)
export {
  HydrationBridge,
  createRevalidationHandler,
  createStaticPropsFactory,
  verifyRevalidationSignature,
  type HydrationPayload,
  type ISRConfig,
  type ISRDataSource,
  type ISRRevalidationResult,
  type PocketStaticProps,
  type RevalidationRequest,
} from './isr-bridge.js';

// ISR Middleware (next-gen)
export {
  ISRMiddleware,
  collectionCacheTag,
  createISRMiddleware,
  documentCacheTag,
  type CacheTag,
  type ISRMiddlewareConfig,
  type MiddlewareResult,
  type SyncRevalidationEvent,
} from './isr-middleware.js';
