/**
 * @pocket/forms - Schema-driven forms for Pocket
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import { parseSchema, createFormManager, field } from '@pocket/forms';
 *
 * // Define schema with form metadata
 * const userSchema = z.object({
 *   name: field.text({ label: 'Full Name', placeholder: 'Enter your name' }),
 *   email: field.email({ label: 'Email Address' }),
 *   role: field.select(['admin', 'user', 'guest'], { label: 'Role' }),
 *   bio: field.textarea({ label: 'Biography', helpText: 'Tell us about yourself' }),
 *   notifications: field.toggle({ label: 'Enable Notifications' }),
 * });
 *
 * // Parse schema into form config
 * const formConfig = parseSchema(userSchema, {
 *   title: 'User Profile',
 *   submitText: 'Save Profile',
 * });
 *
 * // Create form manager
 * const manager = createFormManager(formConfig, userSchema);
 *
 * // Use with React
 * const useForm = createUseFormHook(React);
 * const { state, register, submit } = useForm(manager);
 *
 * // Register fields
 * <input {...register('name')} />
 * <input {...register('email')} />
 * ```
 */

// Re-export zod for convenience
export { z } from 'zod';

// Types
export type {
  FieldConfig,
  FieldOption,
  FieldState,
  FieldType,
  FieldValidation,
  FormConfig,
  FormEvent,
  FormEventType,
  FormGroup,
  FormLayout,
  FormState,
  FormSubmitResult,
  RelationConfig,
  SchemaMetadata,
  ZodSchemaWithMeta,
} from './types.js';

// Schema Parser
export {
  SchemaParser,
  createFormSchemaParser,
  field,
  parseSchema,
  withFormMeta,
} from './schema-parser.js';

// Form Manager
export { FormManager, createFormManager } from './form-manager.js';

// Hooks
export type { FieldProps, ReactHooks, UseFieldReturn, UseFormReturn } from './hooks.js';

export { createUseFieldHook, createUseFormEventsHook, createUseFormHook } from './hooks.js';
