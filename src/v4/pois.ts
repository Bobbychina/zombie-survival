/* POI（兴趣点）= 玩家在世界里真正要跑的地方。区块只是容器，POI 才是"地区"。 */
export interface PoiDef {
  id: string;
  name: string;
  icon: string;
  biomes: string[];          // 允许出现的生物群系
  danger: number;            // 危险修正
  searches: number;          // 能搜刮几次（搜空后只剩外壳）
  loot: Record<string, number>;
  enemies: string[];
  feat?: 'vehicle' | 'fuel' | 'food' | 'water' | 'npc' | 'quest' | 'radio' | 'medical' | 'tools' | 'rest' | 'dive' | 'rad';
  /** M7.1：这类地方专门出建材（每次"材料"档额外多给这么多） */
  matBonus?: number;
  desc: string;
  firstFind?: string;        // 首次抵达的固定线索文案
  firstItem?: { id: string; n: number };
}

const P = (d: PoiDef) => d;

/* M20：幽灵据点——不是生成器刷出来的，是玩家导入"幽灵码"后由 ghosts.ts 钉到地图上的。
   放在 POIS 表里是为了让地图渲染 / tooltip / 图标 / 判定文案全都能复用它。 */
export const GHOST_POI_ID = 'ghost';
const GHOST_POI: PoiDef = P({
  id: 'ghost', name: '幽灵据点', icon: '👻',
  biomes: ['city', 'suburb', 'industrial', 'ruins', 'military', 'farm'],
  danger: 1, searches: 1, loot: {}, enemies: ['walker', 'runner'],
  desc: '别人的安全屋，现在只剩一个抱着枪的影子。打赢能拿走他的仓库——那是他分享出来的快照。',
});

export const POIS: Record<string, PoiDef> = {
  [GHOST_POI_ID]: GHOST_POI,
  market: P({ id:'market', name:'超市', icon:'🛒', biomes:['city','suburb'], danger:0, searches:6,
    loot:{ can:.4, water:.3, biscuit:.3, cola:.2, dirty:.12, choco:.12 }, enemies:['walker','runner','crawler'],
    feat:'food', desc:'货架被扫过一遍，但仓库深处还有东西。' }),
  mall: P({ id:'mall', name:'购物中心', icon:'🏬', biomes:['city'], danger:1, searches:7,
    loot:{ can:.3, cloth:.3, cola:.2, choco:.2, chip:.12, kevlar:.06, machete:.08 }, enemies:['runner','walker','hound','screamer'],
    desc:'灯还亮着的橱窗后面，全是没来得及拿走的东西——和等着你的人。' }),
  pharmacy: P({ id:'pharmacy', name:'药房', icon:'💊', biomes:['city','suburb'], danger:0, searches:4,
    loot:{ bandage:.45, painkiller:.3, anti:.28, medkit:.12, chem:.15, purify:.35, dirty:.2 }, enemies:['walker','crawler'],
    feat:'medical', desc:'处方柜台锁着，但后面那排货架还满着。' }),
  hospital: P({ id:'hospital', name:'医院', icon:'🏥', biomes:['city'], danger:1, searches:6,
    loot:{ bandage:.4, medkit:.2, anti:.25, painkiller:.25, chem:.2, serum:.05, purify:.3, dirty:.25 }, enemies:['walker','crawler','screamer','poison'],
    feat:'medical', firstFind:'你在值班台找到一本褪色的日记——上面反复写着「方舟」。', desc:'走廊里全是拖行的声音。药房在二楼。' }),
  clinic: P({ id:'clinic', name:'诊所', icon:'🩺', biomes:['suburb','farm'], danger:0, searches:3,
    loot:{ bandage:.5, painkiller:.3, anti:.25, cloth:.2 }, enemies:['walker','crawler'], feat:'medical',
    desc:'社区诊所。柜子小，但没人抢过。' }),
  police: P({ id:'police', name:'警局', icon:'🚓', biomes:['city','suburb'], danger:1, searches:5,
    loot:{ pistol:.2, ammo:.4, powder:.3, metal:.3, kevlar:.12, shotgun:.1, tape:.2 }, enemies:['walker','brute','crawler'],
    feat:'tools', firstFind:'枪柜底层卡着一把手枪和一小盒子弹。', desc:'枪柜被撬过，但总有漏网的。' }),
  military: P({ id:'military', name:'军事哨所', icon:'🪖', biomes:['military','ruins'], danger:2, searches:5,
    loot:{ rifle:.15, marksman:.08, ammo:.4, kevlar:.2, grenade:.18, powder:.35, keycard:.12, hazmat:.12, flare:.3 },
    enemies:['armored','brute','hound','screamer'], feat:'quest',
    desc:'沙袋、铁丝网和一辆烧穿的装甲车。这里曾经有人守过。' }),
  prison: P({ id:'prison', name:'监狱', icon:'⛓️', biomes:['industrial','ruins'], danger:2, searches:5,
    loot:{ keycard:.15, kevlar:.15, metal:.4, vest:.2, medkit:.15, powder:.3 }, enemies:['armored','brute','tyrant'],
    feat:'quest', desc:'暴动之后门就没关过。里面关着的东西也不全是人。' }),
  /* M25：辐射源（用户："添加辐射（添加核电站啊啥的）"）。
     这两个不只是"更危险的建筑"——周围 2~3 格是**辐射场**，待久了体内辐射会累积（见 src/v4/rad-core.ts）。 */
  nuclear: P({ id:'nuclear', name:'核电站', icon:'☢️', biomes:['industrial','ruins'], danger:3, searches:6,
    loot:{ chip:.45, chem:.4, metal:.35, a556_ap:.14, a308_ap:.08, radaway:.22, o2:.15, serum:.12 },
    enemies:['armored','spitter','brute','tyrant'], feat:'rad',
    desc:'冷却塔还在冒白汽，虽然没人知道它靠什么在运转。这里什么都能找到——包括你不想找到的东西。' }),
  waste: P({ id:'waste', name:'废料填埋场', icon:'🛢️', biomes:['industrial','ruins','farm'], danger:2, searches:4,
    loot:{ chem:.5, metal:.4, fuel:.25, iodine:.25, chip:.2, a762_ap:.12 },
    enemies:['poison','brute','hound','spitter'], feat:'rad',
    desc:'埋了几十年的桶开始漏了。夜里桶盖底下有绿色的光。' }),
  school: P({ id:'school', name:'学校', icon:'🏫', biomes:['suburb','city'], danger:0, searches:5,
    loot:{ data:.2, cloth:.3, can:.25, bandage:.25, chip:.15, backpack:.12 }, enemies:['walker','crawler','screamer'],
    desc:'教室黑板上的粉笔字还停在那一天。' }),
  church: P({ id:'church', name:'教堂', icon:'⛪', biomes:['suburb','ruins'], danger:-1, searches:3,
    loot:{ can:.3, water:.3, bandage:.3, cloth:.3 }, enemies:['walker'],
    feat:'rest', desc:'门是开的，长椅上还留着几支蜡烛——有人在这里躲过，然后走了。' }),
  warehouse: P({ id:'warehouse', name:'仓库', icon:'📦', biomes:['industrial','highway'], danger:1, searches:6,
    loot:{ metal:.4, wood:.35, tape:.3, fuel:.25, powder:.25, chip:.12 }, enemies:['walker','bomber','hound'],
    desc:'装卸平台上的货柜还锁着，叉车歪在门口。' }),
  construction: P({ id:'construction', name:'工地', icon:'🏗️', biomes:['city','suburb'], danger:0, searches:5,
    loot:{ wood:.45, metal:.4, tape:.25, cloth:.2, crowbar:.15 }, enemies:['walker','crawler','bomber'],
    desc:'塔吊停在半空，钢筋堆得像一堆骨头。' }),
  apartment: P({ id:'apartment', name:'公寓楼', icon:'🏢', biomes:['city','suburb'], danger:0, searches:6,
    loot:{ cloth:.35, can:.25, choco:.15, painkiller:.15, chip:.15, tape:.15, backpack:.1 }, enemies:['walker','crawler','screamer'],
    desc:'一层一层往上搜，楼梯间里全是回声。' }),
  gas: P({ id:'gas', name:'加油站', icon:'⛽', biomes:['highway','suburb','industrial'], danger:1, searches:4,
    loot:{ fuel:.5, bottle:.35, powder:.2, molotov:.15, tape:.2 }, enemies:['runner','hound','bomber'],
    feat:'fuel', desc:'油罐还没漏光，但气味把东西引来了。' }),
  garage: P({ id:'garage', name:'汽修厂', icon:'🔧', biomes:['industrial','highway','suburb'], danger:1, searches:4,
    loot:{ metal:.45, tape:.3, chip:.2, fuel:.2, powder:.2 }, enemies:['brute','walker','hound'],
    feat:'vehicle', desc:'升降机上还架着一辆车。能不能开走是另一回事。' }),
  farm: P({ id:'farm', name:'农场', icon:'🌾', biomes:['farm'], danger:0, searches:5,
    loot:{ can:.3, jerky:.25, wood:.3, water:.25, choco:.15, cloth:.2 }, enemies:['walker','hound','brute'],
    feat:'food', desc:'田里的东西自己长起来了，也自己烂掉了。' }),
  waterworks: P({ id:'waterworks', name:'水厂', icon:'🚰', biomes:['industrial','ruins'], danger:1, searches:4,
    loot:{ water:.5, dirty:.5, metal:.3, chip:.2, purify:.4 }, enemies:['drowned','spitter','crawler'],
    feat:'water', desc:'过滤池还有水，只是得自己烧开。' }),
  radio: P({ id:'radio', name:'广播电台', icon:'📻', biomes:['city','ruins'], danger:1, searches:3,
    loot:{ chip:.5, data:.25, tape:.2, metal:.2 }, enemies:['armored','screamer','walker'],
    feat:'radio', firstFind:'发射塔的应急电还在。你接上了天线，收到一段循环播放的加密通话——「方舟实验室」。', desc:'铁塔在风里响，机房的门是热的。' }),
  tunnel: P({ id:'tunnel', name:'隧道', icon:'🚇', biomes:['highway','city'], danger:2, searches:5,
    loot:{ chem:.35, chip:.2, gasmask:.12, serum:.06, fuel:.2, flare:.2 }, enemies:['poison','spitter','crawler','hound'],
    feat:'tools', firstFind:'检修间挂着一具防毒面具，滤罐还有余量。', desc:'漆黑、潮湿、回声很大。毒气在隧道里积着不散。' }),
  camp: P({ id:'camp', name:'幸存者营地', icon:'⛺', biomes:['forest','suburb','farm','ruins'], danger:-1, searches:2,
    loot:{ can:.3, water:.3, bandage:.2, ammo:.2, purify:.3, dirty:.2 }, enemies:['walker'],
    feat:'npc', desc:'铁丝网后面有人影。他们也在看你。' }),
  outpost: P({ id:'outpost', name:'拾荒者据点', icon:'🏴', biomes:['industrial','ruins','city'], danger:1, searches:4,
    loot:{ metal:.4, ammo:.3, fuel:.2, medkit:.15, marksman:.05, flare:.2 }, enemies:['bandit'],
    feat:'npc', desc:'这里的人靠抢活着。他们盯上你了。' }),
  bunker: P({ id:'bunker', name:'地下掩体', icon:'🚪', biomes:['military','ruins'], danger:2, searches:4,
    loot:{ ammo:.4, grenade:.25, medkit:.2, kevlar:.15, serum:.1, keycard:.1, flare:.25 }, enemies:['armored','hatcher','brute'],
    feat:'quest', desc:'门是钢的，锁是电子的，里面很安静。' }),
  lab: P({ id:'lab', name:'方舟实验室', icon:'☣️', biomes:['industrial','ruins','military'], danger:3, searches:3,
    loot:{ serum:.4, chem:.4, medkit:.3, hazmat:.3 }, enemies:['hatcher','spitter','giant'],
    feat:'quest', firstFind:'气密门后面是往下的楼梯。应急灯还亮着——像一口没闭上的眼睛。', desc:'通风井在往外吐白雾。往下的每一层都写着「别进去」。' }),
  // M7：水下目标（只能潜水搜，带氧气瓶才敢往深处走；掉落是中期最肥的一档）
  sunken: P({ id:'sunken', name:'沉没基地', icon:'🤿', biomes:['water'], danger:3, searches:4,
    loot:{ chip:.5, serum:.25, kevlar:.12, hazmat:.1, ammo:.35, o2:.3, wetsuit:.08, rifle:.06, metal:.4 },
    enemies:['drowned','spitter','hatcher'], feat:'dive',
    firstFind:'水下有一整层没被淹完的房间：应急灯还在闪，像有人刚离开。',
    desc:'水面下那截钢筋水泥是个军用码头——里面还有没拆封的箱子。' }),
  // M7.1：现代建筑与建材大卖场（用户反馈"建材太少、地区太单调"）——大空间、可搜次数多、专出建材
  furniture: P({ id:'furniture', name:'宜家家具城', icon:'🛋️', biomes:['city','suburb','highway'], danger:0, searches:8, matBonus:3,
    loot:{ wood:.6, cloth:.4, tape:.3, metal:.25, chip:.15, backpack:.12, machete:.08 },
    enemies:['walker','crawler','screamer'], desc:'三层楼的样板间，每一间都还摆着"家"的样子。拆了就是木头和布。' }),
  hardware: P({ id:'hardware', name:'五金建材城', icon:'🔨', biomes:['city','suburb','industrial'], danger:1, searches:8, matBonus:4,
    loot:{ metal:.55, wood:.55, tape:.35, powder:.2, crowbar:.15, axe:.12, machete:.1, helmet:.1 },
    enemies:['walker','brute','crawler'], feat:'tools',
    firstFind:'仓库卷帘门只拉开一半——里面整垛的钢管和木板都还在。', desc:'从螺丝到整捆钢筋都有。末日里这地方等于金矿。' }),
  megamart: P({ id:'megamart', name:'仓储式超市', icon:'🏬', biomes:['city','suburb','highway'], danger:1, searches:9, matBonus:2,
    loot:{ can:.45, water:.4, biscuit:.35, dirty:.3, cola:.25, choco:.2, cloth:.3, wood:.25, tape:.25, backpack:.1, purify:.25 },
    enemies:['walker','runner','hound'], feat:'food',
    desc:'货架有六米高，叉车还卡在过道里——够一整个营地吃半年。' }),
  office: P({ id:'office', name:'写字楼', icon:'🏢', biomes:['city'], danger:1, searches:6, matBonus:1,
    loot:{ chip:.45, tape:.3, cloth:.25, can:.2, painkiller:.2, data:.15, marksman:.04 },
    enemies:['walker','crawler','screamer'], desc:'玻璃幕墙后面全是工位。有人在这里加班到最后一刻。' }),
  appliance: P({ id:'appliance', name:'家电城', icon:'📺', biomes:['city','suburb'], danger:0, searches:6, matBonus:3,
    loot:{ chip:.5, metal:.45, tape:.3, fuel:.2, bottle:.2 },
    enemies:['walker','bomber','crawler'], desc:'一整层没拆封的冰箱洗衣机——拆开全是铜管和铁皮。' }),
  depot: P({ id:'depot', name:'物流园', icon:'🚚', biomes:['industrial','highway'], danger:1, searches:7, matBonus:5,
    loot:{ metal:.5, wood:.6, tape:.35, fuel:.3, chip:.2, powder:.2, bottle:.2 },
    enemies:['brute','walker','hound'], feat:'vehicle', desc:'集装箱排到看不见头。哪个里面装着货，得自己撬。' }),
  buildmart: P({ id:'buildmart', name:'建材市场', icon:'🧱', biomes:['industrial','suburb'], danger:1, searches:7, matBonus:6,
    loot:{ wood:.7, metal:.55, tape:.3, cloth:.2, powder:.25, crowbar:.1 },
    enemies:['brute','walker','armored'], desc:'水泥、板材、钢筋、防水卷材——堆得比人高，搬得走多少算你的。' }),
  // M8：木头专供（玩家反馈"木头找不到"）——伐木是主渠道，这两个地方是"来一趟能拉一车"的补充
  lumber: P({ id:'lumber', name:'林场', icon:'🏕️', biomes:['forest','suburb'], danger:0, searches:6, matBonus:4,
    loot:{ wood:.75, cloth:.3, tape:.2, metal:.2, axe:.12, crowbar:.12, chip:.08 },
    enemies:['walker','hound','crawler'], feat:'tools',
    firstFind:'看林人的板房里码着一整面墙的干柴——墙角还立着一把没生锈的斧子。',
    desc:'伐木道一直通进山里，装车台上的原木还没拉走。' }),
  sawmill: P({ id:'sawmill', name:'木材加工厂', icon:'🪚', biomes:['industrial'], danger:1, searches:7, matBonus:5,
    loot:{ wood:.8, metal:.4, tape:.3, fuel:.2, powder:.2, axe:.15, crowbar:.1, chip:.12 },
    enemies:['brute','walker','hound'],
    desc:'锯末堆到膝盖，成捆的板材还没上货架——锯片还挂在机器上。' }),
};

export const BIOME_INFO: Record<string, { name: string; color: string; passable: boolean }> = {
  city:       { name:'市区',   color:'#3b4152', passable:true },
  suburb:     { name:'郊区',   color:'#33403a', passable:true },
  industrial: { name:'工业区', color:'#4a4038', passable:true },
  forest:     { name:'林地',   color:'#2b3a2c', passable:true },
  farm:       { name:'农田',   color:'#3d3a24', passable:true },
  water:      { name:'水域',   color:'#1d2c3e', passable:false },   // 走路不行，但可以游（M7）
  ruins:      { name:'废墟',   color:'#3a3138', passable:true },
  military:   { name:'军事区', color:'#40352c', passable:true },
  highway:    { name:'公路',   color:'#2e3238', passable:true },
};
