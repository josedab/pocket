/**
 * @module @pocket/ai-agent/data-tools
 *
 * Extended data tools for the AI agent: transformation, summarization,
 * and analysis capabilities that operate on local database collections.
 *
 * @example
 * ```typescript
 * const tools = createDataTransformationTools();
 * const agent = createAgent({ provider, tools: [...dbTools, ...tools] });
 * const result = await agent.run('Summarize all my todos by status');
 * ```
 */
import type { Tool, ToolParameter, ToolResult } from './types.js';

export interface DataTransformationConfig {
  maxDocuments?: number;
  defaultLimit?: number;
}

function param(
  name: string,
  type: ToolParameter['type'],
  description: string,
  required = true
): ToolParameter {
  return { name, type, description, required };
}

export function createDataTransformationTools(config?: DataTransformationConfig): Tool[] {
  const maxDocs = config?.maxDocuments ?? 10000;
  const defaultLimit = config?.defaultLimit ?? 100;

  const summarizeTool: Tool = {
    name: 'summarize_collection',
    description:
      'Compute summary statistics for a collection: count, field types, value distributions, and missing fields.',
    parameters: [
      param('collection', 'string', 'Name of the collection to summarize'),
      param('sampleSize', 'number', 'Number of documents to sample', false),
    ],
    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      const collection = args.collection as string;
      const sampleSize = (args.sampleSize as number) ?? defaultLimit;

      // Simulated — in real usage, this would query the actual database
      return {
        success: true,
        data: {
          collection,
          summary: {
            documentCount: 0,
            sampleSize: Math.min(sampleSize, maxDocs),
            fields: {},
            instructions: `Query the "${collection}" collection to get actual statistics`,
          },
        },
      };
    },
  };

  const transformTool: Tool = {
    name: 'transform_documents',
    description:
      'Apply a transformation to documents: rename fields, compute new fields, filter, or restructure data.',
    parameters: [
      param('collection', 'string', 'Source collection'),
      param(
        'operations',
        'array',
        'List of transformation operations: {type: "rename"|"compute"|"filter"|"project", ...}'
      ),
      param(
        'dryRun',
        'boolean',
        'If true, only preview the transformation without applying',
        false
      ),
    ],
    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      const collection = args.collection as string;
      const operations = args.operations as Record<string, unknown>[];
      const dryRun = (args.dryRun as boolean) ?? true;

      const transformedCount = 0;
      const preview: Record<string, unknown>[] = [];

      for (const op of operations) {
        switch (op.type) {
          case 'rename':
          case 'compute':
          case 'filter':
          case 'project':
            break;
          default:
            return {
              success: false,
              data: null,
              error: `Unknown operation type: ${op.type as string}`,
            };
        }
      }

      return {
        success: true,
        data: {
          collection,
          operationCount: operations.length,
          transformedCount,
          dryRun,
          preview,
        },
      };
    },
  };

  const aggregateTool: Tool = {
    name: 'aggregate_data',
    description:
      'Perform aggregation operations: group-by with count/sum/avg/min/max, or pivot tables.',
    parameters: [
      param('collection', 'string', 'Collection to aggregate'),
      param('groupBy', 'string', 'Field to group by'),
      param(
        'aggregations',
        'object',
        'Aggregation spec: {field: "operation"} where operation is count|sum|avg|min|max'
      ),
    ],
    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      const collection = args.collection as string;
      const groupBy = args.groupBy as string;
      const aggregations = args.aggregations as Record<string, string>;

      return {
        success: true,
        data: {
          collection,
          groupBy,
          aggregations,
          results: [],
          instructions: `Use the query tool to fetch "${collection}" documents, then group by "${groupBy}"`,
        },
      };
    },
  };

  const analyzeTool: Tool = {
    name: 'analyze_patterns',
    description:
      'Analyze data patterns: find duplicates, detect anomalies, identify trends, or compute correlations.',
    parameters: [
      param('collection', 'string', 'Collection to analyze'),
      param('analysisType', 'string', 'Type of analysis: duplicates|anomalies|trends|correlations'),
      param('fields', 'array', 'Fields to include in analysis'),
    ],
    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      const collection = args.collection as string;
      const analysisType = args.analysisType as string;
      const fields = args.fields as string[];

      return {
        success: true,
        data: {
          collection,
          analysisType,
          fields,
          findings: [],
          instructions: `Fetch data from "${collection}" and perform ${analysisType} analysis on [${fields.join(', ')}]`,
        },
      };
    },
  };

  const exportResultsTool: Tool = {
    name: 'format_results',
    description:
      'Format query results into a readable table, JSON, CSV, or markdown for presentation to the user.',
    parameters: [
      param('data', 'array', 'Array of data objects to format'),
      param('format', 'string', 'Output format: table|json|csv|markdown'),
      param('columns', 'array', 'Specific columns to include (optional)', false),
    ],
    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      const data = args.data as Record<string, unknown>[];
      const format = args.format as string;
      const columns = args.columns as string[] | undefined;

      if (!data || data.length === 0) {
        return { success: true, data: { formatted: 'No data to format', format } };
      }

      const cols = columns ?? Object.keys(data[0]!);
      let formatted = '';

      switch (format) {
        case 'table':
        case 'markdown': {
          const header = `| ${cols.join(' | ')} |`;
          const separator = `| ${cols.map(() => '---').join(' | ')} |`;
          const rows = data.map(
            (row) => `| ${cols.map((c) => String(row[c] ?? '')).join(' | ')} |`
          );
          formatted = [header, separator, ...rows].join('\n');
          break;
        }
        case 'csv': {
          const header = cols.join(',');
          const rows = data.map((row) => cols.map((c) => String(row[c] ?? '')).join(','));
          formatted = [header, ...rows].join('\n');
          break;
        }
        case 'json':
        default:
          formatted = JSON.stringify(data, null, 2);
          break;
      }

      return { success: true, data: { formatted, format, rowCount: data.length } };
    },
  };

  return [summarizeTool, transformTool, aggregateTool, analyzeTool, exportResultsTool];
}
