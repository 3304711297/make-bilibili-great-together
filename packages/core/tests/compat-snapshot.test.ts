import { describe, it, expect } from 'vitest';
import { createBewlyFamilySnapshot } from '../src/features/compat/snapshot';

function fakeDoc(hosts: { version: string | null; shadowBewlycat: boolean; shadowAvemujica: boolean; noShadowRoot?: boolean }[], docMarkers: { bewlycat: boolean; avemujica: boolean }) {
  const hostEls = hosts.map(h => ({
    getAttribute: (k: string) => (k === 'data-version' ? h.version : null),
    // noShadowRoot=true 时 shadowRoot 为 null：真实宿主可能未 attach（I1 回归面）
    shadowRoot: h.noShadowRoot ? null : {
      querySelector: (sel: string) =>
        ((sel.includes('bewly-auto-exit-listener') || sel.includes('bewly-watch-later-btn')) && h.shadowBewlycat) ||
        (sel.includes('bewly-bottom-comment-style') && h.shadowAvemujica) ? {} : null
    }
  }));
  return {
    querySelectorAll: (sel: string) => (sel.includes('#bewly') ? hostEls : []),
    querySelector: (sel: string) =>
      ((sel.includes('bewly-auto-exit-listener') || sel.includes('bewly-watch-later-btn')) && docMarkers.bewlycat) ||
      (sel.includes('bewly-bottom-comment-style') && docMarkers.avemujica) ? {} : null,
    documentElement: { querySelector: (sel: string) =>
      ((sel.includes('bewly-auto-exit-listener') || sel.includes('bewly-watch-later-btn')) && docMarkers.bewlycat) ||
      (sel.includes('bewly-bottom-comment-style') && docMarkers.avemujica) ? {} : null }
  } as unknown as Document;
}

describe('createBewlyFamilySnapshot（三态契约）', () => {
  it('无宿主→null', () => {
    const snap = createBewlyFamilySnapshot(fakeDoc([], { bewlycat: false, avemujica: false }));
    expect(snap()).toBeNull();
  });

  it('宿主在场+无标记命中→pending-family', () => {
    const snap = createBewlyFamilySnapshot(fakeDoc([{ version: '1.6.9', shadowBewlycat: false, shadowAvemujica: false }], { bewlycat: false, avemujica: false }));
    expect(snap()).toBe('pending-family');
  });

  it('documentElement 级 bewlycat 标记→extensions=[bewlycat] + version', () => {
    const snap = createBewlyFamilySnapshot(fakeDoc([{ version: '1.6.9', shadowBewlycat: false, shadowAvemujica: false }], { bewlycat: true, avemujica: false }));
    expect(snap()).toEqual({ family: 'bewly', extensions: [{ id: 'bewlycat', version: '1.6.9' }], generic: false });
  });

  it('shadowRoot 级标记命中→generic=false', () => {
    const snap = createBewlyFamilySnapshot(fakeDoc([{ version: null, shadowBewlycat: true, shadowAvemujica: false }], { bewlycat: false, avemujica: false }));
    expect(snap()).toEqual({ family: 'bewly', extensions: [{ id: 'bewlycat', version: null }], generic: false });
  });

  it('shadowRoot 为 null 的宿主：shadow 路径不产生假命中（无文档级标记→pending-family；有文档级标记→正常上报）', () => {
    // I1 回归：原实现 `h.shadowRoot?.querySelector(sel) !== null` 在 shadowRoot 为 null 时恒真
    //（optional chaining 得 undefined，undefined !== null 为 true）——无 shadowRoot 宿主会被误归因
    // shadowBewlycat/shadowAvemujica 标志为 true 表示"若 shadowRoot 存在则命中"，用于证明判空修复
    const hosts = [{ version: '1.6.9', shadowBewlycat: true, shadowAvemujica: true, noShadowRoot: true }];
    // 无文档级标记：不得误归因（原实现会因恒真命中报出 bewlycat）
    const noMarker = createBewlyFamilySnapshot(fakeDoc(hosts, { bewlycat: false, avemujica: false }));
    expect(noMarker()).toBe('pending-family');
    // 有文档级 bewlycat 标记：正常上报 bewlycat；且 shadowRoot 路径不产生假命中（avemujica 不因 shadowAvemujica 标志被误报）
    const withMarker = createBewlyFamilySnapshot(fakeDoc(hosts, { bewlycat: true, avemujica: false }), { enableAvemujicaCommentStyleMarker: true });
    expect(withMarker()).toEqual({ family: 'bewly', extensions: [{ id: 'bewlycat', version: '1.6.9' }], generic: false });
  });

  it('双标记同时在场→extensions 顺序固定 bewlycat 在前（配合行序固定裁定）', () => {
    // 裁定（2026-09-01，用户确认）：原 brief 用例 5 未传开关，与 Step 3 契约（
    // #bewly-bottom-comment-style 查询必须在守卫分支内、默认 false）矛盾——
    // 本抽取不复活冒烟已实证的误报，故此用例显式传开关以验证行序
    const snap = createBewlyFamilySnapshot(fakeDoc([{ version: '1.6.9', shadowBewlycat: true, shadowAvemujica: true }], { bewlycat: true, avemujica: true }), { enableAvemujicaCommentStyleMarker: true });
    const r = snap();
    expect(r).toEqual({ family: 'bewly', extensions: [{ id: 'bewlycat', version: '1.6.9' }, { id: 'avemujica', version: null }], generic: false });
  });

  it('仅 avemujica 注释样式标记在场→默认忽略（pending-family）——冒烟裁定：该标记在 BewlyCat 1.6.9 也瞬时注入', () => {
    const snap = createBewlyFamilySnapshot(fakeDoc([{ version: null, shadowBewlycat: false, shadowAvemujica: false }], { bewlycat: false, avemujica: true }));
    expect(snap()).toBe('pending-family');
  });

  it('显式开启 enableAvemujicaCommentStyleMarker 时才上报 avemujica', () => {
    const snap = createBewlyFamilySnapshot(fakeDoc([{ version: null, shadowBewlycat: false, shadowAvemujica: false }], { bewlycat: false, avemujica: true }), { enableAvemujicaCommentStyleMarker: true });
    expect(snap()).toEqual({ family: 'bewly', extensions: [{ id: 'avemujica', version: null }], generic: false });
  });
});
