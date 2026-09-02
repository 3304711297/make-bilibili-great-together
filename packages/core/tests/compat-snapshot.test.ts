import { describe, it, expect } from 'vitest';
import { createBewlyFamilySnapshot } from '../src/features/compat/snapshot';

function fakeDoc(
  hosts: { version: string | null; shadowBewlycat?: boolean; shadowAvemujica?: boolean; noShadowRoot?: boolean }[],
  docMarkers: { bewlycat?: boolean; avemujica?: boolean; activeStory?: boolean; activeFont?: boolean; aveLogo?: boolean; keleusLink?: boolean }
) {
  const hostEls = hosts.map(h => ({
    getAttribute: (k: string) => (k === 'data-version' ? h.version : null),
    // noShadowRoot=true 时 shadowRoot 为 null：真实宿主可能未 attach（I1 回归面）
    shadowRoot: h.noShadowRoot ? null : {
      querySelector: (sel: string) =>
        ((sel.includes('bewly-auto-exit-listener') || sel.includes('bewly-watch-later-btn') || sel.includes('bewly-dock') || sel.includes('keleus')) && h.shadowBewlycat) ||
        ((sel.includes('bewly-bottom-comment-style') || sel.includes('ave-mujica') || sel.includes('bewly-ave-mujica') || sel.includes('VentusUta')) && h.shadowAvemujica) ? {} : null
    }
  }));
  return {
    querySelectorAll: (sel: string) => (sel.includes('#bewly') ? hostEls : []),
    querySelector: (sel: string) =>
      ((sel.includes('bewly-auto-exit-listener') || sel.includes('bewly-watch-later-btn') || sel.includes('bewly-dock')) && docMarkers.bewlycat) ||
      (sel.includes('keleus') && docMarkers.keleusLink) ||
      (sel.includes('bewly-ave-mujica') && docMarkers.aveLogo) ||
      ((sel.includes('bewly-bottom-comment-style') || sel.includes('ave-mujica') || sel.includes('VentusUta')) && docMarkers.avemujica) ? {} : null,
    documentElement: {
      classList: { contains: (cls: string) => cls === 'momentsPage' && !!docMarkers.activeStory },
      querySelector: (sel: string) => {
        if (sel.includes('bewly-font-style') || sel.includes('ave-font-style')) return docMarkers.activeFont ? {} : null;
        if (sel.includes('bewly-ave-mujica')) return docMarkers.aveLogo ? {} : null;
        if (sel.includes('keleus')) return docMarkers.keleusLink ? {} : null;
        return ((sel.includes('bewly-auto-exit-listener') || sel.includes('bewly-watch-later-btn') || sel.includes('bewly-dock')) && docMarkers.bewlycat) ||
          ((sel.includes('bewly-bottom-comment-style') || sel.includes('ave-mujica') || sel.includes('VentusUta')) && docMarkers.avemujica) ? {} : null;
      }
    }
  } as unknown as Document;
}

describe('createBewlyFamilySnapshot（三态契约与高精度指纹）', () => {
  it('无宿主→null', () => {
    const snap = createBewlyFamilySnapshot(fakeDoc([], { bewlycat: false, avemujica: false }));
    expect(snap()).toBeNull();
  });

  it('宿主在场+未知版本+无标记命中→pending-family', () => {
    const snap = createBewlyFamilySnapshot(fakeDoc([{ version: null, shadowBewlycat: false, shadowAvemujica: false }], { bewlycat: false, avemujica: false }));
    expect(snap()).toBe('pending-family');
  });

  it('documentElement 级 bewlycat 标记→extensions=[bewlycat] + version', () => {
    const snap = createBewlyFamilySnapshot(fakeDoc([{ version: '1.7.8', shadowBewlycat: false, shadowAvemujica: false }], { bewlycat: true, avemujica: false }));
    const r = snap() as any;
    expect(r.family).toBe('bewly');
    expect(r.extensions).toEqual([{ id: 'bewlycat', version: '1.7.8' }]);
    expect(r.generic).toBe(false);
    expect(r.activeFeatures).toBeDefined();
  });

  it('通过专属 WAR Logo 路径精准识别 AveMujica', () => {
    const snap = createBewlyFamilySnapshot(fakeDoc([{ version: '1.8.32', shadowBewlycat: false, shadowAvemujica: false }], { aveLogo: true }));
    const r = snap() as any;
    expect(r.extensions).toEqual([{ id: 'avemujica', version: '1.8.32' }]);
    expect(r.generic).toBe(false);
  });

  it('通过专属 GitHub 仓库链接精准识别 BewlyCat', () => {
    const snap = createBewlyFamilySnapshot(fakeDoc([{ version: '1.7.8', shadowBewlycat: false, shadowAvemujica: false }], { keleusLink: true }));
    const r = snap() as any;
    expect(r.extensions).toEqual([{ id: 'bewlycat', version: '1.7.8' }]);
    expect(r.generic).toBe(false);
  });

  it('通过版本号前缀启发式识别：1.8.x 归为 AveMujica，1.7.x 归为 BewlyCat', () => {
    const snapAve = createBewlyFamilySnapshot(fakeDoc([{ version: '1.8.32', shadowBewlycat: false, shadowAvemujica: false }], {}));
    const rAve = snapAve() as any;
    expect(rAve.extensions).toEqual([{ id: 'avemujica', version: '1.8.32' }]);

    const snapBewly = createBewlyFamilySnapshot(fakeDoc([{ version: '1.7.8', shadowBewlycat: false, shadowAvemujica: false }], {}));
    const rBewly = snapBewly() as any;
    expect(rBewly.extensions).toEqual([{ id: 'bewlycat', version: '1.7.8' }]);
  });

  it('shadowRoot 为 null 的宿主：shadow 路径不产生假命中', () => {
    const hosts = [{ version: null, shadowBewlycat: true, shadowAvemujica: true, noShadowRoot: true }];
    const noMarker = createBewlyFamilySnapshot(fakeDoc(hosts, { bewlycat: false, avemujica: false }));
    expect(noMarker()).toBe('pending-family');
  });

  it('双标记同时在场→extensions 顺序固定 bewlycat 在前', () => {
    const snap = createBewlyFamilySnapshot(fakeDoc([{ version: '1.7.8', shadowBewlycat: true, shadowAvemujica: true }], { bewlycat: true, avemujica: true }));
    const r = snap() as any;
    expect(r.extensions).toEqual([{ id: 'bewlycat', version: '1.7.8' }, { id: 'avemujica', version: '1.7.8' }]);
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
