/**
 * Angular Module for Pocket
 *
 * Provides dependency injection setup for Pocket in Angular applications.
 *
 * @module @pocket/angular
 */

import type { EnvironmentProviders, Provider } from '@angular/core';
import { makeEnvironmentProviders } from '@angular/core';
import { PocketService, type PocketServiceConfig } from './pocket.service.js';

/**
 * Pocket injection token for database configuration
 */
export const POCKET_CONFIG = 'POCKET_CONFIG';

/**
 * Legacy NgModule for Pocket (for non-standalone components)
 *
 * @example
 * ```typescript
 * @NgModule({
 *   imports: [PocketModule.forRoot({ name: 'my-app', storage: 'indexeddb' })],
 * })
 * export class AppModule {}
 * ```
 *
 * @deprecated Use providePocket() with standalone components instead
 */
/* eslint-disable @typescript-eslint/no-deprecated -- Self-reference in deprecated class is intentional */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Angular module pattern requires class with static methods
export class PocketModule {
  static forRoot(config: PocketServiceConfig): {
    ngModule: typeof PocketModule;
    providers: Provider[];
  } {
    return {
      ngModule: PocketModule,
      providers: [{ provide: POCKET_CONFIG, useValue: config }, PocketService],
    };
  }
}
/* eslint-enable @typescript-eslint/no-deprecated */

/**
 * Provide Pocket for standalone Angular applications
 *
 * @example
 * ```typescript
 * // app.config.ts
 * import { ApplicationConfig } from '@angular/core';
 * import { providePocket } from '@pocket/angular';
 *
 * export const appConfig: ApplicationConfig = {
 *   providers: [
 *     providePocket({
 *       name: 'my-app',
 *       storage: 'indexeddb',
 *     }),
 *   ],
 * };
 * ```
 */
export function providePocket(config: PocketServiceConfig): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: POCKET_CONFIG, useValue: config }, PocketService]);
}
