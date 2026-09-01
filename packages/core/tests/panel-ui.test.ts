// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { PanelApp, mountFloatingPanel, loadPanelData } from '../src/features/panel/panel';
import { h, render } from 'preact';
import { createMemoryKVStore } from '../src/platform/storage';
import { OVERRIDE_PREFIX } from '../src/platform/storage';

const modules = [
  { name: 'defuse-spyware', description: '反跟踪' },
  { name: 'no-ad', description: '去广告' }
];

describe('loadPanelData', () => {
  it('读 overrides/compat/cdn/stats 并装配', async () => {
    const store = createMemoryKVStore();
    await store.set(`${OVERRIDE_PREFIX}no-ad`, 'off');
    const data = await loadPanelData(store, modules.map(m => m.name));
    expect(data.rows.find(r => r.name === 'no-ad')!.enabled).toBe(false);
    expect(data.cdnProbe).toBe(true);
    expect(data.statsBadge).toBe(false);
  });
});

describe('PanelApp 交互', () => {
  it('点击模块开关写入 override 键（取消→off，恢复→删键回默认）', async () => {
    const store = createMemoryKVStore();
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(h(PanelApp, { store, modules }) as any, container);
    await new Promise(r => setTimeout(r, 10)); // 等异步 load
    // 取消勾选 → 'off'
    const checkbox = container.querySelector<HTMLInputElement>('input[data-module="defuse-spyware"]')!;
    checkbox.click();
    await new Promise(r => setTimeout(r, 10));
    expect(await store.get(`${OVERRIDE_PREFIX}defuse-spyware`)).toBe('off');
    // reload 后重查节点（rerender 可能复用或重建节点），再勾选 → 无 autoDisabled/force 历史 → 删键回默认
    const checkbox2 = container.querySelector<HTMLInputElement>('input[data-module="defuse-spyware"]')!;
    checkbox2.click();
    await new Promise(r => setTimeout(r, 10));
    expect(await store.get(`${OVERRIDE_PREFIX}defuse-spyware`)).toBe(undefined);
  });
});

describe('mountFloatingPanel', () => {
  it('入口胶囊存在且不抛错（降级原则）', () => {
    mountFloatingPanel({ store: createMemoryKVStore(), modules });
    expect(document.getElementById('mbgt-panel-chip')).not.toBe(null);
  });
});
