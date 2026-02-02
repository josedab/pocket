/**
 * @pocket/codegen - AI-Powered Schema Generator
 *
 * Generates Pocket schema definitions from natural language descriptions
 * using LLM providers (OpenAI, Anthropic, or custom handlers).
 * Includes built-in templates for common application types and
 * prompt engineering for reliable schema output.
 *
 * @example
 * ```typescript
 * import { createAISchemaGenerator } from '@pocket/codegen';
 *
 * const generator = createAISchemaGenerator({
 *   provider: 'openai',
 *   apiKey: process.env.OPENAI_API_KEY,
 *   model: 'gpt-4',
 * });
 *
 * const result = await generator.generate({
 *   description: 'A task management app with projects and team members',
 *   appType: 'todo',
 *   features: ['tags', 'due-dates', 'assignments'],
 * });
 *
 * console.log(result.schema);
 * console.log(result.explanation);
 * ```
 *
 * @module @pocket/codegen
 */

import type { PocketSchema, SchemaField } from './types.js';

/**
 * Configuration for the AI schema generator.
 */
export interface AISchemaGeneratorConfig {
  /** LLM provider to use for schema generation */
  provider: 'openai' | 'anthropic' | 'custom';
  /** API key for the chosen provider */
  apiKey?: string;
  /** Model identifier (e.g. 'gpt-4', 'claude-3-opus-20240229') */
  model?: string;
  /** Base URL for the API (useful for proxies or self-hosted models) */
  baseUrl?: string;
  /** Custom handler function for schema generation */
  customHandler?: (prompt: string) => Promise<string>;
  /** Sampling temperature for the LLM (0–1, default: 0.3) */
  temperature?: number;
  /** Maximum number of retries on failure (default: 2) */
  maxRetries?: number;
}

/**
 * Request parameters for schema generation.
 */
export interface SchemaGenerationRequest {
  /** Natural language description of the desired schema */
  description: string;
  /** Pre-defined application type for template-based generation */
  appType?: 'todo' | 'ecommerce' | 'blog' | 'crm' | 'social' | 'custom';
  /** Specific features to include in the generated schema */
  features?: string[];
  /** Names of existing collections to incorporate or reference */
  existingCollections?: string[];
}

/**
 * Result of an AI schema generation request.
 */
export interface SchemaGenerationResult {
  /** The generated Pocket schema definition */
  schema: PocketSchema;
  /** Human-readable explanation of the generated schema */
  explanation: string;
  /** Suggestions for improving or extending the schema */
  suggestions: string[];
  /** Confidence score from 0 to 1 indicating generation quality */
  confidence: number;
}

/**
 * Built-in schema templates for common application types.
 *
 * Each template provides a ready-to-use {@link PocketSchema} with
 * sensible defaults, relationships, and validation constraints.
 */
export const SCHEMA_TEMPLATES: Record<string, PocketSchema> = {
  todo: {
    version: '1.0.0',
    collections: [
      {
        name: 'users',
        description: 'Application users',
        fields: {
          name: { type: 'string', required: true, description: 'Full name of the user' },
          email: {
            type: 'string',
            required: true,
            unique: true,
            description: 'Email address',
            validation: { pattern: '^[^@]+@[^@]+\\.[^@]+$' },
          },
          avatar: { type: 'string', description: 'URL to user avatar image' },
        },
        timestamps: true,
      },
      {
        name: 'todos',
        description: 'Todo items',
        fields: {
          title: { type: 'string', required: true, description: 'Todo title', validation: { min: 1, max: 200 } },
          description: { type: 'string', description: 'Detailed description' },
          completed: { type: 'boolean', default: false, description: 'Whether the todo is completed' },
          dueDate: { type: 'date', description: 'Due date for the todo' },
          priority: {
            type: 'string',
            default: 'medium',
            description: 'Priority level',
            validation: { enum: ['low', 'medium', 'high'] },
          },
          userId: {
            type: 'reference',
            required: true,
            reference: { collection: 'users' },
            description: 'Owner of the todo',
          },
          tags: {
            type: 'array',
            items: { type: 'reference', reference: { collection: 'tags' } },
            description: 'Associated tags',
          },
        },
        timestamps: true,
        softDelete: true,
      },
      {
        name: 'tags',
        description: 'Tags for categorizing todos',
        fields: {
          name: { type: 'string', required: true, unique: true, description: 'Tag name' },
          color: { type: 'string', description: 'Display color (hex code)' },
        },
        timestamps: true,
      },
    ],
  },
  ecommerce: {
    version: '1.0.0',
    collections: [
      {
        name: 'users',
        description: 'Registered customers',
        fields: {
          name: { type: 'string', required: true, description: 'Customer name' },
          email: {
            type: 'string',
            required: true,
            unique: true,
            description: 'Email address',
            validation: { pattern: '^[^@]+@[^@]+\\.[^@]+$' },
          },
          address: {
            type: 'object',
            description: 'Shipping address',
            properties: {
              street: { type: 'string', description: 'Street address' },
              city: { type: 'string', description: 'City' },
              state: { type: 'string', description: 'State or province' },
              zip: { type: 'string', description: 'Postal code' },
              country: { type: 'string', description: 'Country' },
            },
          },
        },
        timestamps: true,
      },
      {
        name: 'products',
        description: 'Product catalog',
        fields: {
          name: { type: 'string', required: true, description: 'Product name' },
          description: { type: 'string', description: 'Product description' },
          price: { type: 'number', required: true, description: 'Price in cents', validation: { min: 0 } },
          sku: { type: 'string', required: true, unique: true, description: 'Stock keeping unit' },
          stock: { type: 'number', default: 0, description: 'Available inventory', validation: { min: 0 } },
          categoryId: {
            type: 'reference',
            reference: { collection: 'categories' },
            description: 'Product category',
          },
          images: {
            type: 'array',
            items: { type: 'string' },
            description: 'Product image URLs',
          },
        },
        timestamps: true,
        softDelete: true,
      },
      {
        name: 'orders',
        description: 'Customer orders',
        fields: {
          userId: {
            type: 'reference',
            required: true,
            reference: { collection: 'users' },
            description: 'Customer who placed the order',
          },
          status: {
            type: 'string',
            required: true,
            default: 'pending',
            description: 'Order status',
            validation: { enum: ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'] },
          },
          total: { type: 'number', required: true, description: 'Order total in cents', validation: { min: 0 } },
        },
        timestamps: true,
        softDelete: true,
      },
      {
        name: 'order_items',
        description: 'Individual items within an order',
        fields: {
          orderId: {
            type: 'reference',
            required: true,
            reference: { collection: 'orders' },
            description: 'Parent order',
          },
          productId: {
            type: 'reference',
            required: true,
            reference: { collection: 'products' },
            description: 'Product ordered',
          },
          quantity: { type: 'number', required: true, description: 'Quantity ordered', validation: { min: 1 } },
          unitPrice: { type: 'number', required: true, description: 'Price per unit at time of order' },
        },
        timestamps: true,
      },
      {
        name: 'categories',
        description: 'Product categories',
        fields: {
          name: { type: 'string', required: true, unique: true, description: 'Category name' },
          description: { type: 'string', description: 'Category description' },
          parentId: {
            type: 'reference',
            reference: { collection: 'categories' },
            description: 'Parent category for nesting',
          },
        },
        timestamps: true,
      },
    ],
  },
  blog: {
    version: '1.0.0',
    collections: [
      {
        name: 'users',
        description: 'Blog authors and readers',
        fields: {
          name: { type: 'string', required: true, description: 'Display name' },
          email: {
            type: 'string',
            required: true,
            unique: true,
            description: 'Email address',
            validation: { pattern: '^[^@]+@[^@]+\\.[^@]+$' },
          },
          bio: { type: 'string', description: 'Author biography' },
          role: {
            type: 'string',
            default: 'reader',
            description: 'User role',
            validation: { enum: ['reader', 'author', 'admin'] },
          },
        },
        timestamps: true,
      },
      {
        name: 'posts',
        description: 'Blog posts',
        fields: {
          title: { type: 'string', required: true, description: 'Post title', validation: { min: 1, max: 200 } },
          slug: { type: 'string', required: true, unique: true, description: 'URL-friendly slug' },
          content: { type: 'string', required: true, description: 'Post body (Markdown)' },
          excerpt: { type: 'string', description: 'Short summary' },
          status: {
            type: 'string',
            default: 'draft',
            description: 'Publication status',
            validation: { enum: ['draft', 'published', 'archived'] },
          },
          authorId: {
            type: 'reference',
            required: true,
            reference: { collection: 'users' },
            description: 'Post author',
          },
          tags: {
            type: 'array',
            items: { type: 'reference', reference: { collection: 'tags' } },
            description: 'Associated tags',
          },
          publishedAt: { type: 'date', description: 'Publication date' },
        },
        timestamps: true,
        softDelete: true,
      },
      {
        name: 'comments',
        description: 'Post comments',
        fields: {
          content: { type: 'string', required: true, description: 'Comment text', validation: { min: 1 } },
          postId: {
            type: 'reference',
            required: true,
            reference: { collection: 'posts' },
            description: 'Parent post',
          },
          authorId: {
            type: 'reference',
            required: true,
            reference: { collection: 'users' },
            description: 'Comment author',
          },
        },
        timestamps: true,
        softDelete: true,
      },
      {
        name: 'tags',
        description: 'Content tags',
        fields: {
          name: { type: 'string', required: true, unique: true, description: 'Tag name' },
          slug: { type: 'string', required: true, unique: true, description: 'URL-friendly slug' },
        },
        timestamps: true,
      },
    ],
  },
  crm: {
    version: '1.0.0',
    collections: [
      {
        name: 'contacts',
        description: 'People tracked in the CRM',
        fields: {
          firstName: { type: 'string', required: true, description: 'First name' },
          lastName: { type: 'string', required: true, description: 'Last name' },
          email: {
            type: 'string',
            unique: true,
            description: 'Email address',
            validation: { pattern: '^[^@]+@[^@]+\\.[^@]+$' },
          },
          phone: { type: 'string', description: 'Phone number' },
          companyId: {
            type: 'reference',
            reference: { collection: 'companies' },
            description: 'Associated company',
          },
          status: {
            type: 'string',
            default: 'lead',
            description: 'Contact status',
            validation: { enum: ['lead', 'prospect', 'customer', 'churned'] },
          },
        },
        timestamps: true,
      },
      {
        name: 'companies',
        description: 'Organizations',
        fields: {
          name: { type: 'string', required: true, description: 'Company name' },
          industry: { type: 'string', description: 'Industry sector' },
          website: { type: 'string', description: 'Company website URL' },
          size: {
            type: 'string',
            description: 'Company size bracket',
            validation: { enum: ['1-10', '11-50', '51-200', '201-1000', '1000+'] },
          },
        },
        timestamps: true,
      },
      {
        name: 'deals',
        description: 'Sales deals and opportunities',
        fields: {
          title: { type: 'string', required: true, description: 'Deal title' },
          value: { type: 'number', description: 'Deal value in cents', validation: { min: 0 } },
          stage: {
            type: 'string',
            default: 'discovery',
            description: 'Deal pipeline stage',
            validation: { enum: ['discovery', 'proposal', 'negotiation', 'closed-won', 'closed-lost'] },
          },
          contactId: {
            type: 'reference',
            required: true,
            reference: { collection: 'contacts' },
            description: 'Primary contact',
          },
          companyId: {
            type: 'reference',
            reference: { collection: 'companies' },
            description: 'Associated company',
          },
          expectedCloseDate: { type: 'date', description: 'Expected close date' },
        },
        timestamps: true,
        softDelete: true,
      },
      {
        name: 'activities',
        description: 'CRM activity log',
        fields: {
          type: {
            type: 'string',
            required: true,
            description: 'Activity type',
            validation: { enum: ['call', 'email', 'meeting', 'note', 'task'] },
          },
          subject: { type: 'string', required: true, description: 'Activity subject' },
          notes: { type: 'string', description: 'Activity notes' },
          contactId: {
            type: 'reference',
            reference: { collection: 'contacts' },
            description: 'Related contact',
          },
          dealId: {
            type: 'reference',
            reference: { collection: 'deals' },
            description: 'Related deal',
          },
          scheduledAt: { type: 'date', description: 'Scheduled date/time' },
          completedAt: { type: 'date', description: 'Completion date/time' },
        },
        timestamps: true,
      },
    ],
  },
  social: {
    version: '1.0.0',
    collections: [
      {
        name: 'users',
        description: 'Social network users',
        fields: {
          username: {
            type: 'string',
            required: true,
            unique: true,
            description: 'Unique username',
            validation: { min: 3, max: 30 },
          },
          displayName: { type: 'string', required: true, description: 'Display name' },
          email: {
            type: 'string',
            required: true,
            unique: true,
            description: 'Email address',
            validation: { pattern: '^[^@]+@[^@]+\\.[^@]+$' },
          },
          bio: { type: 'string', description: 'User biography', validation: { max: 500 } },
          avatar: { type: 'string', description: 'Avatar image URL' },
        },
        timestamps: true,
      },
      {
        name: 'posts',
        description: 'User posts',
        fields: {
          content: { type: 'string', required: true, description: 'Post content', validation: { min: 1, max: 5000 } },
          authorId: {
            type: 'reference',
            required: true,
            reference: { collection: 'users' },
            description: 'Post author',
          },
          media: {
            type: 'array',
            items: { type: 'string' },
            description: 'Attached media URLs',
          },
          visibility: {
            type: 'string',
            default: 'public',
            description: 'Post visibility',
            validation: { enum: ['public', 'friends', 'private'] },
          },
        },
        timestamps: true,
        softDelete: true,
      },
      {
        name: 'comments',
        description: 'Comments on posts',
        fields: {
          content: { type: 'string', required: true, description: 'Comment text', validation: { min: 1, max: 2000 } },
          postId: {
            type: 'reference',
            required: true,
            reference: { collection: 'posts' },
            description: 'Parent post',
          },
          authorId: {
            type: 'reference',
            required: true,
            reference: { collection: 'users' },
            description: 'Comment author',
          },
        },
        timestamps: true,
        softDelete: true,
      },
      {
        name: 'likes',
        description: 'Likes on posts',
        fields: {
          postId: {
            type: 'reference',
            required: true,
            reference: { collection: 'posts' },
            description: 'Liked post',
          },
          userId: {
            type: 'reference',
            required: true,
            reference: { collection: 'users' },
            description: 'User who liked',
          },
        },
        timestamps: true,
        indexes: [{ fields: ['postId', 'userId'], unique: true }],
      },
      {
        name: 'follows',
        description: 'User follow relationships',
        fields: {
          followerId: {
            type: 'reference',
            required: true,
            reference: { collection: 'users' },
            description: 'User who follows',
          },
          followingId: {
            type: 'reference',
            required: true,
            reference: { collection: 'users' },
            description: 'User being followed',
          },
        },
        timestamps: true,
        indexes: [{ fields: ['followerId', 'followingId'], unique: true }],
      },
    ],
  },
};

/** Default models for each supported LLM provider */
const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-3-5-sonnet-20241022',
};

/** Default API base URLs for each provider */
const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
};

/**
 * AI-powered schema generator that uses LLM providers to create
 * Pocket schema definitions from natural language descriptions.
 *
 * @example
 * ```typescript
 * const generator = new AISchemaGenerator({
 *   provider: 'openai',
 *   apiKey: 'sk-...',
 * });
 *
 * const result = await generator.generate({
 *   description: 'A recipe sharing platform',
 *   features: ['ratings', 'categories', 'user-profiles'],
 * });
 * ```
 */
export class AISchemaGenerator {
  private config: AISchemaGeneratorConfig;

  /**
   * Create a new AISchemaGenerator.
   *
   * @param config - Configuration including provider, API key, and model settings
   */
  constructor(config: AISchemaGeneratorConfig) {
    this.config = {
      temperature: 0.3,
      maxRetries: 2,
      ...config,
    };
  }

  /**
   * Generate a Pocket schema from a natural language description.
   *
   * Uses built-in templates when an `appType` is specified, enhanced
   * with the description and requested features. Falls back to full
   * LLM generation for custom schemas.
   *
   * @param request - The schema generation request
   * @returns Generated schema with explanation, suggestions, and confidence
   *
   * @example
   * ```typescript
   * const result = await generator.generate({
   *   description: 'An online bookstore with reviews',
   *   appType: 'ecommerce',
   *   features: ['reviews', 'wishlists'],
   * });
   * ```
   */
  async generate(request: SchemaGenerationRequest): Promise<SchemaGenerationResult> {
    // Use template directly if appType matches and no custom features
    if (request.appType && request.appType !== 'custom' && SCHEMA_TEMPLATES[request.appType]) {
      if (!request.features || request.features.length === 0) {
        const template = SCHEMA_TEMPLATES[request.appType]!;
        return {
          schema: structuredClone(template),
          explanation: `Generated a ${request.appType} schema based on the built-in template. ` +
            `Includes ${template.collections.length} collections: ` +
            `${template.collections.map((c) => c.name).join(', ')}.`,
          suggestions: [
            'Consider adding custom fields specific to your use case.',
            'Review validation constraints and adjust limits as needed.',
            'Add indexes for fields you plan to query frequently.',
          ],
          confidence: 0.95,
        };
      }
    }

    const prompt = this.buildPrompt(request);
    const response = await this.callLLM(prompt);
    const schema = this.parseResponse(response);

    return {
      schema,
      explanation: this.extractExplanation(response),
      suggestions: this.extractSuggestions(response),
      confidence: this.estimateConfidence(schema, request),
    };
  }

  /**
   * Refine an existing schema based on a natural language instruction.
   *
   * @param schema - The current schema to refine
   * @param instruction - Natural language instruction for refinement
   * @returns Refined schema with explanation and suggestions
   *
   * @example
   * ```typescript
   * const result = await generator.refine(
   *   existingSchema,
   *   'Add a ratings system with 1-5 stars and text reviews'
   * );
   * ```
   */
  async refine(schema: PocketSchema, instruction: string): Promise<SchemaGenerationResult> {
    const prompt = this.buildRefinePrompt(schema, instruction);
    const response = await this.callLLM(prompt);
    const refined = this.parseResponse(response);

    return {
      schema: refined,
      explanation: this.extractExplanation(response),
      suggestions: this.extractSuggestions(response),
      confidence: this.estimateConfidence(refined, { description: instruction }),
    };
  }

  /**
   * Explain a schema in plain English.
   *
   * @param schema - The schema to explain
   * @returns Human-readable explanation of the schema
   *
   * @example
   * ```typescript
   * const explanation = await generator.explain(mySchema);
   * console.log(explanation);
   * // "This schema defines a blog application with 4 collections..."
   * ```
   */
  async explain(schema: PocketSchema): Promise<string> {
    const prompt = this.buildExplainPrompt(schema);
    return this.callLLM(prompt);
  }

  /**
   * Build the LLM prompt for schema generation.
   *
   * Constructs a detailed system prompt describing the Pocket schema format,
   * available field types, and includes template examples as few-shot context.
   * This method is public to support testing and prompt inspection.
   *
   * @param request - The schema generation request
   * @returns The fully constructed prompt string
   *
   * @example
   * ```typescript
   * const prompt = generator.buildPrompt({
   *   description: 'A task tracker',
   *   appType: 'todo',
   * });
   * console.log(prompt);
   * ```
   */
  buildPrompt(request: SchemaGenerationRequest): string {
    const templateExample = this.getTemplateExample(request.appType);

    let prompt = `You are an expert database schema designer for the Pocket framework.
Your task is to generate a schema definition in JSON format based on the user's description.

## Pocket Schema Format

A Pocket schema is a JSON object with the following structure:

\`\`\`typescript
interface PocketSchema {
  version: string;           // Schema version (e.g. "1.0.0")
  collections: Array<{
    name: string;            // Collection name (snake_case)
    description?: string;    // Human-readable description
    fields: Record<string, {
      type: SchemaFieldType; // Field data type
      required?: boolean;    // Whether the field is required
      default?: unknown;     // Default value
      description?: string;  // Human-readable field description
      items?: SchemaField;   // For array type: item schema
      properties?: Record<string, SchemaField>; // For object type: nested fields
      reference?: {          // For reference type: target collection
        collection: string;
        field?: string;
      };
      validation?: {         // Validation constraints
        min?: number;
        max?: number;
        pattern?: string;
        enum?: unknown[];
      };
      index?: boolean;       // Whether to index this field
      unique?: boolean;      // Whether values must be unique
    }>;
    timestamps?: boolean;    // Auto-add createdAt/updatedAt
    softDelete?: boolean;    // Use soft delete instead of hard delete
    indexes?: Array<{        // Compound indexes
      fields: string[];
      unique?: boolean;
    }>;
  }>;
}
\`\`\`

## Available Field Types
- \`string\`: Text data
- \`number\`: Numeric data (integers or floats)
- \`boolean\`: True/false values
- \`date\`: Date/time values
- \`array\`: Ordered list of items (requires \`items\` definition)
- \`object\`: Nested object (requires \`properties\` definition)
- \`reference\`: Foreign key to another collection (requires \`reference\` definition)

## Best Practices
- Use snake_case for collection names
- Use camelCase for field names
- Always include a description for collections and fields
- Set \`required: true\` for essential fields
- Use \`reference\` type to link collections
- Enable \`timestamps: true\` for audit trails
- Use \`softDelete: true\` for data that shouldn't be permanently deleted
- Add validation constraints where appropriate
- Add \`unique: true\` for naturally unique fields (emails, slugs, etc.)
`;

    if (templateExample) {
      prompt += `
## Example Schema

Here is an example schema for reference:

\`\`\`json
${JSON.stringify(templateExample, null, 2)}
\`\`\`

`;
    }

    prompt += `
## User Request

Description: ${request.description}
`;

    if (request.appType) {
      prompt += `Application Type: ${request.appType}\n`;
    }

    if (request.features && request.features.length > 0) {
      prompt += `Requested Features: ${request.features.join(', ')}\n`;
    }

    if (request.existingCollections && request.existingCollections.length > 0) {
      prompt += `Existing Collections (reference these, do not redefine): ${request.existingCollections.join(', ')}\n`;
    }

    prompt += `
## Response Format

Respond with a JSON code block containing the PocketSchema, followed by:
1. An "EXPLANATION:" section explaining the schema design decisions
2. A "SUGGESTIONS:" section with bullet points for improvements

\`\`\`json
{ "version": "1.0.0", "collections": [...] }
\`\`\`

EXPLANATION:
<your explanation here>

SUGGESTIONS:
- <suggestion 1>
- <suggestion 2>
- <suggestion 3>
`;

    return prompt;
  }

  /**
   * Parse an LLM response string into a PocketSchema.
   *
   * Extracts JSON from code blocks or raw JSON in the response text.
   * This method is public to support testing and custom parsing workflows.
   *
   * @param response - Raw LLM response text
   * @returns Parsed PocketSchema
   * @throws Error if no valid JSON schema is found in the response
   *
   * @example
   * ```typescript
   * const schema = generator.parseResponse('```json\n{"version":"1.0.0",...}\n```');
   * ```
   */
  parseResponse(response: string): PocketSchema {
    // Try to extract JSON from code blocks
    const codeBlockMatch = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/.exec(response);
    let jsonStr: string | undefined;

    if (codeBlockMatch?.[1]) {
      jsonStr = codeBlockMatch[1].trim();
    } else {
      // Try to find raw JSON object
      const jsonMatch = /\{[\s\S]*"version"[\s\S]*"collections"[\s\S]*\}/.exec(response);
      if (jsonMatch?.[0]) {
        jsonStr = jsonMatch[0];
      }
    }

    if (!jsonStr) {
      throw new Error('Failed to parse schema from LLM response: no valid JSON found');
    }

    try {
      const parsed = JSON.parse(jsonStr) as PocketSchema;
      return this.normalizeSchema(parsed);
    } catch (error) {
      throw new Error(
        `Failed to parse schema JSON: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Call the configured LLM provider with the given prompt.
   */
  private async callLLM(prompt: string): Promise<string> {
    const maxRetries = this.config.maxRetries ?? 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (this.config.provider === 'custom') {
          if (!this.config.customHandler) {
            throw new Error('Custom provider requires a customHandler function');
          }
          return await this.config.customHandler(prompt);
        }

        if (this.config.provider === 'openai') {
          return await this.callOpenAI(prompt);
        }

        if (this.config.provider === 'anthropic') {
          return await this.callAnthropic(prompt);
        }

        throw new Error(`Unsupported provider: ${this.config.provider}`);
      } catch (error) {
        if (attempt === maxRetries) {
          throw error;
        }
        // Wait before retrying with exponential backoff
        await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
      }
    }

    // Unreachable, but satisfies TypeScript
    throw new Error('Failed after maximum retries');
  }

  /**
   * Call the OpenAI API.
   */
  private async callOpenAI(prompt: string): Promise<string> {
    if (!this.config.apiKey) {
      throw new Error('OpenAI provider requires an apiKey');
    }

    const baseUrl = this.config.baseUrl ?? DEFAULT_BASE_URLS.openai;
    const model = this.config.model ?? DEFAULT_MODELS.openai;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: this.config.temperature ?? 0.3,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as {
      choices: { message: { content: string } }[];
    };

    return data.choices[0]?.message?.content ?? '';
  }

  /**
   * Call the Anthropic API.
   */
  private async callAnthropic(prompt: string): Promise<string> {
    if (!this.config.apiKey) {
      throw new Error('Anthropic provider requires an apiKey');
    }

    const baseUrl = this.config.baseUrl ?? DEFAULT_BASE_URLS.anthropic;
    const model = this.config.model ?? DEFAULT_MODELS.anthropic;

    const response = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
        temperature: this.config.temperature ?? 0.3,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as {
      content: { type: string; text: string }[];
    };

    const textBlock = data.content.find((block) => block.type === 'text');
    return textBlock?.text ?? '';
  }

  /**
   * Build a prompt for refining an existing schema.
   */
  private buildRefinePrompt(schema: PocketSchema, instruction: string): string {
    return `You are an expert database schema designer for the Pocket framework.

The user has an existing Pocket schema and wants to refine it.

## Current Schema

\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`

## Refinement Instruction

${instruction}

## Response Format

Respond with the complete updated schema as a JSON code block, followed by:
1. An "EXPLANATION:" section explaining what changed and why
2. A "SUGGESTIONS:" section with bullet points for further improvements

\`\`\`json
{ "version": "1.0.0", "collections": [...] }
\`\`\`

EXPLANATION:
<your explanation here>

SUGGESTIONS:
- <suggestion 1>
- <suggestion 2>
- <suggestion 3>
`;
  }

  /**
   * Build a prompt for explaining a schema.
   */
  private buildExplainPrompt(schema: PocketSchema): string {
    return `You are an expert database schema designer. Explain the following Pocket database schema in plain English.
Describe each collection, its purpose, key fields, and relationships between collections.
Be concise but thorough.

\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`

Provide your explanation as clear, readable paragraphs.`;
  }

  /**
   * Get a template example for the given app type.
   */
  private getTemplateExample(appType?: string): PocketSchema | undefined {
    if (!appType || appType === 'custom') return SCHEMA_TEMPLATES.todo;
    return SCHEMA_TEMPLATES[appType];
  }

  /**
   * Normalize a parsed schema to ensure required fields are present.
   */
  private normalizeSchema(schema: PocketSchema): PocketSchema {
    if (!schema.version) {
      schema.version = '1.0.0';
    }

    if (!schema.collections) {
      schema.collections = [];
    }

    for (const collection of schema.collections) {
      if (!collection.fields) {
        collection.fields = {};
      }
      collection.timestamps ??= true;
    }

    return schema;
  }

  /**
   * Extract the explanation section from an LLM response.
   */
  private extractExplanation(response: string): string {
    const match = /EXPLANATION:\s*\n?([\s\S]*?)(?=SUGGESTIONS:|$)/i.exec(response);
    return match?.[1]?.trim() ?? 'Schema generated based on the provided description.';
  }

  /**
   * Extract suggestions from an LLM response.
   */
  private extractSuggestions(response: string): string[] {
    const match = /SUGGESTIONS:\s*\n?([\s\S]*?)$/i.exec(response);
    if (!match?.[1]) {
      return ['Review the generated schema and adjust field types as needed.'];
    }

    return match[1]
      .split('\n')
      .map((line) => line.replace(/^[-*•]\s*/, '').trim())
      .filter((line) => line.length > 0);
  }

  /**
   * Estimate confidence based on schema completeness.
   */
  private estimateConfidence(schema: PocketSchema, _request: SchemaGenerationRequest): number {
    let confidence = 0.7;

    // Boost for having collections
    if (schema.collections.length > 0) confidence += 0.05;

    // Boost for descriptions
    const hasDescriptions = schema.collections.every(
      (c) => c.description && Object.values(c.fields).every((f: SchemaField) => f.description)
    );
    if (hasDescriptions) confidence += 0.05;

    // Boost for references between collections
    const hasReferences = schema.collections.some((c) =>
      Object.values(c.fields).some((f: SchemaField) => f.type === 'reference')
    );
    if (hasReferences) confidence += 0.05;

    // Boost for timestamps
    const hasTimestamps = schema.collections.every((c) => c.timestamps);
    if (hasTimestamps) confidence += 0.03;

    // Boost for validation
    const hasValidation = schema.collections.some((c) =>
      Object.values(c.fields).some((f: SchemaField) => f.validation)
    );
    if (hasValidation) confidence += 0.02;

    // Cap at 0.95 for LLM-generated schemas
    return Math.min(confidence, 0.95);
  }
}

/**
 * Factory function to create a new AISchemaGenerator instance.
 *
 * @param config - Configuration for the AI schema generator
 * @returns A configured AISchemaGenerator instance
 *
 * @example
 * ```typescript
 * const generator = createAISchemaGenerator({
 *   provider: 'openai',
 *   apiKey: process.env.OPENAI_API_KEY,
 * });
 * ```
 */
export function createAISchemaGenerator(config: AISchemaGeneratorConfig): AISchemaGenerator {
  return new AISchemaGenerator(config);
}
