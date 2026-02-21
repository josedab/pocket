# @pocket/ai-agent

Local AI agent framework for Pocket with tool-calling, RAG, and streaming responses.

## Installation

```bash
pnpm add @pocket/ai-agent
```

## Features

- Create AI agents with tool-calling capabilities
- Conversation memory management
- Database-aware tools for querying and mutating Pocket data
- Custom tool registry for extensible agent behaviors
- Data transformation tools
- Execution planning and multi-step workflows

## Usage

```typescript
import { createAgent, createDatabaseTools, createToolRegistry } from '@pocket/ai-agent';

const tools = createToolRegistry();
tools.register(createDatabaseTools(db));

const agent = createAgent({ tools });
const response = await agent.run('Find all users created today');
```

## API Reference

- `createAgent` — Create an AI agent instance
- `createConversationMemory` — Manage conversation context
- `createDatabaseTools` — Database query/mutation tools
- `createToolRegistry` — Register custom tools
- `createDataTransformationTools` — Data transformation utilities
- `createExecutionPlanner` — Multi-step execution planning

## License

MIT
