// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
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

// options 形态：挂载壳直渲染 PanelApp（无浮层容器/无 PANEL_STYLE），锁定模块复选框禁用
describe('PanelApp options 形态', () => {
  it('直接渲染进页面容器：locked 模块禁用不可关，deferred 模块可切换', async () => {
    const store = createMemoryKVStore();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const optionsModules = [
      { name: 'defuse-spyware', description: '反跟踪', locked: true },
      { name: 'no-ad', description: '去广告' }
    ];
    render(h(PanelApp, { store, modules: optionsModules }) as any, container);
    await new Promise(r => setTimeout(r, 10)); // 等异步 load
    const locked = container.querySelector<HTMLInputElement>('input[data-module="defuse-spyware"]')!;
    expect(locked.disabled).toBe(true);
    const deferred = container.querySelector<HTMLInputElement>('input[data-module="no-ad"]')!;
    expect(deferred.disabled).toBe(false);
    deferred.click();
    await new Promise(r => setTimeout(r, 10));
    expect(await store.get(`${OVERRIDE_PREFIX}no-ad`)).toBe('off');
  });
});

describe('mountFloatingPanel', () => {
  it('入口胶囊存在且不抛错（降级原则）', () => {
    mountFloatingPanel({ store: createMemoryKVStore(), modules });
    expect(document.getElementById('mbgt-panel-chip')).not.toBe(null);
  });
});

describe('面板 2s 轮询（Plan 5）', () => {
  it('打开期间每 2s 刷新；关闭后停止；读失败保留旧数据', async () => {
    vi.useFakeTimers();
    const store = createMemoryKVStore();
    const container = document.createElement('div');
    document.body.appendChild(container);
    let gets = 0;
    const origGet = store.get.bind(store);
    (store as any).get = async (k: string) => { gets++; return origGet(k); };
    render(h(PanelApp, { store, modules }) as any, container);
    const loadOnce = () => gets; // 一次 loadPanelData = 7 次 get
    await vi.advanceTimersByTimeAsync(20);
    const afterOpen = loadOnce();
    expect(afterOpen).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(2_100);
    const afterTick1 = loadOnce();
    expect(afterTick1).toBeGreaterThan(afterOpen); // 2s 后自动刷新
    // 读失败：get 抛错后 UI 保留旧数据（不清空），下一轮继续
    (store as any).get = async () => { throw new Error('boom'); };
    await vi.advanceTimersByTimeAsync(2_100);
    expect(container.textContent).toContain('模块开关');
    // 关闭：render(null) 卸载 → cleanup 停止轮询（数值快照断言，非函数引用）
    const frozenCount = gets;
    render(null as any, container);
    (store as any).get = async (k: string) => { gets++; return origGet(k); };
    await vi.advanceTimersByTimeAsync(6_000);
    expect(gets).toBe(frozenCount); // 关闭后零调用
    vi.useRealTimers();
  });
});
