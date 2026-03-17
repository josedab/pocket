/**
 * @pocket/core - Relation Resolver
 *
 * Resolves document relationships by fetching related documents.
 *
 * @module @pocket/core/relations
 */

import type { Document } from '../types/document.js';
import type { PopulateOption, PopulateSpec, RelationContext, RelationDef } from './types.js';

/**
 * Parse a populate specification into a PopulateOption
 */
export function parsePopulateSpec(spec: PopulateSpec): PopulateOption {
  if (typeof spec === 'string') {
    return { path: spec };
  }
  return spec;
}

/**
 * Get the value at a nested path in an object
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Set a value at a nested path in an object
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (part === undefined) continue;
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  const lastPart = parts[parts.length - 1];
  if (lastPart) {
    current[lastPart] = value;
  }
}

/**
 * Resolve a single relation for a document
 */
async function resolveRelation(
  doc: Document,
  option: PopulateOption,
  relation: RelationDef,
  context: RelationContext
): Promise<{ resolved: unknown; fetchCount: number }> {
  const collection = context.getCollection(relation.collection);
  const localKey = relation.localKey ?? option.path;
  const foreignKey = relation.foreignKey ?? '_id';

  // Get the local value (ID or IDs to look up)
  const localValue = getNestedValue(doc, localKey);

  if (localValue === null || localValue === undefined) {
    return { resolved: relation.type === 'many' ? [] : null, fetchCount: 0 };
  }

  let fetchCount = 0;

  if (relation.type === 'one') {
    // One-to-one: fetch a single document
    const toId = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v));
    const ids = Array.isArray(localValue) ? localValue.map(toId) : [toId(localValue)];

    const results = await collection.getMany(ids);
    fetchCount = results.filter(Boolean).length;

    return {
      resolved: results[0] ?? null,
      fetchCount,
    };
  } else {
    // One-to-many: fetch multiple documents
    let query = collection.find({
      [foreignKey]: Array.isArray(localValue) ? { $in: localValue } : localValue,
      ...option.filter,
    } as Record<string, unknown>);

    if (option.sort) {
      query = query.sort(option.sort.field, option.sort.direction);
    }

    if (option.limit) {
      query = query.limit(option.limit);
    }

    const results = await query.exec();
    fetchCount = results.length;

    return {
      resolved: results,
      fetchCount,
    };
  }
}

/**
 * Resolve all specified relations for a document
 *
 * @param doc - The document to populate
 * @param specs - Populate specifications
 * @param collectionName - Name of the document's collection
 * @param context - Relation resolution context
 * @returns The document with populated fields and resolution stats
 *
 * @example
 * ```typescript
 * const populated = await resolveRelations(
 *   order,
 *   ['customer', { path: 'items', limit: 10 }],
 *   'orders',
 *   context
 * );
 * ```
 */
export async function resolveRelations<T extends Document>(
  doc: T,
  specs: PopulateSpec[],
  collectionName: string,
  context: RelationContext
): Promise<{ document: T; relationsResolved: number; documentsFetched: number }> {
  let relationsResolved = 0;
  let documentsFetched = 0;

  // Clone the document to avoid mutating the original
  const result = { ...doc } as Record<string, unknown>;

  for (const spec of specs) {
    const option = parsePopulateSpec(spec);
    const relation = context.getRelation(collectionName, option.path);

    if (!relation) {
      // Skip unknown relations - the path may not have a defined relation
      continue;
    }

    const { resolved, fetchCount } = await resolveRelation(doc, option, relation, context);

    setNestedValue(result, option.path, resolved);
    relationsResolved++;
    documentsFetched += fetchCount;

    // Handle nested populations
    if (option.populate && resolved) {
      const nestedDocs = Array.isArray(resolved) ? resolved : [resolved];

      for (let i = 0; i < nestedDocs.length; i++) {
        const nestedDoc = nestedDocs[i];
        if (!nestedDoc) continue;

        const { document: populatedNested, documentsFetched: nestedFetchCount } =
          await resolveRelations(
            nestedDoc as Document,
            option.populate,
            relation.collection,
            context
          );

        if (Array.isArray(resolved)) {
          (resolved as Document[])[i] = populatedNested;
        } else {
          setNestedValue(result, option.path, populatedNested);
        }

        documentsFetched += nestedFetchCount;
      }
    }
  }

  return {
    document: result as T,
    relationsResolved,
    documentsFetched,
  };
}

/**
 * Batch resolve relations for multiple documents.
 *
 * Optimized to collect all referenced IDs across documents and fetch them
 * in a single batch call per relation, avoiding the N+1 query problem.
 *
 * @param docs - Documents to populate
 * @param specs - Populate specifications
 * @param collectionName - Name of the documents' collection
 * @param context - Relation resolution context
 * @returns Array of populated documents
 */
export async function resolveRelationsBatch<T extends Document>(
  docs: T[],
  specs: PopulateSpec[],
  collectionName: string,
  context: RelationContext
): Promise<T[]> {
  if (docs.length === 0) return [];

  const parsedSpecs = specs.map(parsePopulateSpec);

  // Group specs by relation type for batch optimization
  const oneToOneSpecs: { option: PopulateOption; relation: RelationDef }[] = [];
  const otherSpecs: { option: PopulateOption; relation: RelationDef }[] = [];

  for (const option of parsedSpecs) {
    const relation = context.getRelation(collectionName, option.path);
    if (!relation) continue;

    if (relation.type === 'one' && !option.filter && !option.sort && !option.limit) {
      oneToOneSpecs.push({ option, relation });
    } else {
      otherSpecs.push({ option, relation });
    }
  }

  // Batch-resolve one-to-one relations: collect all IDs, fetch once, distribute
  const batchCaches = new Map<string, Map<string, Document | null>>();

  for (const { option, relation } of oneToOneSpecs) {
    const localKey = relation.localKey ?? option.path;
    const allIds = new Set<string>();

    for (const doc of docs) {
      const localValue = getNestedValue(doc, localKey);
      if (localValue === null || localValue === undefined) continue;

      const toId = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v));
      if (Array.isArray(localValue)) {
        for (const v of localValue) allIds.add(toId(v));
      } else {
        allIds.add(toId(localValue));
      }
    }

    if (allIds.size === 0) continue;

    const collection = context.getCollection(relation.collection);
    const idArray = Array.from(allIds);
    const fetched = await collection.getMany(idArray);

    const cache = new Map<string, Document | null>();
    for (let i = 0; i < idArray.length; i++) {
      cache.set(idArray[i]!, fetched[i] ?? null);
    }
    batchCaches.set(option.path, cache);
  }

  // Now populate each document using cached results for one-to-one
  const results: T[] = [];
  for (const doc of docs) {
    const result = { ...doc } as Record<string, unknown>;

    // Apply cached one-to-one relations
    for (const { option, relation } of oneToOneSpecs) {
      const localKey = relation.localKey ?? option.path;
      const localValue = getNestedValue(doc, localKey);

      if (localValue === null || localValue === undefined) {
        setNestedValue(result, option.path, null);
        continue;
      }

      const cache = batchCaches.get(option.path);
      if (!cache) continue;

      const toId = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v));
      const id = Array.isArray(localValue) ? toId(localValue[0]) : toId(localValue);
      const resolved = cache.get(id) ?? null;
      setNestedValue(result, option.path, resolved);

      // Handle nested populations for cached results
      if (option.populate && resolved) {
        const { document: populatedNested } = await resolveRelations(
          resolved,
          option.populate,
          relation.collection,
          context
        );
        setNestedValue(result, option.path, populatedNested);
      }
    }

    // Resolve non-batchable relations (one-to-many with filters/sort/limit)
    for (const { option, relation } of otherSpecs) {
      const { resolved } = await resolveRelation(doc, option, relation, context);
      setNestedValue(result, option.path, resolved);

      if (option.populate && resolved) {
        const nestedDocs = Array.isArray(resolved) ? resolved : [resolved];
        for (let i = 0; i < nestedDocs.length; i++) {
          const nestedDoc = nestedDocs[i];
          if (!nestedDoc) continue;

          const { document: populatedNested } = await resolveRelations(
            nestedDoc as Document,
            option.populate,
            relation.collection,
            context
          );

          if (Array.isArray(resolved)) {
            (resolved as Document[])[i] = populatedNested;
          } else {
            setNestedValue(result, option.path, populatedNested);
          }
        }
      }
    }

    results.push(result as T);
  }

  return results;
}
