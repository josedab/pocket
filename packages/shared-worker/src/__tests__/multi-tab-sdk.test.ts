import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { createMultiTabSDK } from '../multi-tab-sdk.js';
import type { MultiTabSDK } from '../multi-tab-sdk.js';

describe('MultiTabSDK', () => {
  let sdk: MultiTabSDK;

  afterEach(() => {
    sdk?.stop();
    vi.useRealTimers();
  });

  describe('creation', () => {
    it('should create with auto-generated tabId', () => {
      sdk = createMultiTabSDK();
      expect(sdk).toBeDefined();
      expect(sdk.getStatus()).toBe('stopped');
    });

    it('should create with explicit tabId', () => {
      sdk = createMultiTabSDK({ tabId: 'my-tab' });
      expect(sdk).toBeDefined();
      expect(sdk.getStatus()).toBe('stopped');
    });
  });

  describe('start/stop lifecycle', () => {
    it('should transition from stopped to running on start', () => {
      sdk = createMultiTabSDK({ tabId: 'lifecycle-tab' });
      expect(sdk.getStatus()).toBe('stopped');

      sdk.start();
      expect(sdk.getStatus()).toBe('running');
    });

    it('should transition from running to stopped on stop', () => {
      sdk = createMultiTabSDK({ tabId: 'lifecycle-tab-2' });
      sdk.start();
      expect(sdk.getStatus()).toBe('running');

      sdk.stop();
      expect(sdk.getStatus()).toBe('stopped');
    });

    it('should be idempotent when calling start multiple times', () => {
      sdk = createMultiTabSDK({ tabId: 'idempotent-tab' });
      sdk.start();
      sdk.start();
      expect(sdk.getStatus()).toBe('running');
    });

    it('should be idempotent when calling stop multiple times', () => {
      sdk = createMultiTabSDK({ tabId: 'idempotent-stop-tab' });
      sdk.start();
      sdk.stop();
      sdk.stop();
      expect(sdk.getStatus()).toBe('stopped');
    });
  });

  describe('status tracking', () => {
    it('should report stopped initially', () => {
      sdk = createMultiTabSDK();
      expect(sdk.getStatus()).toBe('stopped');
    });

    it('should report running after start', () => {
      sdk = createMultiTabSDK();
      sdk.start();
      expect(sdk.getStatus()).toBe('running');
    });

    it('should report stopped after stop', () => {
      sdk = createMultiTabSDK();
      sdk.start();
      sdk.stop();
      expect(sdk.getStatus()).toBe('stopped');
    });
  });

  describe('leader election defaults', () => {
    it('should enable leader election by default', async () => {
      sdk = createMultiTabSDK({ tabId: 'leader-default' });
      sdk.start();

      const isLeader = await firstValueFrom(sdk.isLeader$);
      expect(typeof isLeader).toBe('boolean');
    });

    it('should expose isLeader$ observable when leader election is disabled', async () => {
      sdk = createMultiTabSDK({ tabId: 'no-leader', enableLeaderElection: false });
      sdk.start();

      const isLeader = await firstValueFrom(sdk.isLeader$);
      expect(isLeader).toBe(false);
    });
  });

  describe('tab tracking', () => {
    it('should expose tabs$ observable', async () => {
      sdk = createMultiTabSDK({ tabId: 'tab-tracking' });
      sdk.start();

      const tabs = await firstValueFrom(sdk.tabs$);
      expect(Array.isArray(tabs)).toBe(true);
    });

    it('should return empty tabs when leader election is disabled', async () => {
      sdk = createMultiTabSDK({ tabId: 'no-tabs', enableLeaderElection: false });
      sdk.start();

      const tabs = await firstValueFrom(sdk.tabs$);
      expect(tabs).toEqual([]);
    });
  });

  describe('messaging', () => {
    it('should allow registering and unregistering message handlers', () => {
      sdk = createMultiTabSDK({ tabId: 'msg-tab' });
      sdk.start();

      const unsub = sdk.onMessage(() => {});
      expect(typeof unsub).toBe('function');
      unsub();
    });

    it('should allow broadcasting messages', () => {
      sdk = createMultiTabSDK({ tabId: 'broadcast-tab' });
      sdk.start();

      expect(() => {
        sdk.broadcastMessage({
          type: 'heartbeat',
          senderId: 'broadcast-tab',
          payload: {},
        });
      }).not.toThrow();
    });
  });
});
