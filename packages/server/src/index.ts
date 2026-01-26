/**
 * @packageDocumentation
 *
 * Server-side sync infrastructure for Pocket.
 *
 * This package provides the building blocks for running a Pocket sync server.
 * It handles WebSocket connections, message routing, conflict resolution,
 * and real-time change broadcasting to connected clients.
 *
 * ## Installation
 *
 * ```bash
 * npm install @pocket/server
 * ```
 *
 * ## Quick Start
 *
 * ```typescript
 * import { createServer } from '@pocket/server';
 *
 * const server = createServer({
 *   port: 8080,
 *   authenticate: async (token) => {
 *     // Verify JWT or API key
 *     const user = await verifyToken(token);
 *     return user ? { userId: user.id } : null;
 *   }
 * });
 *
 * await server.start();
 * console.log('Pocket sync server running on port 8080');
 * ```
 *
 * ## Features
 *
 * - **WebSocket Protocol**: Real-time bidirectional sync over WebSocket
 * - **Authentication**: Pluggable auth with JWT/API key support
 * - **Conflict Resolution**: Configurable strategies (last-write-wins, merge, custom)
 * - **Multi-tenant**: Support for multiple users with connection limits
 * - **Broadcasting**: Automatic change propagation to interested clients
 * - **Change Log**: Persistent change history for sync catch-up
 *
 * ## Architecture
 *
 * ```
 * ┌─────────────────────────────────────┐
 * │           PocketServer              │
 * │  ├── WebSocketServer (ws)           │
 * │  ├── ClientManager                  │
 * │  │   ├── Track connected clients    │
 * │  │   ├── User/collection indexing   │
 * │  │   └── Timeout management         │
 * │  ├── ChangeLog                      │
 * │  │   ├── Append changes             │
 * │  │   ├── Query by sequence          │
 * │  │   └── Compaction                 │
 * │  └── ConflictResolver               │
 * │      └── Resolve push conflicts     │
 * └─────────────────────────────────────┘
 * ```
 *
 * ## Components
 *
 * - {@link PocketServer}: Main server class handling connections and protocol
 * - {@link ClientManager}: Tracks connected clients and their subscriptions
 * - {@link ChangeLog}: Interface for persisting sync changes (with memory impl)
 *
 * ## Production Considerations
 *
 * For production deployments:
 *
 * - **Persistence**: Implement a custom {@link ChangeLog} backed by a database
 * - **Scaling**: Use Redis or similar for cross-server client coordination
 * - **Security**: Always enable authentication in production
 * - **Monitoring**: Add logging and metrics for observability
 *
 * @module @pocket/server
 *
 * @see {@link PocketServer} for the main server class
 * @see {@link createServer} for the factory function
 */
export * from './change-log.js';
export * from './client-manager.js';
export * from './server.js';
