import { describe, it, expect } from 'vitest';
import { moduleMenuLabel, nextMenuOverride, type MenuState } from '../src/module-menu';

// 菜单/面板口径对齐（用户反馈「设置不同步」）：菜单标签须反映生效状态——
// compat 自动停用 ⛔、强制开启标注、用户关闭 ☐；面板此前只在此处可见。
describe('moduleMenuLabel（生效状态 → 菜单标签）', () => {
  const mod = { name: 'no-ad', description: '防止叔叔通过广告给自己赚棺材钱' };

  it('默认开启：☑ 前缀', () => {
    expect(moduleMenuLabel(mod, 'on', false)).toBe('☑ no-ad — 防止叔叔通过广告给自己赚棺材钱');
  });

  it('用户关闭：☐ 前缀', () => {
    expect(moduleMenuLabel(mod, 'off', false)).toBe('☐ no-ad — 防止叔叔通过广告给自己赚棺材钱');
  });

  it('被自动停用：⛔ 前缀 + 强制开启提示（勾选语义=force-on）', () => {
    const label = moduleMenuLabel(mod, 'on', true);
    expect(label).toContain('⛔ no-ad');
    expect(label).toContain('已自动停用');
    expect(label).toContain('强制开启');
  });

  it('强制开启：☑ + 标注，压过自动停用显示', () => {
    const label = moduleMenuLabel(mod, 'force-on', true);
    expect(label).toContain('☑ no-ad');
    expect(label).toContain('强制开启');
    expect(label).not.toContain('已自动停用');
  });
});

describe('nextMenuOverride（点击语义：与面板提示一致——自动停用的勾选即强制开启）', () => {
  it('off → on（打开）', () => {
    expect(nextMenuOverride('off', false)).toBe('on');
  });

  it('on 且未被自动停用 → off（关闭）', () => {
    expect(nextMenuOverride('on', false)).toBe('off');
  });

  it('on 且被自动停用 → force-on（强制开启）', () => {
    expect(nextMenuOverride('on', true)).toBe('force-on');
  });

  it('force-on 且被自动停用 → on（恢复自动）', () => {
    expect(nextMenuOverride('force-on', true)).toBe('on');
  });

  it('force-on 但未被自动停用 → off（直接关闭）', () => {
    expect(nextMenuOverride('force-on', false)).toBe('off');
  });
});

describe('readModuleOverrideSync（三值同步读取）', () => {
  // 由实现侧以 GM_getValue 包装，纯逻辑极薄；此处仅钉类型导出存在
  const states: MenuState[] = ['on', 'off', 'force-on'];
  it('MenuState 三值完备', () => {
    expect(states).toHaveLength(3);
  });
});
