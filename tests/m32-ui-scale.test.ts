/* M32 单测：字号适配 + 地图悬浮窗（纯逻辑）
   ① 档位吸附与步进；② 脏数据不崩；③ 偏好读写（含无痕模式存不了）；④ zoom 换算；
   ⑤ 悬浮窗标题/头部文案；⑥ 卡片数估算随字号变小。
   M34 追加：⑦ 地图摆法（悬浮窗 / 嵌入页内）的校验、文案与存取。 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFS, FS_KEY, FS_MAX, FS_MIN, FS_STEPS, MAP_STYLES, cardsPerScreen, clampFs, fsLabel,
  mapStyleLabel, mapStyleNote, mapTitle, normalizeMapStyle, readPrefs, scaleStatus, stepFs, worldHeadline,
  writePrefs, zoomOf,
} from '../src/v4/ui-scale-core';

const memStore = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, dump: () => m };
};

describe('M32 字号档位', () => {
  it('五档，脏数据一律吸附到最近的档位', () => {
    expect(FS_STEPS.length).toBe(5);
    expect(clampFs(0)).toBe(FS_MIN);
    expect(clampFs(-50)).toBe(FS_MIN);
    expect(clampFs(999)).toBe(FS_MAX);
    expect(clampFs(118)).toBe(115);
    expect(clampFs(131)).toBe(130);
    expect(clampFs(NaN)).toBe(FS_MIN);
    expect(clampFs(undefined as unknown as number)).toBe(FS_MIN);
  });

  it('步进到头就停住（不会越界，UI 可以据此禁用按钮）', () => {
    expect(stepFs(100, -1)).toBe(100);
    expect(stepFs(100, 1)).toBe(115);
    expect(stepFs(160, 1)).toBe(160);
    expect(stepFs(160, -1)).toBe(145);
    expect(stepFs(777, 1)).toBe(160);        // 脏值先吸附再步进
  });

  it('档位有中文名（菜单里要显示"特大/巨大"）', () => {
    expect(fsLabel(100)).toBe('标准');
    expect(fsLabel(115)).toBe('大');
    expect(fsLabel(130)).toBe('特大');
    expect(fsLabel(145)).toBe('巨大');
    expect(fsLabel(160)).toBe('超大');
  });

  it('zoom 换算：100% → 1，160% → 1.6', () => {
    expect(zoomOf(100)).toBe(1);
    expect(zoomOf(130)).toBeCloseTo(1.3, 5);
    expect(zoomOf(160)).toBeCloseTo(1.6, 5);
  });
});

describe('M32 偏好存取（不入存档）', () => {
  it('没存过 → 默认值（字号标准、地图开着、悬浮窗）', () => {
    expect(readPrefs(memStore())).toEqual(DEFAULT_PREFS);
    expect(readPrefs(null)).toEqual(DEFAULT_PREFS);
  });

  it('写进去能读回来；脏 JSON 回落默认值而不是崩', () => {
    const s = memStore();
    writePrefs(s, { fs: 145, mapOpen: false, mapStyle: 'inline' });
    expect(readPrefs(s)).toEqual({ fs: 145, mapOpen: false, mapStyle: 'inline' });
    expect(JSON.parse(s.dump().get(FS_KEY)!)).toEqual({ fs: 145, mapOpen: false, mapStyle: 'inline' });
    const bad = memStore({ [FS_KEY]: '{oops' });
    expect(readPrefs(bad)).toEqual(DEFAULT_PREFS);
    const weird = memStore({ [FS_KEY]: JSON.stringify({ fs: 37, mapOpen: 'yes' }) });
    expect(readPrefs(weird)).toEqual({ fs: 100, mapOpen: true, mapStyle: 'float' });   // 37 吸附到 100，非布尔回落 true
  });

  it('localStorage 存不了（无痕模式）时静默失败、不抛错', () => {
    const boom = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(() => writePrefs(boom, { fs: 130, mapOpen: true, mapStyle: 'float' })).not.toThrow();
    expect(readPrefs(boom)).toEqual(DEFAULT_PREFS);
  });

  it('偏好 key 是独立的（不跟存档混在一起）', () => {
    expect(FS_KEY).toBe('zsv-ui-v1');
    expect(FS_KEY.indexOf('zombie_survival')).toBe(-1);
  });
});

describe('M34 地图摆法可配置', () => {
  it('只有两种摆法，默认悬浮窗', () => {
    expect(MAP_STYLES).toEqual(['float', 'inline']);
    expect(DEFAULT_PREFS.mapStyle).toBe('float');
  });

  it('脏值一律回落悬浮窗（老偏好里没有这个字段也不能变成"哪都没有地图"）', () => {
    expect(normalizeMapStyle('inline')).toBe('inline');
    expect(normalizeMapStyle('float')).toBe('float');
    expect(normalizeMapStyle(undefined)).toBe('float');
    expect(normalizeMapStyle(null)).toBe('float');
    expect(normalizeMapStyle('悬浮')).toBe('float');
    expect(normalizeMapStyle(1)).toBe('float');
  });

  it('按钮文案与说明跟着摆法走', () => {
    expect(mapStyleLabel('float')).toBe('悬浮窗');
    expect(mapStyleLabel('inline')).toBe('嵌入页内');
    expect(mapStyleLabel('???')).toBe('悬浮窗');
    expect(mapStyleNote('float')).toContain('悬浮窗');
    expect(mapStyleNote('inline')).toContain('探索页顶部');
    expect(mapStyleNote('inline')).not.toContain('悬浮窗');
  });

  it('摆法随偏好一起存取，探针读得到', () => {
    const s = memStore();
    writePrefs(s, { fs: 100, mapOpen: true, mapStyle: 'inline' });
    expect(readPrefs(s).mapStyle).toBe('inline');
    expect(scaleStatus({ fs: 100, mapOpen: true, mapStyle: 'inline' }))
      .toMatchObject({ mapStyle: 'inline', mapStyleLabel: '嵌入页内' });
  });
});

describe('M32 悬浮地图与排版参照', () => {
  it('悬浮窗标题按本地/大区切换', () => {
    expect(mapTitle(false, '余烬市区')).toContain('本地');
    expect(mapTitle(true, '北化工')).toContain('大区');
    expect(mapTitle(true, '北化工')).toContain('北化工');
  });

  it('头部一行含区域名 + 坐标 + 载具（玩家一眼知道自己在哪）', () => {
    expect(worldHeadline('余烬市区', { x: 3, y: 4 }, '皮卡')).toBe('余烬市区 · (3,4) · 皮卡');
    expect(worldHeadline('余烬市区', null, '')).toBe('余烬市区');
  });

  it('字号越大，一屏放得下的卡越少（大字适配的代价，写进探针参照）', () => {
    const small = cardsPerScreen(900, 200, 100);
    const big = cardsPerScreen(900, 200, 160);
    expect(small).toBeGreaterThan(big);
    expect(big).toBeGreaterThanOrEqual(1);
  });

  it('探针状态里带档位、名字与 zoom', () => {
    const st = scaleStatus({ fs: 130, mapOpen: false, mapStyle: 'float' });
    expect(st).toMatchObject({ fs: 130, label: '特大', mapOpen: false, mapStyle: 'float', key: FS_KEY });
    expect(st.zoom).toBeCloseTo(1.3, 5);
  });
});
