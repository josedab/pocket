// Types
export type {
  AggregateClause,
  AggregateOperation,
  AggregateResult,
  ComparisonOperator,
  CompiledQuery,
  GroupByClause,
  JoinClause,
  JoinedResult,
  LogicalGroup,
  PocketQLConfig,
  ProjectionSpec,
  QueryExpression,
  QueryPlan,
  QueryStep,
  SortClause,
  ValidationResult,
  WhereClause,
} from './types.js';

// Query Builder
export { createPocketQLBuilder } from './query-builder.js';
export type { QueryBuilder } from './query-builder.js';

// Query Compiler
export { createQueryCompiler } from './query-compiler.js';
export type { QueryCompiler } from './query-compiler.js';

// Query Executor
export { createPocketQLExecutor } from './query-executor.js';
export type { QueryExecutor } from './query-executor.js';

// PQL Parser
export { Lexer, Parser, parsePQL } from './parser.js';
export type {
  ASTNode,
  ASTNodeType,
  OrderByClause,
  JoinClause as PQLJoinClause,
  PQLQuery,
  ParseError,
  ParseResult,
  SelectColumn,
  WhereCondition,
} from './parser.js';

// Execution Bridge
export { ExecutionBridge, createExecutionBridge } from './execution-bridge.js';
export type { CollectionQueryFn, ExecutionPlan, ExecutionResult } from './execution-bridge.js';
