import { describe, expect, it } from 'vitest';
import { generateReactPanelApp, getReactPanelFileCount } from '../react-panel-renderer.js';

describe('ReactPanelRenderer', () => {
  it('should generate all default panel files', () => {
    const files = generateReactPanelApp();
    // 6 tabs + App + TabBar + index + styles = 10
    expect(files.length).toBe(10);
  });

  it('should generate App.tsx with all tabs', () => {
    const files = generateReactPanelApp();
    const app = files.find((f) => f.path === 'src/App.tsx');
    expect(app).toBeDefined();
    expect(app!.content).toContain('InspectorPanel');
    expect(app!.content).toContain('PlaygroundPanel');
    expect(app!.content).toContain('SyncPanel');
    expect(app!.content).toContain('activeTab');
  });

  it('should generate TabBar component', () => {
    const files = generateReactPanelApp();
    const tabBar = files.find((f) => f.path === 'src/TabBar.tsx');
    expect(tabBar).toBeDefined();
    expect(tabBar!.content).toContain('tab-bar');
    expect(tabBar!.content).toContain('onTabChange');
  });

  it('should generate individual tab components', () => {
    const files = generateReactPanelApp();
    const inspector = files.find((f) => f.path === 'src/inspector-panel.tsx');
    expect(inspector).toBeDefined();
    expect(inspector!.content).toContain('InspectorPanel');
    expect(inspector!.content).toContain('bridge');
  });

  it('should generate index.tsx with mount script', () => {
    const files = generateReactPanelApp();
    const index = files.find((f) => f.path === 'src/index.tsx');
    expect(index).toBeDefined();
    expect(index!.content).toContain('ReactDOM');
    expect(index!.content).toContain('createRoot');
  });

  it('should generate stylesheet with dark mode support', () => {
    const files = generateReactPanelApp();
    const styles = files.find((f) => f.path === 'src/styles.css');
    expect(styles).toBeDefined();
    expect(styles!.content).toContain('.theme-dark');
    expect(styles!.content).toContain('--accent');
  });

  it('should support custom tabs', () => {
    const files = generateReactPanelApp({
      tabs: [{ id: 'custom', label: 'My Tab', component: 'MyTabPanel' }],
    });
    // 1 tab + App + TabBar + index + styles = 5
    expect(files.length).toBe(5);
    const customTab = files.find((f) => f.path === 'src/custom-panel.tsx');
    expect(customTab).toBeDefined();
    expect(customTab!.content).toContain('MyTabPanel');
  });

  it('should support custom CSS injection', () => {
    const files = generateReactPanelApp({ customCSS: '.my-class { color: red; }' });
    const styles = files.find((f) => f.path === 'src/styles.css');
    expect(styles!.content).toContain('.my-class { color: red; }');
  });

  it('should report correct file count', () => {
    expect(getReactPanelFileCount()).toBe(10);
    expect(getReactPanelFileCount({ tabs: [{ id: 'a', label: 'A', component: 'A' }] })).toBe(5);
  });
});
