import { firstValueFrom, skip } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DashboardController, createDashboardController } from '../dashboard-controller.js';

describe('DashboardController', () => {
  let controller: DashboardController;

  beforeEach(() => {
    controller = createDashboardController({ refreshIntervalMs: 60000 });
  });

  afterEach(() => {
    controller.destroy();
  });

  it('should initialize with default panels', () => {
    const state = controller.state;
    expect(state.panels.length).toBeGreaterThan(0);
    expect(state.theme).toBe('system');
    expect(state.sidebarOpen).toBe(true);
  });

  it('should set active panel', () => {
    controller.dispatch({ type: 'set-active', payload: 'query' });
    expect(controller.state.activePanel).toBe('query');
  });

  it('should toggle panel visibility', () => {
    const syncPanel = controller.state.panels.find((p) => p.id === 'sync');
    expect(syncPanel?.visible).toBe(false);

    controller.dispatch({ type: 'toggle-panel', payload: 'sync' });
    const updated = controller.state.panels.find((p) => p.id === 'sync');
    expect(updated?.visible).toBe(true);
  });

  it('should change theme', () => {
    controller.dispatch({ type: 'set-theme', payload: 'dark' });
    expect(controller.state.theme).toBe('dark');
  });

  it('should toggle sidebar', () => {
    controller.dispatch({ type: 'toggle-sidebar' });
    expect(controller.state.sidebarOpen).toBe(false);

    controller.dispatch({ type: 'toggle-sidebar' });
    expect(controller.state.sidebarOpen).toBe(true);
  });

  it('should add notifications', () => {
    const id = controller.notify('info', 'Test', 'Test message');
    expect(id).toBeTruthy();
    expect(controller.state.notifications.length).toBe(1);
    expect(controller.state.notifications[0]!.title).toBe('Test');
  });

  it('should dismiss notifications', () => {
    const id = controller.notify('error', 'Error', 'Something broke');
    controller.dispatch({ type: 'dismiss-notification', payload: id });
    expect(controller.state.notifications[0]!.dismissed).toBe(true);
  });

  it('should clear all notifications', () => {
    controller.notify('info', 'A', 'msg');
    controller.notify('info', 'B', 'msg');
    controller.dispatch({ type: 'clear-notifications' });
    expect(controller.state.notifications.length).toBe(0);
  });

  it('should update stats', () => {
    controller.updateStats({ totalCollections: 5, totalDocuments: 1200 });
    expect(controller.state.stats.totalCollections).toBe(5);
    expect(controller.state.stats.totalDocuments).toBe(1200);
  });

  it('should add custom panels', () => {
    controller.dispatch({
      type: 'add-panel',
      payload: {
        id: 'custom',
        title: 'Custom',
        type: 'custom',
        visible: true,
        position: { x: 0, y: 0, width: 200, height: 200 },
      },
    });
    expect(controller.getPanel('custom')).toBeDefined();
  });

  it('should remove panels', () => {
    controller.dispatch({ type: 'remove-panel', payload: 'schema' });
    expect(controller.getPanel('schema')).toBeUndefined();
  });

  it('should emit state updates via state$', async () => {
    const statePromise = firstValueFrom(controller.state$.pipe(skip(1)));
    controller.dispatch({ type: 'set-theme', payload: 'light' });
    const state = await statePromise;
    expect(state.theme).toBe('light');
  });
});
