# @pocket/compliance

Compliance automation (GDPR, HIPAA, SOC 2) for Pocket local-first database.

## Installation

```bash
pnpm add @pocket/compliance
```

## Features

- GDPR data management (consent, data export, right to erasure)
- Audit trail logging for compliance evidence
- Data retention policies with automatic enforcement
- Compliance reporting and documentation generation

## Usage

```typescript
import { createGDPRManager, createRetentionEngine } from '@pocket/compliance';

const gdpr = createGDPRManager(db);
await gdpr.exportUserData(userId);
await gdpr.eraseUserData(userId);

const retention = createRetentionEngine(db);
await retention.enforceRetentionPolicies();
```

## API Reference

- `createGDPRManager` / `GDPRManager` — GDPR operations (export, erasure, consent)
- `createRetentionEngine` / `RetentionEngine` — Data retention policy enforcement
- `createComplianceReporter` / `ComplianceReporter` — Generate compliance reports
- `DEFAULT_COMPLIANCE_CONFIG` — Default configuration

## License

MIT
