/**
 * @pocket/zod - Zod Schema Integration
 *
 * Provides seamless integration between Zod schemas and Pocket database.
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import { zodSchema, documentSchema } from '@pocket/zod';
 * import { Database } from '@pocket/core';
 *
 * // Define a Zod schema
 * const userZod = documentSchema({
 *   name: z.string(),
 *   email: z.string().email(),
 *   age: z.number().min(0).optional(),
 * });
 *
 * type User = z.infer<typeof userZod>;
 *
 * // Use with Pocket
 * const db = await Database.create({ name: 'my-app' });
 * const users = db.collection<User>('users', {
 *   schema: zodSchema(userZod),
 * });
 *
 * // Documents are validated using the Zod schema
 * await users.insert({
 *   _id: '1',
 *   name: 'John',
 *   email: 'john@example.com',
 * });
 * ```
 *
 * @module @pocket/zod
 */

// Adapter
export {
  documentSchema,
  partialZodSchema,
  zodSchema,
  type ZodPocketSchema,
  type ZodSchemaOptions,
} from './adapter.js';

// Converter
export {
  mergeZodSchemas,
  passthroughZodSchema,
  pocketToZod,
  strictZodSchema,
  zodToPocket,
} from './converter.js';

// Re-export core types
export { Schema } from '@pocket/core';
export type { Document, FieldDefinition, FieldType, SchemaDefinition } from '@pocket/core';
