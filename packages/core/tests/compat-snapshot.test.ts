import { describe, it, expect } from 'vitest';
import { createBewlyFamilySnapshot } from '../src/features/compat/snapshot';

function fakeDoc(hosts: { version: string | null; shadowBewlycat: boolean; shadowAvemujica: boolean; noShadowRoot?: boolean }[], docMarkers: { bewlycat: boolean; avemujica: boolean; activeStory?: boolean; activeFont?: boolean }) {
  const hostEls = hosts.map(h => ({
    getAttribute: (k: string) => (k === 'data-version' ? h.version : null),
    // noShadowRoot=true 时 shadowRoot 为 null：真实宿主可能未 attach（I1 回归面）
    shadowRoot: h.noShadowRoot ? null : {
      querySelector: (sel: string) =>
        ((sel.includes('bewly-auto-exit-listener') || sel.includes('bewly-watch-later-btn') || sel.includes('bewly-dock')) && h.shadowBewlycat) ||
        ((sel.includes('bewly-bottom-comment-style') || sel.includes('ave-mujica')) && h.shadowAvemujica) ? {} : null
    }
  }));
  return {
    querySelectorAll: (sel: string) => (sel.includes('#bewly') ? hostEls : []),
    querySelector: (sel: string) =>
      ((sel.includes('bewly-auto-exit-listener') || sel.includes('bewly-watch-later-btn') || sel.includes('bewly-dock')) && docMarkers.bewlycat) ||
      ((sel.includes('bewly-bottom-comment-style') || sel.includes('ave-mujica')) && docMarkers.avemujica) ? {} : null,
    documentElement: {
      classList: { contains: (cls: string) => cls === 'momentsPage' && !!docMarkers.activeStory },
      querySelector: (sel: string) => {
        if (sel.includes('bewly-font-style') || sel.includes('ave-font-style')) return docMarkers.activeFont ? {} : null;
        return ((sel.includes('bewly-auto-exit-listener') || sel.includes('bewly-watch-later-btn') || sel.includes('bewly-dock')) && docMarkers.bewlycat) ||
          ((sel.includes('bewly-bottom-comment-style') || sel.includes('ave-mujica')) && docMarkers.avemujica) ? {} : null;
      }
    }
  } as unknown as Document;
}

describe('createBewlyFamilySnapshot（三态契约与细粒度状态）', () => {
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
    const r = snap() as any;
    expect(r.family).toBe('bewly');
    expect(r.extensions).toEqual([{ id: 'bewlycat', version: '1.6.9' }]);
    expect(r.generic).toBe(false);
    expect(r.activeFeatures).toBeDefined();
  });

  it('shadowRoot 级标记命中→generic=false', () => {
    const snap = createBewlyFamilySnapshot(fakeDoc([{ version: null, shadowBewlycat: true, shadowAvemujica: false }], { bewlycat: false, avemujica: false }));
    const r = snap() as any;
    expect(r.extensions).toEqual([{ id: 'bewlycat', version: null }]);
    expect(r.generic).toBe(false);
  });

  it('shadowRoot 为 null 的宿主：shadow 路径不产生假命中', () => {
    const hosts = [{ version: '1.6.9', shadowBewlycat: true, shadowAvemujica: true, noShadowRoot: true }];
    const noMarker = createBewlyFamilySnapshot(fakeDoc(hosts, { bewlycat: false, avemujica: false }));
    expect(noMarker()).toBe('pending-family');
    const withMarker = createBewlyFamilySnapshot(fakeDoc(hosts, { bewlycat: true, avemujica: false }), { enableAvemujicaCommentStyleMarker: true });
    const r = withMarker() as any;
    expect(r.extensions).toEqual([{ id: 'bewlycat', version: '1.6.9' }]);
    expect(r.generic).toBe(false);
  });

  it('双标记同时在场→extensions 顺序固定 bewlycat 在前', () => {
    const snap = createBewlyFamilySnapshot(fakeDoc([{ version: '1.6.9', shadowBewlycat: true, shadowAvemujica: true }], { bewlycat: true, avemujica: true }), { enableAvemujicaCommentStyleMarker: true });
    const r = snap() as any;
    expect(r.extensions).toEqual([{ id: 'bewlycat', version: '1.6.9' }, { id: 'avemujica', version: '1.6.9' }]);
    expect(r.generic).toBe(false);
  });

  it('细粒度功能状态探测：activeFeatures 记录 momentsPage 与 font 状态', () => {
    const snap = createBewlyFamilySnapshot(fakeDoc(
      [{ version: '1.7.8', shadowBewlycat: true, shadowAvemujica: false }],
      { bewlycat: true, avemujica: false, activeStory: true, activeFont: true }
    ));
    const r = snap() as any;
    expect(r.activeFeatures['optimize-story']).toBe(true);
    expect(r.activeFeatures['use-system-fonts']).toBe(true);
    expect(r.activeFeatures['player-video-fit']).toBe(false);
  });
});
