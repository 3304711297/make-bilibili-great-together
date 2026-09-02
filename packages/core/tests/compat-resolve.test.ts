import { describe, it, expect } from 'vitest';
import { resolveConflicts, CONFLICT_TABLE } from '../src/features/compat/resolve';
import type { ModuleMeta } from '../src/types';

const mod = (name: string): ModuleMeta => ({ name, description: '' });
const ALL = ['no-ad', 'optimize-homepage', 'remove-useless-url-params', 'optimize-story', 'player-video-fit', 'use-system-fonts'].map(mod);

describe('CONFLICT_TABLE', () => {
  it('与 spec §3.3 一致（optimize-story 两项已经 Issue #1 真机确认）', () => {
    expect(Object.keys(CONFLICT_TABLE.bewlycat).sort()).toEqual(
      ['no-ad', 'optimize-homepage', 'optimize-story', 'player-video-fit', 'remove-useless-url-params']);
    expect(Object.keys(CONFLICT_TABLE.avemujica).sort()).toEqual(
      ['no-ad', 'optimize-homepage', 'optimize-story', 'remove-useless-url-params', 'use-system-fonts']);
  });
});

describe('resolveConflicts', () => {
  it('未检测到扩展→全部 enabled，无 autoDisabled', () => {
    const r = resolveConflicts(ALL, { family: null, extensions: [], generic: false }, new Set(), new Set());
    expect(r.enabled).toHaveLength(6);
    expect(r.autoDisabled).toEqual([]);
  });

  it('仅 BewlyCat→其表内 5 个冲突项自动避让禁用，use-system-fonts 保留', () => {
    const r = resolveConflicts(ALL, { family: 'bewly', extensions: [{ id: 'bewlycat', version: '1.7.8' }], generic: false }, new Set(), new Set());
    expect(r.enabled.map(m => m.name)).toEqual(['use-system-fonts']);
    expect(r.autoDisabled.map(d => d.extension)).toEqual(new Array(5).fill('bewlycat'));
    expect(r.autoDisabled.map(d => d.module)).toEqual(['no-ad', 'optimize-homepage', 'remove-useless-url-params', 'optimize-story', 'player-video-fit']);
  });

  it('仅 AveMujica→其表内 5 个冲突项自动避让禁用，player-video-fit 保留', () => {
    const r = resolveConflicts(ALL, { family: 'bewly', extensions: [{ id: 'avemujica', version: '1.8.32' }], generic: false }, new Set(), new Set());
    expect(r.enabled.map(m => m.name)).toEqual(['player-video-fit']);
  });

  it('两者都在→并集 6 个全禁用', () => {
    const r = resolveConflicts(ALL, { family: 'bewly', extensions: [{ id: 'bewlycat', version: null }, { id: 'avemujica', version: null }], generic: false }, new Set(), new Set());
    expect(r.enabled).toHaveLength(0);
    expect(r.autoDisabled).toHaveLength(6);
  });

  it('generic→保守并集，同样 6 个全禁用', () => {
    const r = resolveConflicts(ALL, { family: 'bewly', extensions: [], generic: true }, new Set(), new Set());
    expect(r.enabled).toHaveLength(0);
  });

  it('force-on 覆盖冲突禁用，但不覆盖菜单禁用', () => {
    const menuDisabled = new Set(['optimize-homepage']);
    const r = resolveConflicts(ALL,
      { family: 'bewly', extensions: [{ id: 'bewlycat', version: null }], generic: false },
      menuDisabled, new Set(['no-ad']));
    expect(r.enabled.map(m => m.name)).toEqual(['no-ad', 'use-system-fonts']);
    expect(r.autoDisabled.map(d => d.module)).not.toContain('no-ad');
    expect(r.autoDisabled.map(d => d.module)).not.toContain('optimize-homepage');
    expect(r.autoDisabled).toHaveLength(3);
  });
});
