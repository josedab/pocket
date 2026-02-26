/**
 * Embedded Documentation Runner — makes code examples in docs interactive.
 *
 * Parses markdown code blocks, wraps them in an executable context,
 * and provides a "Run" button experience for documentation pages.
 */

/** A runnable code example extracted from documentation. */
export interface DocExample {
  readonly id: string;
  readonly title: string;
  readonly code: string;
  readonly language: 'typescript' | 'javascript';
  readonly description?: string;
  /** Line number in the source markdown. */
  readonly sourceLine?: number;
}

/** Result of running a doc example. */
export interface DocExampleResult {
  readonly exampleId: string;
  readonly success: boolean;
  readonly output: string;
  readonly error?: string;
  readonly durationMs: number;
}

/** Configuration for the embedded runner. */
export interface EmbeddedRunnerConfig {
  /** Function to execute code in a sandboxed context. */
  readonly executor: (code: string) => Promise<{ output: string; error?: string }>;
  /** Maximum execution time in ms. Defaults to 5000. */
  readonly timeoutMs?: number;
}

/**
 * Extract runnable code examples from markdown content.
 *
 * Looks for fenced code blocks marked with ```typescript or ```ts
 * that are not preceded by a "<!-- no-run -->" comment.
 */
export function extractExamples(markdown: string): DocExample[] {
  const examples: DocExample[] = [];
  const codeBlockRegex = /```(?:typescript|ts|javascript|js)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = codeBlockRegex.exec(markdown)) !== null) {
    // Check for no-run marker
    const precedingText = markdown.slice(Math.max(0, match.index - 50), match.index);
    if (precedingText.includes('<!-- no-run -->')) continue;

    const code = match[1]?.trim() ?? '';
    if (code.length === 0) continue;

    const lineNumber = markdown.slice(0, match.index).split('\n').length;

    // Try to extract a title from the preceding heading
    const headingMatch = /#+\s+(.+?)$/m.exec(precedingText);
    const title = headingMatch?.[1]?.trim() ?? `Example ${index + 1}`;

    const lang =
      match[0].startsWith('```typescript') || match[0].startsWith('```ts')
        ? ('typescript' as const)
        : ('javascript' as const);

    examples.push({
      id: `doc-example-${index++}`,
      title,
      code,
      language: lang,
      sourceLine: lineNumber,
    });
  }

  return examples;
}

/** The embedded documentation runner. */
export class EmbeddedRunner {
  private readonly config: Required<EmbeddedRunnerConfig>;
  private readonly results = new Map<string, DocExampleResult>();

  constructor(config: EmbeddedRunnerConfig) {
    this.config = {
      executor: config.executor,
      timeoutMs: config.timeoutMs ?? 5000,
    };
  }

  /** Run a single example. */
  async run(example: DocExample): Promise<DocExampleResult> {
    const start = performance.now();

    try {
      const result = await Promise.race([
        this.config.executor(example.code),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Execution timeout')), this.config.timeoutMs)
        ),
      ]);

      const docResult: DocExampleResult = {
        exampleId: example.id,
        success: !result.error,
        output: result.output,
        error: result.error,
        durationMs: performance.now() - start,
      };

      this.results.set(example.id, docResult);
      return docResult;
    } catch (err) {
      const docResult: DocExampleResult = {
        exampleId: example.id,
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
        durationMs: performance.now() - start,
      };
      this.results.set(example.id, docResult);
      return docResult;
    }
  }

  /** Run all examples and return results. */
  async runAll(examples: DocExample[]): Promise<DocExampleResult[]> {
    const results: DocExampleResult[] = [];
    for (const example of examples) {
      results.push(await this.run(example));
    }
    return results;
  }

  /** Get cached result for an example. */
  getResult(exampleId: string): DocExampleResult | undefined {
    return this.results.get(exampleId);
  }

  /** Clear cached results. */
  clearResults(): void {
    this.results.clear();
  }
}

export function createEmbeddedRunner(config: EmbeddedRunnerConfig): EmbeddedRunner {
  return new EmbeddedRunner(config);
}
