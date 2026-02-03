/**
 * Transport layer for sync communication.
 *
 * This module provides different transport implementations for
 * communicating with the sync server:
 *
 * - {@link WebSocketTransport}: Real-time bidirectional sync (default)
 * - {@link HttpTransport}: HTTP polling fallback for constrained environments
 *
 * Both transports implement the {@link SyncTransport} interface,
 * making them interchangeable.
 *
 * @module sync/transport
 *
 * @example Using WebSocket transport (default)
 * ```typescript
 * const transport = createWebSocketTransport({
 *   serverUrl: 'wss://sync.example.com',
 *   authToken: 'user-token'
 * });
 *
 * await transport.connect();
 *
 * const response = await transport.send<PushResponseMessage>({
 *   type: 'push',
 *   id: generateMessageId(),
 *   ...
 * });
 * ```
 *
 * @example Using HTTP transport
 * ```typescript
 * const transport = createHttpTransport({
 *   serverUrl: 'https://api.example.com/sync',
 *   authToken: 'user-token',
 *   timeout: 30000
 * });
 *
 * await transport.connect();
 * ```
 *
 * @see {@link SyncTransport} for the transport interface
 * @see {@link TransportConfig} for configuration options
 */
export * from './http.js';
export * from './types.js';
export * from './websocket.js';
export * from './webrtc.js';
export * from './lan-discovery.js';
export * from './mesh-coordinator.js';
