# @pocket/forms

Schema-driven forms for Pocket — auto-generate forms from your data models.

## Installation

```bash
pnpm add @pocket/forms
```

## Features

- Generate forms from Pocket schemas with Zod validation
- Form lifecycle management (dirty tracking, submission, reset)
- React hooks for form and field state
- Form event system for custom workflows

## Usage

```typescript
import { createFormManager, createUseFormHook } from '@pocket/forms';
import { z } from '@pocket/forms';

const schema = z.object({ name: z.string(), email: z.string().email() });
const manager = createFormManager({ schema });

// In React
const useForm = createUseFormHook(React);
const { values, errors, submit } = useForm(manager);
```

## API Reference

- `createFormManager` / `FormManager` — Form lifecycle management
- `createUseFormHook` — React hook for form state
- `createUseFieldHook` — React hook for individual field state
- `createUseFormEventsHook` — React hook for form events
- `z` — Re-exported Zod for schema definitions

## License

MIT
