import { describe, expect, it } from 'vitest';
import {
  createEmbeddedRunner,
  createTutorialEngine,
  decodePlaygroundState,
  encodePlaygroundState,
  extractExamples,
  generateShareableUrl,
  parseShareableUrl,
} from '../index.js';

describe('extractExamples', () => {
  it('should extract TypeScript code blocks', () => {
    const md = `# Example
\`\`\`typescript
const x = 1;
console.log(x);
\`\`\`
`;
    const examples = extractExamples(md);
    expect(examples).toHaveLength(1);
    expect(examples[0]!.code).toContain('const x = 1');
    expect(examples[0]!.language).toBe('typescript');
  });

  it('should skip blocks with no-run marker', () => {
    const md = `<!-- no-run -->
\`\`\`typescript
const x = 1;
\`\`\`
`;
    const examples = extractExamples(md);
    expect(examples).toHaveLength(0);
  });

  it('should extract multiple examples', () => {
    const md = `
\`\`\`typescript
const a = 1;
\`\`\`

\`\`\`ts
const b = 2;
\`\`\`
`;
    const examples = extractExamples(md);
    expect(examples).toHaveLength(2);
  });

  it('should include line numbers', () => {
    const md = `Line 1
Line 2
\`\`\`typescript
code here
\`\`\`
`;
    const examples = extractExamples(md);
    expect(examples[0]!.sourceLine).toBe(3);
  });
});

describe('EmbeddedRunner', () => {
  it('should run an example successfully', async () => {
    const runner = createEmbeddedRunner({
      executor: async (code) => ({ output: `Ran: ${code.length} chars` }),
    });

    const result = await runner.run({
      id: 'test-1',
      title: 'Test',
      code: 'console.log("hello")',
      language: 'typescript',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Ran:');
  });

  it('should handle execution errors', async () => {
    const runner = createEmbeddedRunner({
      executor: async () => ({ output: '', error: 'SyntaxError' }),
    });

    const result = await runner.run({
      id: 'err',
      title: 'Error',
      code: 'bad code',
      language: 'typescript',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('SyntaxError');
  });

  it('should handle timeouts', async () => {
    const runner = createEmbeddedRunner({
      executor: () => new Promise(() => {}), // never resolves
      timeoutMs: 50,
    });

    const result = await runner.run({
      id: 'timeout',
      title: 'Timeout',
      code: 'while(true){}',
      language: 'typescript',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('timeout');
  });

  it('should run all examples', async () => {
    const runner = createEmbeddedRunner({
      executor: async (code) => ({ output: code }),
    });

    const results = await runner.runAll([
      { id: 'a', title: 'A', code: 'aaa', language: 'typescript' },
      { id: 'b', title: 'B', code: 'bbb', language: 'typescript' },
    ]);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
  });
});

describe('Shareable URL', () => {
  it('should encode and decode state', () => {
    const state = {
      code: 'console.log("hello")',
      language: 'typescript' as const,
      autoRun: true,
    };

    const encoded = encodePlaygroundState(state);
    const decoded = decodePlaygroundState(encoded);

    expect(decoded.valid).toBe(true);
    expect(decoded.code).toBe(state.code);
    expect(decoded.autoRun).toBe(true);
  });

  it('should generate full URLs', () => {
    const url = generateShareableUrl('https://play.pocket-db.dev', {
      code: 'const db = createDatabase()',
    });

    expect(url).toContain('https://play.pocket-db.dev#');
    const parsed = parseShareableUrl(url);
    expect(parsed.valid).toBe(true);
    expect(parsed.code).toBe('const db = createDatabase()');
  });

  it('should handle invalid URLs', () => {
    const result = parseShareableUrl('https://example.com');
    expect(result.valid).toBe(false);
  });

  it('should handle invalid hash', () => {
    const result = parseShareableUrl('https://example.com#not-valid-base64!!!');
    expect(result.valid).toBe(false);
  });
});

describe('TutorialEngine', () => {
  const sampleTutorial = {
    id: 'getting-started',
    title: 'Getting Started',
    description: 'Learn the basics',
    difficulty: 'beginner' as const,
    estimatedMinutes: 5,
    steps: [
      {
        id: 'step-1',
        title: 'Create a Database',
        description: 'Create your first database',
        starterCode: '// Create a database here',
        hints: ['Use createDatabase()', 'Pass a name option'],
        validate: (output: string) => output.includes('created'),
        solution: 'const db = createDatabase({ name: "test" })',
      },
      {
        id: 'step-2',
        title: 'Insert a Document',
        description: 'Insert your first document',
        starterCode: '// Insert here',
        hints: ['Use collection.insert()'],
        validate: (output: string) => output.includes('inserted'),
      },
    ],
  };

  it('should register and list tutorials', () => {
    const engine = createTutorialEngine();
    engine.addTutorial(sampleTutorial);
    expect(engine.listTutorials()).toHaveLength(1);
  });

  it('should start a tutorial', () => {
    const engine = createTutorialEngine();
    engine.addTutorial(sampleTutorial);

    const step = engine.start('getting-started');
    expect(step?.title).toBe('Create a Database');
  });

  it('should validate and advance steps', () => {
    const engine = createTutorialEngine();
    engine.addTutorial(sampleTutorial);
    engine.start('getting-started');

    const fail = engine.validateStep('getting-started', 'wrong output');
    expect(fail.passed).toBe(false);

    const pass = engine.validateStep('getting-started', 'database created');
    expect(pass.passed).toBe(true);
    expect(pass.nextStep?.title).toBe('Insert a Document');
    expect(pass.completed).toBe(false);
  });

  it('should complete tutorial when all steps pass', () => {
    const engine = createTutorialEngine();
    engine.addTutorial(sampleTutorial);
    engine.start('getting-started');

    engine.validateStep('getting-started', 'created');
    const result = engine.validateStep('getting-started', 'inserted');
    expect(result.completed).toBe(true);
  });

  it('should provide hints progressively', () => {
    const engine = createTutorialEngine();
    engine.addTutorial(sampleTutorial);
    engine.start('getting-started');

    expect(engine.getHint('getting-started')).toBe('Use createDatabase()');
    expect(engine.getHint('getting-started')).toBe('Pass a name option');
    expect(engine.getHint('getting-started')).toBeUndefined(); // no more hints
  });

  it('should track progress', () => {
    const engine = createTutorialEngine();
    engine.addTutorial(sampleTutorial);
    engine.start('getting-started');
    engine.validateStep('getting-started', 'created');

    const progress = engine.getProgress('getting-started');
    expect(progress?.completedSteps).toEqual(['step-1']);
    expect(progress?.currentStepIndex).toBe(1);
  });

  it('should reset progress', () => {
    const engine = createTutorialEngine();
    engine.addTutorial(sampleTutorial);
    engine.start('getting-started');
    engine.reset('getting-started');
    expect(engine.getProgress('getting-started')).toBeUndefined();
  });
});
