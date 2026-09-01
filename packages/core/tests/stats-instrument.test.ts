// @vitest-environment happy-dom
import { it, expect, beforeAll } from 'vitest';
import { getDefaultModules } from '../src/modules';
import { sessionCounts } from '../src/features/stats/registry';
import { createLogger } from '../src/logger';

const logger = createLogger(console);

beforeAll(() => {
  // 单全局域最小 stub（与 modules.test.ts 同策略，但用 happy-dom 真对象）
  (globalThis as any).unsafeWindow = globalThis;
  (globalThis as any).indexedDB = { databases: async () => [], open: () => ({}) };
  (globalThis as any).MediaSource = class { static isTypeSupported(type: string) { return type.includes('avc'); } };
  (globalThis as any).CSSStyleSheet = class { replaceSync() {} };
});

function spyHook() {
  return {
    addStyle: () => {}, onBeforeFetch: () => {}, onResponse: () => {},
    onXhrOpen: () => {}, onAfterXhrOpen: () => {}, onXhrResponse: () => {},
    onlyCallOnce: (fn: () => void) => fn()
  } as any;
}

it('disable-av1：av01 canPlayType 计入 av1-blocked', () => {
  const before = sessionCounts()['av1-blocked'] ?? 0;
  const mod = getDefaultModules(logger).find(m => m.name === 'disable-av1')!;
  mod.any?.(spyHook());
  expect(document.createElement('video').canPlayType('video/mp4; codecs="av01.0.05M.08"')).toBe('');
  expect(sessionCounts()['av1-blocked']).toBe(before + 1);
});

it('defuse-spyware：sendBeacon 假实现计入 beacon', () => {
  const before = sessionCounts()['beacon'] ?? 0;
  const mod = getDefaultModules(logger).find(m => m.name === 'defuse-spyware')!;
  mod.any?.(spyHook());
  expect((globalThis as any).navigator.sendBeacon('https://data.bilibili.com/x', 'p')).toBe(true);
  expect(sessionCounts()['beacon']).toBe(before + 1);
});

it('no-p2p：替换 URL 计入 p2p-replaced，未改写不计', () => {
  const mod = getDefaultModules(logger).find(m => m.name === 'no-p2p')!;
  mod.any?.(spyHook());
  const before = sessionCounts()['p2p-replaced'] ?? 0;
  // 经 HTMLMediaElement.src setter 注入一个 mcdn 类型 URL（必被改写）
  const v = document.createElement('video');
  v.src = 'https://xy.mcdn.bilivideo.com:4483/v1/resource/41118074799/x/x.m4s?xyz=1';
  expect(sessionCounts()['p2p-replaced']).toBe(before + 1);
});
