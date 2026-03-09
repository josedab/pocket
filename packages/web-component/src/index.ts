/**
 * @pocket/web-component — Embeddable SDK as Web Component.
 *
 * Self-contained `<pocket-data>` custom element for integrating Pocket
 * databases into any web application regardless of framework.
 *
 * @example
 * ```html
 * <script type="module">
 *   import { registerPocketElement } from '@pocket/web-component';
 *   registerPocketElement();
 * </script>
 *
 * <pocket-data
 *   database="myapp"
 *   collection="todos"
 *   display="table"
 *   fields="title,completed"
 *   editable
 * ></pocket-data>
 * ```
 *
 * @module @pocket/web-component
 */

// Types
export type {
  DisplayMode,
  PocketElementConfig,
  PocketElementEvent,
  PocketElementState,
} from './types.js';

// Web Component
export {
  PocketDataElement,
  registerPocketElement,
} from './pocket-element.js';
