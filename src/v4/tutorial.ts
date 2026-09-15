/**
 * M27 新手教程（用户：「现在需要一个完善的新手教程，我的好多朋友都不会玩」）。
 *
 * 设计取舍：
 *  - **高亮真实界面**，而不是弹一堆说明文字。每一步都把目标元素圈出来（一个带巨大 box-shadow 的
 *    "洞"），气泡贴着它显示。玩家看完就知道"那个东西在哪里"，而不是记住一段话。
 *  - **可以随时退出、下次接着看**（进度存 localStorage）。新玩家最怕的是"点错了就再也找不回来"。
 *  - **点击穿透**（overlay 的 pointer-events 全关）：教程只是"指给你看"，不该挡住任何操作；
 *    唯一的按钮在气泡上（上一步 / 下一步 / 跳过 / 结束）。
 *  - 步骤写成数据（STEPS 数组），文案与顺序都在一处 —— 以后加系统只改这一张表。
 */
const KEY_DONE = 'dsh.tutorial.done';
const KEY_STEP = 'dsh.tutorial.step';

export interface TutStep {
  /** 圈出来的元素（找不到就跳过这一步，不会卡住教程） */
  sel?: string;
  title: string;
  body: string;
  /** 进入这一步之前执行（比如切到背包页）——写成函数而不是字符串：不用 eval，探针也能直接调 */
  before?: () => void;
  /** 气泡放哪边（默认自动判：下方不够就放上方） */
  place?: 'top' | 'bottom';
}

export const STEPS: TutStep[] = [
  {
    title: '欢迎来到《丧尸末日生存》· 先花 2 分钟看完这个',
    body: '你在一座叫「余烬」的城市里醒来，外面全是丧尸。目标很简单：<b>活到第 90 天，从撤离点离开</b>。'
      + '<br><br>这个教程<b>只是指给你看</b>——它不会挡住任何操作，随时可以点「跳过」或按 Esc 关掉；'
      + '下次再打开游戏会<b>从你看到的那一步继续</b>。全部看完大概 2 分钟。',
  },
  {
    sel: '#hud .hud-bars',
    title: '最上面这五条：你的命',
    body: '<b>生命 / 体力 / 饱食 / 水分 / 感染</b>。'
      + '<br>饱食和水分为 0 会持续掉血；被咬会涨<b>感染</b>，到 60% 就是不可逆的爆发期。'
      + '<br>记住一句话：<b>出门前先看这五条，别空着肚子出城。</b>',
  },
  {
    sel: '#ap-pips',
    title: '一天能做多少事，看这一排格子',
    body: '<b>行动力（AP）</b>是这游戏唯一的时间货币：搜索一处 1 点、深度搜索 2 点、走路 1 点/区块、'
      + '制作和建造各 1 点。一天 14 点（体能每 3 级再 +1，最多 +5）。'
      + '<br><b>用光了只能睡觉</b>——所以"先干什么"就是这游戏的核心策略。',
  },
  {
    sel: '#clock-phase',
    title: '旁边是日期与时段',
    body: '每天 = 一个回合。时段会从<b>清晨 → 白天 → 黄昏 → 夜晚</b>走（按你花掉的行动力推），'
      + '<b>天黑之后更危险</b>：路上更容易撞见东西、视野也差。'
      + '<br>血月（每 7 天）会来守夜战，日历上会提前标出来。',
  },
  {
    sel: '#v4world',
    title: '左边这张图：你在哪、能去哪',
    body: '每个方块是 1km² 的区块，<b>点亮的格子才能走</b>（先点一次看路线与花费，再点一次才出发）。'
      + '<br>地图上方的「🗺️ 本地地图 / 🌐 大区地图」可以切换：本地图看"这条街有什么"，大区图看"该往哪个方向跑"。'
      + '<br>危险度是<b>从家往外涨</b>的：家里和紧邻一圈是安全区（危险 1），越往外越危险、也越有好东西。',
  },
  {
    sel: '#view.v4-board > .v4board',
    title: '右边这些卡片：一天的活儿都在这',
    body: '「今日行动」是今天能干的事；「格子详情」是脚下这格有什么；「采集与拆解」「水体」「菜园」是日常产出；'
      + '「今夜」管睡觉；「旅途记录」是你走过的路。'
      + '<br><b>一张卡只讲一件事</b>——哪里缺东西，就去对应的卡里找。',
  },
  {
    sel: '.v4card[data-card="today"]',
    title: '第一个目标：先去圣玛丽医院',
    body: '开场任务会给你一条线索：<b>去医院找药</b>。医院在安全区边上（危险 1~2），走过去只要几个区块。'
      + '<br>出门前建议：<b>先搜两次自家附近的区块</b>（布条、罐头、胶带都在这），手上至少有一把撬棍和两个绷带。',
  },
  {
    sel: '#tabs',
    before: () => V4Tutorial.go('inv'),
    title: '背包（🎒）：先学会「用」和「装备」',
    body: '点带「使用」的物品就能吃/喝/包扎；<b>武器要点「装备」才生效</b>（背包里那件只是"带着"）。'
      + '<br>武器认<b>口径</b>、子弹认<b>穿透</b>：普通弹打丧尸够用，遇到装甲丧尸（装甲 5）要换穿甲弹，'
      + '在背面的「弹药」区按口径装填。',
  },
  {
    sel: '#tabs',
    before: () => V4Tutorial.go('craft'),
    title: '制作（🛠️）：四个工作站各管一摊',
    body: '配方按工作站分区：<b>工作台</b>（绷带/胶水/燃烧瓶）、<b>弹药台</b>（复装与穿甲弹）、'
      + '<b>医疗台</b>（急救包/抗辐射药）、<b>灶台</b>（熟食/批量煮水）。'
      + '<br>这些都建在<b>据点 → 建设</b>里，建了才有那一站的配方；发电机是全局增益（净水 +1、菜园保鲜 +1 天）。',
  },
  {
    sel: '#tabs',
    before: () => V4Tutorial.go('explore'),
    title: '睡觉 = 翻到下一天（在「今夜」卡里）',
    body: '<b>行动力用光、或者天黑了就睡觉</b>：安全屋睡满格、零夜袭——这是最安全的睡法。'
      + '<br>在野外过夜只回一部分行动力，还会涨<b>睡眠债</b>（行动力上限下降），并且<b>必定掷夜袭</b>。'
      + '<br>所以出远门要算：<b>这一趟能不能在入夜前回到据点？</b>回不去就找掩体/车里睡。',
  },
  {
    sel: '#tabs',
    before: () => V4Tutorial.go('base'),
    title: '据点（🏠）：长期变强全靠它',
    body: '优先顺序建议：<b>🚰 净水装置</b>（每天产水，缺水是新人第一死因）→ <b>🌱 屋顶菜园</b>（每天产菜）'
      + '→ <b>🛠️ 工作台</b>（解锁制作）→ 再考虑弹药台/医疗台/灶台。'
      + '<br>材料来自搜刮与击杀；「加固门窗 / 围墙工事」是防血月的，别等到第 7 天才想起来。',
  },
  {
    sel: '#v4b-overlay',
    title: '撞上丧尸怎么办：四个招式槽',
    body: '<b>1~4</b> 用招式、<b>5</b> 逃跑、<b>6</b> 换武器（点卡片也能操作）。'
      + '<br>近战不耗子弹但会挨咬；<b>枪声会拉高噪音</b>（噪音高 → 夜里更容易被围攻）。'
      + '<br>看敌人头上的标签：<b>装甲</b>（枪械伤害减半，换穿甲弹或近战）、<b>迅捷</b>（先手高）、'
      + '<b>自爆</b>（死亡会炸，用火/爆炸招式打死就不会炸）。',
  },
  {
    sel: '#tabs',
    before: () => V4Tutorial.go('explore'),
    title: '死了会怎样？',
    body: '第 1~3 天的第一次死亡会被路过的幸存者救回来（扣一半材料，<b>整档只有一次</b>）；之后再死就是<b>重开新档</b>。'
      + '<br>所以前期别去危险 4~5 的地方——你不是在打怪，你是在<b>熬过每一天</b>。',
  },
  {
    sel: '#btn-menu',
    title: '存档、账号、设置都在 ☰ 里',
    body: '点右上角的 <b>☰</b>：世界管理（多开世界 / 挑战码分享 / 幽灵据点）、账号云存档、'
      + '战斗节奏与音效设置、以及<b>「新手指南」</b>（想再看一遍就点它）。'
      + '<br>存档是自动的（每天结束时、搜刮/制作/建造/战斗结束都会存）。',
  },
  {
    sel: '#view.v4-board',
    title: '开局三件事（照这个顺序做，前三天很难死）',
    body: '① <b>搜两处家门口的区块</b>，凑齐布条 / 罐头 / 胶带；'
      + '<br>② <b>做两个绷带 + 煮一壶水</b>（工作台与灶台，没有灶台就先在背包里用净化片）；'
      + '<br>③ <b>建净水装置</b>，之后每天有水；把菜园接上，食物就自给自足了。'
      + '<br><br>然后就可以去医院接主线了。祝你好运——<b>活到第 90 天</b>。',
  },
];

let cur = -1;
let root: HTMLElement | null = null;

/* 注意：`Number(null)` 是 **0**（不是 NaN），所以"没存过"会被读成"第 0 步" ——
   这个坑让首次自动弹出直接失效：seen=0 被当成"上次看到第 0 步"，于是走"礼貌提醒"分支而不是弹教程。
   必须先判 null。 */
const readNum = (key: string, def: number): number => {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === '') return def;
    const v = Number(raw);
    return Number.isFinite(v) ? v : def;
  } catch { return def; }
};
const write = (key: string, v: string): void => { try { localStorage.setItem(key, v); } catch { /* 隐私模式忽略 */ } };

export const tutorialDone = (): boolean => { try { return localStorage.getItem(KEY_DONE) === '1'; } catch { return false; } };
export const tutorialSeen = (): number => readNum(KEY_STEP, -1);
/** 菜单里的「重新看一遍」用它复位 */
export function tutorialReset(): void { write(KEY_DONE, '0'); write(KEY_STEP, '-1'); }

function ensureRoot(): HTMLElement {
  if (root && document.body.contains(root)) return root;
  root = document.createElement('div');
  root.id = 'v4tut';
  document.body.appendChild(root);
  return root;
}

/** 真正"关掉"的实现（finish=true 表示看完了；否则记下当前步、下次继续） */
function closeTutorial(finish: boolean): void {
  /* 调试留痕：谁在什么时候把教程关掉了（DOM 消失这类问题一眼可见） */
  (globalThis as any).__v4TutCloseLog = ((globalThis as any).__v4TutCloseLog || []).concat([{ finish, step: cur, at: Math.round(performance.now()) }]).slice(-8);
  if (cur >= 0) write(KEY_STEP, finish ? '-1' : String(cur));
  if (finish) { write(KEY_DONE, '1'); write(KEY_STEP, '-1'); }
  cur = -1;
  window.removeEventListener('resize', onResize);
  if (root && root.parentNode) root.parentNode.removeChild(root);
  root = null;
  if (finish) {
    try {
      const api = globalThis as any;
      api.log?.('🎓 新手指南看完了。开局三件事：搜两处 → 做绷带和水 → 建净水装置。医院在等你。', 'success');
      api.toast?.('教程结束', '☰ 菜单 → 新手指南，随时可以再看一遍。', 'ok');
    } catch { /* 教程不该因为提示失败而报错 */ }
  }
}

/** 进入某一步（回调 before + 立刻画，再补一次重画）——start/next/prev 都走它。
    跳过逻辑在这里统一处理：paint 只有在**两次尝试之后**仍找不到目标才算"这一步跳过"。 */
function enter(i: number): void {
  cur = i;
  const st = STEPS[cur];
  if (!st) { closeTutorial(true); return; }
  if (st.before) { try { st.before(); } catch (e) { console.warn('[tutorial] before 失败', e); } }
  /* 先立刻画一次（**不能只靠 rAF**：无头/后台标签页里 rAF 会被节流甚至不触发，
     实测就出现过"步骤号已经前进、DOM 却没建"的情况）。再补 150ms 一次，等页签切完、布局稳定。 */
  const first = paint(i);
  setTimeout(() => {
    if (cur !== i) return;
    if (first) { paint(i); return; }            // 第一次画成了，这次只是重贴（窗口/布局可能变了）
    if (paint(i)) return;                        // 第一次没画成、这次成了
    /* 两次都没画成：真的跳过这一步（不关教程） */
    if (i + 1 >= STEPS.length) { closeTutorial(true); return; }
    enter(i + 1);
  }, 150);
}

/** 画一步：先把目标元素圈出来（带巨大 box-shadow 的"洞"），再把气泡贴上去。
    返回 false 表示"这一步跳过了"（目标不存在/尺寸为 0），调用方负责前进 ——
    这样跳过是**静默推进**，而不是把整段教程关掉（早期版本就是这么写的，结果"切页签那一步"
    会把教程直接关掉：实测走 15 步只走到 13 步）。 */
function paint(i: number): boolean {
  const r = ensureRoot();
  const st = STEPS[i];
  if (!st) return false;
  const target = st.sel ? (document.querySelector(st.sel) as HTMLElement | null) : null;
  const box = target ? target.getBoundingClientRect() : null;
  /* 目标不存在 / 尺寸为 0 / 完全在视口外 → 跳过这一步（例如 1056 宽下没有某些节点，
     或者页签刚切过去还没画完）。**绝不能卡在一步上**，也不能拿一个 0×0 的框去画圈。 */
  const usable = !st.sel || (!!box && box.width > 4 && box.height > 4 && box.bottom > 0 && box.top < innerHeight);
  if (!usable) return false;
  const pad = 6;
  const hold = box ?? { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
  const hole = {
    left: Math.max(0, hold.left - pad), top: Math.max(0, hold.top - pad),
    w: Math.min(innerWidth, hold.width + pad * 2), h: Math.min(innerHeight, hold.height + pad * 2),
  };
  const W = 360;
  const place = st.place ?? (hole.top + hole.h + 240 > innerHeight ? 'top' : 'bottom');
  const top = place === 'bottom' ? hole.top + hole.h + 10 : Math.max(8, hole.top - 10 - 200);
  const left = Math.min(Math.max(8, hole.left + hole.w / 2 - W / 2), innerWidth - W - 8);
  const last = i === STEPS.length - 1;
  /* 没有目标元素（比如欢迎语/收尾语）就不画圈 —— 否则会在屏幕中央留一个 0×0 的亮点 */
  const spotHtml = st.sel
    ? '<div class="v4tut-spot" style="left:' + hole.left + 'px;top:' + hole.top + 'px;width:' + hole.w + 'px;height:' + hole.h + 'px"></div>'
    : '';
  r.innerHTML = spotHtml +
    '<div class="v4tut-bub" style="left:' + left + 'px;top:' + top + 'px;width:' + W + 'px' + (place === 'top' ? ';bottom:auto' : '') + '">' +
      '<div class="v4tut-hd"><span class="badge">' + (i + 1) + ' / ' + STEPS.length + '</span>' +
        '<b>' + st.title + '</b>' +
        '<button class="btn xs ghost" onclick="V4Tutorial.close()" title="关掉（下次从这里继续）">✕</button></div>' +
      '<div class="v4tut-bd">' + st.body + '</div>' +
      '<div class="v4tut-ft">' +
        '<button class="btn xs ghost" onclick="V4Tutorial.skip()">跳过教程</button>' +
        '<span class="spacer"></span>' +
        (i > 0 ? '<button class="btn xs" onclick="V4Tutorial.prev()">上一步</button>' : '') +
        '<button class="btn xs ' + (last ? 'ok' : 'primary') + '" onclick="V4Tutorial.next()">' + (last ? '开始游戏' : '下一步') + '</button>' +
      '</div>' +
    '</div>';
  write(KEY_STEP, String(i));
  return true;
}

/** 浏览器窗口变化时重新贴一次（不然圈会跟元素错位） */
function onResize(): void { if (cur >= 0) paint(cur); }

export const V4Tutorial = {
  /** 开始（或从上次那一步继续）。force = 忽略"已看完"标记，从头开始 */
  start(force = false): void {
    if (force) tutorialReset();
    const s = tutorialSeen();
    window.addEventListener('resize', onResize);
    enter((!force && s >= 0 && s < STEPS.length) ? s : 0);
  },
  next(): void {
    if (cur < 0) return;
    if (cur + 1 >= STEPS.length) { closeTutorial(true); return; }
    enter(cur + 1);
  },
  prev(): void {
    if (cur <= 0) return;
    enter(cur - 1);
  },
  /** 关掉（记下当前这一步，下次继续）。finished 参数只有内部与探针会用 */
  close(finished = false): void { closeTutorial(finished); },
  /** 跳过整段（不再自动弹；菜单里仍可重看） */
  skip(): void { write(KEY_DONE, '1'); write(KEY_STEP, '-1'); closeTutorial(false); },
  /** 教程里切换页签用（内联 before 会调它） */
  go(tab: string): void { try { (globalThis as any).setTab?.(tab); } catch { /* 忽略 */ } },
  isOpen: (): boolean => cur >= 0,
  step: (): number => cur,
  total: (): number => STEPS.length,
};

/** 首次进入自动弹一次（看完了就不再自动弹，除非玩家在菜单里主动再点） */
export function maybeAutoStartTutorial(): void {
  if (tutorialDone()) return;
  const seen = tutorialSeen();
  if (seen >= 0) {
    /* 上次没看完：问一句再继续，别打断"我就想先点两下"的玩家 */
    (globalThis as any).toast?.('上次的新手指南没看完', '点 ☰ 菜单 → 新手指南，可以从第 ' + (seen + 1) + ' 步继续。', 'info');
    return;
  }
  V4Tutorial.start();
}
/** 第一场战斗打赢之后的一次性提示（战斗界面是模态，引导只能这样给） */
let battleTipShown = false;
export function maybeBattleTip(): void {
  if (battleTipShown) return;
  battleTipShown = true;
  try {
    (globalThis as any).toast?.('第一场战斗结束了', '☰ 菜单 → 新手指南 → 第 13 步：招式槽、噪音、装甲丧尸怎么打。', 'ok');
  } catch { /* 忽略 */ }
}

(globalThis as any).V4Tutorial = V4Tutorial;
/* 探针/调试用：直接触发"首次自动弹"这一条路径（不带 dev 参数的页面才会走它） */
(globalThis as any).__v4AutoTut = maybeAutoStartTutorial;
