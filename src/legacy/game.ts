// @ts-nocheck —— v3.0 的单文件代码整体搬进这里当底座，逐块迁出到 src/v4/*。
// 不要在这个文件里加新功能：新东西写进 src/v4/，通过 window 上的名字与这里互操作。
// M25 例外：辐射的分档/累积公式在 src/v4/rad-core.ts（纯逻辑、可单测），这里只 import 公式，不重复实现。
import { radTier, radGain, radLevelAt, radProtect, RAD_SOURCES, geigerText } from '../v4/rad-core';
import { CALIBERS, penMul, apKillOnArmored, ammoTable, pickLoadedAmmo, ammoShortName, resolveAmmoId, legacyAmmoFold } from '../v4/ammo-core';
import { MERCHANT_GOODS, badShopRows, shopPrice, ammoShopRows, buyPlan,
  sellPlan, sellValue, sellBatchPlan, sellBatchQuote, sellBlockReason, canSell, ITEM_BASE, SELL_RATE } from '../v4/shop-core';   // M32b/M39：货架（弹药按口径卖）+ 坏货架兜底 + 批量购买；M44：收购（把多余的东西卖回去）
import { apCapOf, fitnessApBonus, phaseOf, PHASE_LABEL } from '../v4/night-core';   // M25.2：行动力上限（睡眠债 + 体能）；M25.3：白昼曲线
import { resumeFromOver, endDayLabel, endGoalChip, winContinuePatch } from '../v4/endless-core';   // M37/M51：通关 → 无尽延续的纯逻辑
import { filterTabs, filterInv, dropCount, depositCount, quickSlots, quickPick, BAG_FILTERS, type BagFilter } from '../v4/qol-core';   // M38：背包筛选/分批丢弃·存入 + 补给快捷键
import { exportSaveText, importSaveText, parsePortText, portSummary, passphraseIssue, passphraseWeak, portSizeKb, portFileName, PORT_MAGIC } from '../v4/save-port-core';   // M39：口令加密导出/导入
import { backupLabel, BACKUP_SLOTS } from '../v4/backup-core';   // M39：备份历史（标签与份数）
import { snapshotScroll, restoreScroll, keepOffsets, shouldStickToBottom, nextLogFollow, isAwayKey, isBackKey } from '../v4/scroll-keep';   // M43：刷新时保住滚动位置；M49：日志跟随按玩家意图判
import { BASE_SECTIONS, scaledCost as coreScaledCost, defMaxOf, raidChance, raidGuaranteed, abandonCost, waterYield, nightlyYield, trapCap, verdictOf, missingFor, adviseBuilds, facilityDelta } from '../v4/base-core';   // M54：据点系统的算式与建议（纯逻辑，唯一真值）
import { starvationTick, sleepHealMul, nightConsumption, sleepWarning } from '../v4/hunger-core';   // M55：饥饿/脱水的夜间结算（堵住"只睡觉速通"）
import { fleeChanceOf, fleeFailPlan } from '../v4/flee-core';     // M56：逃跑成功率（连试递减）与失败代价
import { DECOYS, planDecoy } from '../v4/decoy-core';             // M56：避战道具（气味引诱器三档）
import { causeOfDeath, highlightsOf, adviceOf, mergeBest, bestLine, type BestRun } from '../v4/recap-core';   // M57：死亡结算（死因/瞬间/建议/生涯最好）
/** M57：本机生涯记录（评分 / 天数 / 击杀三项各自比，存 localStorage；不写进存档 —— 重开不该抹掉历史） */
const BEST_KEY = 'zsv-best-v1';
function readBestRun(){
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if(!raw) return null;
    const o = JSON.parse(raw);
    if(!o || typeof o !== 'object') return null;
    return { score: Math.max(0, Math.floor(+o.score || 0)), days: Math.max(0, Math.floor(+o.days || 0)), kills: Math.max(0, Math.floor(+o.kills || 0)) } as BestRun;
  } catch(e){ return null; }
}
function writeBestRun(b){
  try { localStorage.setItem(BEST_KEY, JSON.stringify(b)); } catch(e){ /* 隐私模式忽略 */ }
}
import { seasonOf } from '../v4/env-core';   // M54：据点产出要按季节/天气算（鱼塘冬天减产）
import { POND_FEED_ITEMS } from '../v4/water-core';


/* ═══════════ legacy/00-data.js ═══════════ */

"use strict";
/* ═══════════════════════════════════════════════════════════════
   丧尸末日生存 v2.0 · 余烬
   单文件生存模拟：行动力 / 饥饿口渴 / 感染 / 武器 / 无声战术 /
   据点建设 / 制作 / 技能 / 区域搜刮 / 多目标战斗 / 主线与结局
   ═══════════════════════════════════════════════════════════════ */

/* ───────────── 数据层 ───────────── */
const VER = 2, SAVE_KEY = 'zombie_survival_save_v2', V1_KEY = 'zombie_survival_save';

// 物品：t 类型 food|drink|med|mat|wpn|gear|thr|key
const ITEMS = {
  // 食物 / 饮水
  can:      {n:'罐头',      t:'food',  w:1.0, hun:30, desc:'保质期长到不像是末日前生产的。'},
  biscuit:  {n:'压缩饼干',  t:'food',  w:0.3, hun:16, desc:'干、硬、能填肚子。'},
  jerky:    {n:'肉干',      t:'food',  w:0.2, hun:13, desc:'来源不明，别问。'},
  choco:    {n:'巧克力',    t:'food',  w:0.2, hun:10, sta:8, desc:'热量与一点久违的多巴胺。'},
  water:    {n:'净水',      t:'drink', w:1.5, thi:35, desc:'用滤芯和煮沸换来的干净水。'},
  dirty:    {n:'污水',      t:'drink', w:1.5, thi:18, infect:5, sick:.22, desc:'喝下去解渴，也可能解掉你的命。'},
  cola:     {n:'汽水',      t:'drink', w:0.8, thi:20, hun:5, desc:'气泡早就跑光了，甜味还在。'},
  // 医疗
  bandage:  {n:'绷带',      t:'med',   w:0.2, heal:15, cure:'bleed', cureWound:'bleed', desc:'止血、包扎，一次性。'},
  medkit:   {n:'急救包',    t:'med',   w:1.0, heal:50, cure:'bleed', cureWound:'bleed', desc:'缝合针、酒精、止痛药。'},
  painkiller:{n:'止痛药',   t:'med',   w:0.1, sta:45, heal:5, desc:'压住疼痛，让你还能跑。'},
  anti:     {n:'抗生素',    t:'med',   w:0.1, infect:-25, cureWound:'sick', clearCond:'respiratory', desc:'压制体内病毒的增殖；呼吸道感染也靠它。'},
  /* M50：真菌感染以前**没有药**（cure 文案里写着"抗真菌药"，可这件东西游戏里不存在，
     玩家只能等湿度回落自己消退）。用户报障：「真菌感染…也无法治疗」。 */
  fungicide:{n:'抗真菌药',  t:'med',   w:0.15, clearCond:'fungal', desc:'压制真菌感染——闷湿季里最值钱的一小盒。'},
  serum:    {n:'抗病毒血清',t:'med',   w:0.3, infect:-60, desc:'实验室级别的抑制剂，极稀有。'},
  antitoxin:{n:'解毒剂',    t:'med',   w:0.2, cure:'poison', desc:'中和毒素，别等到咳血。'},
  /* M31：人体伤病治疗链的新东西（急救 → 手术 → 康复）。
     注意「夹板」在老物品表里已经有（cureWound:'fracture'），**不要重复定义** ——
     重复 id 会被"物品 id 不重复"的单测当场抓住。 */
  burncream:{n:'烧伤药膏',  t:'med',   w:0.2, heal:8, desc:'涂在烧伤上：止疼、防感染（烧伤的急救手段）。'},
  suture:   {n:'缝合包',    t:'med',   w:0.3, heal:10, desc:'针、线、酒精：处理大出血与贯穿伤的手术器械。'},
  surgerykit:{n:'手术包',   t:'med',   w:0.8, heal:15, desc:'成套器械：骨折复位、贯穿清创。医疗技能越高成功率越高。'},
  antiseptic:{n:'消毒剂',   t:'med',   w:0.3, desc:'清创用：把感染伤口洗干净再缝合（感染伤口的手术手段）。'},
  // 材料
  cloth:    {n:'布料',      t:'mat',   w:0.3, desc:'从窗帘和尸体上剪下来的。'},
  metal:    {n:'铁片',      t:'mat',   w:0.8, desc:'拆自车门与通风管。'},
  tape:     {n:'胶带',      t:'mat',   w:0.2, desc:'末日里的万能缝合线。'},
  powder:   {n:'火药',      t:'mat',   w:0.2, desc:'复装弹药的必需品。'},
  /* M25 弹药（参考塔科夫：口径分开 + 穿透等级）
     pen = 穿透等级（0~6）；armor 高的目标（装甲丧尸/暴君）只有高穿透弹打得动。
     dmgMul = 这一发本身的伤害系数（空尖弹打无甲更疼、穿甲弹打无甲略亏）。 */
  a9_fmj:   {n:'9mm FMJ',    t:'ammo', w:0.012, cal:'c9',   pen:2, dmgMul:1,    desc:'9×19 普通弹。便宜、量大，打不动硬壳。'},
  a9_ap:    {n:'9mm AP',     t:'ammo', w:0.012, cal:'c9',   pen:4, dmgMul:1.05, desc:'9×19 穿甲弹。钢芯，贵，但能啃开护甲。'},
  a12_buck: {n:'12号鹿弹',   t:'ammo', w:0.045, cal:'c12',  pen:1, dmgMul:1,    desc:'霰弹。近距离威力大，穿透几乎为零。'},
  a12_slug: {n:'12号重弹头', t:'ammo', w:0.05,  cal:'c12',  pen:3, dmgMul:1.3,  desc:'独头弹。一发一个洞，能打穿薄钢板。'},
  a556_fmj: {n:'5.56 FMJ',   t:'ammo', w:0.012, cal:'c556', pen:3, dmgMul:1,    desc:'小口径步枪弹。射速快、后坐小。'},
  a556_ap:  {n:'5.56 AP',    t:'ammo', w:0.012, cal:'c556', pen:5, dmgMul:1.12, desc:'5.56 穿甲弹。军用级，专治装甲。'},
  a762_fmj: {n:'7.62 FMJ',   t:'ammo', w:0.016, cal:'c762', pen:3, dmgMul:1.08, desc:'中间威力弹。肉多、便宜。'},
  a762_ap:  {n:'7.62 AP',    t:'ammo', w:0.016, cal:'c762', pen:5, dmgMul:1.2,  desc:'7.62 穿甲弹。'},
  a308_m:   {n:'7.62N 竞赛', t:'ammo', w:0.02,  cal:'c308', pen:4, dmgMul:1.15, desc:'全威力竞赛弹。精度与穿透兼顾。'},
  a308_ap:  {n:'7.62N 穿甲', t:'ammo', w:0.022, cal:'c308', pen:6, dmgMul:1.35, desc:'狙击级穿甲弹。目前能打穿一切的东西。'},
  /* M25 辐射相关的药 */
  iodine:   {n:'碘片',      t:'med',   w:0.05, rad:-25, desc:'抢在甲状腺吸收放射性碘之前吃下去。'},
  radaway:  {n:'抗辐射药',  t:'med',   w:0.15, rad:-55, desc:'螯合剂，把体内的放射性核素排出去。'},
  geiger:   {n:'盖革计数器',t:'gear',  w:0.4, slot:'trinket', geiger:true, desc:'咔哒声越密，说明你离死越近。'},
  wood:     {n:'木料',      t:'mat',   w:1.0, desc:'燃料、加固、也能当棍子。'},
  chip:     {n:'电子元件',  t:'mat',   w:0.1, desc:'拆自收音机与旧手机。'},
  chem:     {n:'化学药剂',  t:'mat',   w:0.4, desc:'标签早被腐蚀了，谨慎使用。'},
  fuel:     {n:'汽油',      t:'mat',   w:1.6, desc:'燃烧瓶的灵魂。'},
  bottle:   {n:'空瓶',      t:'mat',   w:0.4, desc:'玻璃瓶，装什么由你决定。'},
  // 投掷物
  molotov:  {n:'燃烧瓶',    t:'thr',   w:1.2, dmg:48, area:true,  desc:'对全体敌人造成伤害并点燃。'},
  grenade:  {n:'手雷',      t:'thr',   w:0.9, dmg:70, area:true,  desc:'军方遗留，清场利器。'},
  smoke:    {n:'烟雾弹',    t:'thr',   w:0.5, escape:true, desc:'保证脱离战斗，无声。'},
  /* M56：避战道具（用户：「气味引诱器…分等级，简易的引走普通僵尸，高阶的赶走高级僵尸」「可以找到或者自己做」）
     规则在 v4/decoy-core：够档的最低档自动生效，引不走的**不消耗**；血月/守夜战/决战无效。 */
  decoy1:   {n:'简易气味引诱器', t:'thr', w:0.4, decoy:1, desc:'腐肉与布料扎的臭味包：把普通丧尸引开（工作台可做，超市仓库能搜到）。'},
  decoy2:   {n:'强力气味引诱器', t:'thr', w:0.5, decoy:2, desc:'浓缩化学臭味：进阶丧尸（壮汉/毒尸/猎犬/喷吐者）也扛不住（医疗台可做）。'},
  decoy3:   {n:'军用信息素诱饵', t:'thr', w:0.6, decoy:3, desc:'军用级配方：精英与暴君都会转身离开（弹药台高阶可做，军方检查站能搜到）。'},
  // 武器
  crowbar:  {n:'撬棍',      t:'wpn',   w:2.0, dmg:14, sta:7,  crit:.08, noise:0,   desc:'开局的老伙计。无声、耐用。'},
  machete:  {n:'砍刀',      t:'wpn',   w:1.5, dmg:23, sta:9,  crit:.18, noise:0,   desc:'开山刀，劈砍顺手，容易出血。'},
  axe:      {n:'消防斧',    t:'wpn',   w:3.0, dmg:34, sta:16, crit:.12, noise:.5,  desc:'破拆工具，对装甲丧尸也有效。', apen:true},
  pistol:   {n:'手枪',      t:'wpn',   w:1.2, dmg:21, ammo:1,  cal:'c9',   crit:.15, noise:3,   desc:'9×19，可靠、但很吵。'},
  shotgun:  {n:'霰弹枪',    t:'wpn',   w:3.5, dmg:46, ammo:3,  cal:'c12',  crit:.10, noise:5,   desc:'近距离一枪断头；吃弹快（3 发/次），定位是清场而不是续航。'},
  rifle:    {n:'突击步枪',  t:'wpn',   w:3.2, dmg:26, ammo:1,  cal:'c556', crit:.30, noise:4,   desc:'点射压制，靠暴击吃饭（每发 26 伤害、暴击率最高）。'},
  marksman: {n:'精准步枪',  t:'wpn',   w:4.0, dmg:64, ammo:3,  cal:'c308', crit:.32, noise:5,   desc:'拉栓一声，远处的脑袋就没了。'},
  // 装备
  gasmask:  {n:'防毒面具',  t:'gear',  w:0.6, slot:'mask', gasImmune:true, radProt:.25, desc:'免疫毒气丧尸的毒雾，滤罐也能滤掉一部分放射性尘埃（-25%）。'},
  hazmat:   {n:'防化服',    t:'gear',  w:3.5, slot:'body', dmgCut:.4, radProt:.6, desc:'僵尸伤害 -40%、辐射 -60%，但闷热笨重。'},
  vest:     {n:'战术背心',  t:'gear',  w:2.5, slot:'body', armor:2, desc:'护甲 +2。'},
  kevlar:   {n:'防弹衣',    t:'gear',  w:6.0, slot:'body', armor:5, desc:'护甲 +5，很重。'},
  helmet:   {n:'战术头盔',  t:'gear',  w:1.5, slot:'head', armor:1, critCut:.5, desc:'护甲 +1，被爆头的概率减半。'},
  boots:    {n:'军靴',      t:'gear',  w:1.0, slot:'feet', dodge:.08, desc:'闪避 +8%，跑得稳。'},
  backpack: {n:'军用背包',  t:'gear',  w:1.0, slot:'bag',  cap:40, desc:'负重上限 +40。'},
  // 剧情
  keycard:  {n:'门禁卡碎片',t:'key',   w:0.1, desc:'破坏伞公司的生物识别卡，缺了三块中的一块就毫无意义。'},
  /* M30：湿度计的预报道具（用户点名要的"工作台里加一个天气预报类的东西"）。
     用一次看三天：哪天有雨（能接水/会淋湿）、哪天干燥（中暑脱水）、哪天寒潮。 */
  hygro:    {n:'湿度计',    t:'gear', w:0.4, forecast:true, desc:'玻璃管里的水银柱。用它看一眼未来三天的湿度走势：该备水还是该备柴，一眼就知道。'},
  data:     {n:'实验数据',  t:'key',   w:0.1, desc:'“方舟”第 6 层的读取记录，能证明解药配方是真的。'},
  cure:     {n:'解药',      t:'key',   w:0.2, desc:'淡蓝色的液体，在灯下像活的一样。'},
  flare:    {n:'信号枪',    t:'mat',   w:0.6, desc:'打出一发红色信号弹。第 90 天之后的撤离点靠它叫人来接。'},   // v4.0：撤离结局（C07）
};
const itemName = id => (ITEMS[id] ? ITEMS[id].n : id);
const isWpn = id => ITEMS[id] && ITEMS[id].t === 'wpn';

// 丧尸：arm 为“对枪械减伤”，apenMelee 表示近战穿透
const ZOMBIES = {
  walker:  {n:'普通丧尸', hp:24, dmg:6,  spd:1,   xp:5,  bite:.12, loot:{cloth:.4, metal:.2, can:.12, dirty:.15}, desc:'行动迟缓、数量众多。'},
  crawler: {n:'爬行者',   hp:16, dmg:7,  spd:1,   xp:6,  bite:.10, dodge:.22, loot:{cloth:.4, bottle:.2, chip:.1}, desc:'贴地爬行，很难打中要害。'},
  runner:  {n:'奔跑者',   hp:19, dmg:9,  spd:2,   xp:9,  bite:.14, bleed:true, loot:{cloth:.3, choco:.2, tape:.2}, desc:'速度极快，每回合攻击两次。'},
  hound:   {n:'变异猎犬', hp:22, dmg:11, spd:2.5, xp:11, bite:.18, bleed:true, armor:1, loot:{meat:.5, jerky:.12, metal:.2}, desc:'成群狩猎，扑咬会撕裂伤口。肉能吃——如果烤过。'},
  brute:   {n:'重型丧尸', hp:48, dmg:14, spd:1,   xp:15, bite:.10, loot:{metal:.5, fuel:.2, powder:.2}, desc:'体型庞大，生命力顽强。'},
  poison:  {n:'毒气丧尸', hp:40, dmg:9,  spd:1,   xp:18, poison:true, loot:{chem:.5, anti:.15, tape:.2}, desc:'持续释放毒雾，无面具就会中毒。'},
  screamer:{n:'尖叫者',   hp:14, dmg:4,  spd:2,   xp:10, summon:.5, loot:{chip:.3, cloth:.2}, desc:'尖叫声会招来更多丧尸。'},
  /* M25 穿透：armor 是"装甲等级"，只有 pen 够高的弹才算打得动（参考塔科夫）。
     armGun/armMelee 仍保留作为"整体减伤"（暴君这种靠体型硬吃的），两者相乘。 */
  armored: {n:'装甲丧尸', hp:62, dmg:17, spd:.8,  xp:22, armor:5, armMelee:.75, keycard:.34, loot:{metal:.6, powder:.25, kevlar:.05, a556_ap:.06}, desc:'枪弹难穿，需要穿甲弹或破甲武器。'},
  giant:   {n:'巨型丧尸', hp:78, dmg:21, spd:1.2, xp:28, armor:2, armGun:.2, bite:.2, loot:{chem:.3, fuel:.3, serum:.08, meat:.2}, desc:'两米五的变异体，一巴掌能让人断气。'},
  // v4.0：大世界里"活人"也是威胁（拾荒者据点/路上遭遇用）。数值上比同级丧尸更脆但更会打枪。
  bandit:  {n:'拾荒者',   hp:34, dmg:12, spd:1.4, xp:16, armor:2, bite:.06, loot:{ammo:.35, metal:.25, bandage:.2, pistol:.06, kevlar:.08}, desc:'和你一样的人，只是先动了手。'},
  // M7：水下遭遇（沉没基地潜水时出现，水里比人快）
  drowned: {n:'溺亡者',   hp:36, dmg:11, spd:1.2, xp:18, armor:1, bite:.18, loot:{cloth:.3, chem:.2, chip:.15, o2:.12}, desc:'泡得发白的东西，在水里比人快。'},
  // M11 三种"要动脑子打"的：数值不是重点，机制才是（机制由 v4 引擎的 traits 实现，见 bridge.ts）
  spitter: {n:'喷吐者',   hp:30, dmg:8,  spd:1.2, xp:20, armor:1, loot:{chem:.45, anti:.2, chip:.15, tape:.2},
    desc:'喉咙鼓成一个囊，隔着五米把酸液吐过来——格挡挡不住，护甲会被啃薄。'},
  bomber:  {n:'自爆者',   hp:20, dmg:5,  spd:1.5, xp:16, loot:{powder:.4, fuel:.25, metal:.2, chip:.12},
    desc:'肚子撑得发亮，走得摇摇晃晃。它死了会炸——除非你先用火烧掉它。'},
  hatcher: {n:'孵化者',   hp:56, dmg:7,  spd:.8,  xp:24, armor:2, loot:{chem:.3, serum:.1, cloth:.3, chip:.2},
    desc:'行动迟缓的肉囊，每两回合撑破一个口子，爬行者就从里面钻出来。'},
  tyrant:  {n:'暴君',     hp:140, dmg:22, spd:1.5, xp:60, boss:true, armor:4, armGun:.15, armMelee:.3, bite:.25,
    loot:{serum:.35, kevlar:.25, powder:.3, marksman:.12, medkit:.3},
    desc:'三米高，肩膀顶穿天花板。打到一半它会彻底不管不顾。'},
};

// 区域：d 危险等级，req 解锁条件，enemies 权重表
const ZONES = {
  hospital: {n:'圣玛丽医院', d:'1', icon:'🏥', desc:'你苏醒的地方。药房和急诊室里还有东西。',
    enemies:['walker','walker','crawler','screamer'], loot:{cloth:.35, bandage:.3, anti:.18, painkiller:.2, chem:.12, decoy2:.12},
    first:{item:'bandage', n:3, log:'你在护士站的抽屉里翻出几卷还能用的绷带。'}, lore:['l_the_one']},
  police:   {n:'第 9 分局', d:'2', icon:'🚓', desc:'枪柜被撬过，但总有漏网的。',
    enemies:['walker','brute','crawler','hound'], loot:{metal:.3, powder:.3, pistol:.1, shotgun:.06, tape:.2},
    first:{item:'pistol', n:1, ammo:12, log:'枪柜底层卡着一把手枪和一小盒子弹。'}, lore:['l_military']},
  market:   {n:'惠民超市', d:'2', icon:'🛒', desc:'货架被扫空过一遍，但仓库深处没人动过。',
    enemies:['runner','walker','hound','runner'], loot:{can:.4, water:.3, biscuit:.3, cola:.2, dirty:.15, decoy1:.18},
    first:{item:'can', n:2, log:'仓库的铁门还能推开，里面堆着没开封的罐头。'}, lore:['l_outbreak']},
  oldtown:  {n:'老城区', d:'2', icon:'🏚️', desc:'塌了一半的居民楼，钢筋和木料遍地。',
    enemies:['walker','crawler','brute','hound'], loot:{wood:.4, metal:.3, cloth:.3, tape:.2, chip:.12},
    first:{item:'wood', n:4, log:'你从倒塌的房梁上抽出一堆干燥木料。'}, lore:['l_survivors']},
  gas:      {n:'城西加油站', d:'3', icon:'⛽', desc:'油罐还没漏光，但这里的气味引来了东西。',
    enemies:['hound','runner','brute','poison'], loot:{fuel:.4, bottle:.3, powder:.2, molotov:.12},
    first:{item:'molotov', n:2, log:'便利店里凑齐了瓶子和汽油——你顺手做了两个燃烧瓶。'}, lore:['l_tech']},
  subway:   {n:'地铁三号线', d:'3', icon:'🚇', desc:'漆黑、潮湿、回声很大。毒气在隧道里积着不散。',
    enemies:['poison','crawler','giant','walker','armored'], loot:{chem:.4, chip:.2, metal:.2, gasmask:.1, serum:.05, keycard:.08, decoy1:.14},
    first:{item:'gasmask', n:1, log:'检修间挂着一具防毒面具，滤罐还有余量。'}, lore:['l_virus']},
  military: {n:'军方检查站', d:'4', icon:'🪖', desc:'“净空协议”的边缘。装甲丧尸在这里游荡。',
    enemies:['armored','brute','screamer','hound'], loot:{kevlar:.12, rifle:.1, marksman:.05, powder:.35, metal:.3, grenade:.1, keycard:.1, chip:.2, decoy3:.14},
    first:{item:'hazmat', n:1, log:'检查站的更衣帐篷里挂着一套完整的防化服，尺码刚好。'}, lore:['l_company']},
  lab:      {n:'方舟实验室外围', d:'5', icon:'☣️', desc:'通风井在往外吐白雾。往下的每一层都写着“别进去”。',
    req:{quest:5}, enemies:['giant','armored','poison','hound'], loot:{serum:.2, chem:.35, powder:.25, medkit:.2},
    first:{item:'hazmat', n:1, log:'更衣间的柜子里挂着一套完整的防化服。'}, lore:['l_lab']},
};

// 据点升级：lvl 上限，cost 为每级材料
const BASE_UP = {
  door:    {n:'加固门窗', icon:'🚪', max:3, cost:{wood:4, metal:3},  desc:'夜间尸潮伤害减免，每级 -25%。'},
  bed:     {n:'行军床',   icon:'🛏️', max:3, cost:{cloth:4, wood:2},  desc:'睡觉恢复更多生命与体力。'},
  filter:  {n:'净水装置', icon:'🚰', max:3, cost:{metal:3, chip:2, tape:1}, desc:'每天产出净水，等级越高越多。'},
  garden:  {n:'屋顶菜园', icon:'🌱', max:3, cost:{wood:2, cloth:1, can:1},  desc:'每天产出食物。'},   // M6/P03：起步价（木2/布1/罐头1），第 3~5 天就能建起来
  bench:   {n:'工作台',   icon:'🛠️', max:3, cost:{metal:3, wood:2, tape:1}, desc:'基础制作：绷带、胶带、燃烧瓶、手雷。等级越高配方越多。'},
  /* M25：藏身处式分工站（用户："工作台能做的东西太少了，增加不同种类的工作台"）——
     每个站只管自己那一类活，等级决定深度配方；发电机是全局增益（不是配方站）。 */
  loading: {n:'弹药台',   icon:'🔩', max:3, cost:{metal:4, wood:2, tape:2}, desc:'复装与改装弹药：普通弹、穿甲弹、独头弹。'},
  medlab:  {n:'医疗台',   icon:'⚗️', max:3, cost:{metal:3, chip:2, chem:2}, desc:'制药：急救包、解毒剂、碘片、抗辐射药。'},
  kitchen: {n:'灶台',     icon:'🍳', max:3, cost:{metal:3, cloth:1, wood:3}, desc:'把生食做熟、批量煮水、风干肉——熟食回得更多也更抗腐坏。'},
  power:   {n:'发电机',   icon:'🔋', max:2, cost:{metal:6, chip:4, fuel:2}, desc:'通电后：净水装置 +1 产出、菜园生长快 1 天、医疗台制作 +1 份。'},
  storage: {n:'储物箱',   icon:'📦', max:3, cost:{metal:3, wood:3},  desc:'提供基地储物格，离家时不用背着。'},
  radio:   {n:'无线电',   icon:'📻', max:1, cost:{chip:3, metal:3, tape:2}, desc:'解锁“方舟实验室”坐标与更多商人来访。'},
  wall:    {n:'围墙工事', icon:'🧱', max:2, cost:{wood:6, metal:5},  desc:'尸潮时提供掩体，减少资源损失。'},
  pond:    {n:'鱼塘',     icon:'🐟', max:3, cost:{wood:4, cloth:2, metal:1}, desc:'每天产鱼；投喂鱼饵/蔬菜能翻倍，冬天减产。'},   // M7：水产养殖
};

/* M25 弹药口径/穿透：口径表、弹种表、装载选择、穿透算法全部在 v4/ammo-core.ts —— 
   同一套规则 v4 引擎（combat.ts 的 PlayerProfile.pen）也要用，放在这里就会算出两个数。 */
const AMMO_OF = ammoTable(ITEMS as any);                     // 按口径分好组、按穿透升序
/** 当前给这个口径装的是哪种弹：玩家在「弹药」里选过就用选的，否则自动挑穿透最高且有货的 */
function loadedAmmo(cal){
  return pickLoadedAmmo(AMMO_OF[cal] || [], S.inv || {}, S.load, cal);
}
const ammoCount = () => { let n = 0; for(const id in ITEMS){ const it = ITEMS[id]; if(it.t === 'ammo') n += S.inv[id] || 0; } return n; };
/** 当前武器口径（没枪/枪不吃子弹就是 null） */
const curCal = () => { const wid = S.eq.wpn, w = wid && ITEMS[wid]; return (w && w.cal) ? w.cal : null; };
/** M32b：S.ammo 是"当前装填弹种发数"的镜像（v4 引擎的 syncBack 靠它算这一轮打掉几发），
    所以**任何**背包弹药变动之后都要重算一次，否则它就是个死数（旧版商人卖弹就是这个坑）。 */
function syncAmmo(){
  const cal = curCal();
  S.ammo = cal ? itemCount(loadedAmmo(cal) || '') : ammoCount();
}
/** M32b：把旧的"笼统弹药池"落成真弹（只在开新档 / v1 迁移时用；存档里的旧池子由 sanitizeSave 折算） */
function materializeAmmoPool(){
  const pool = Math.floor(S.ammo || 0);
  if(pool > 0) addItem(resolveAmmoId('ammo', ITEMS, curCal()), pool, true);
  syncAmmo();
}
/** M25：切换某个口径装填的弹种（背包里点）——穿透更高的弹打装甲目标，便宜的弹打普通丧尸 */
function setLoaded(cal, id){
  if(!S.load) S.load = {};
  S.load[cal] = id;
  const it = ITEMS[id];
  log('🔩 ' + CALIBERS[cal].n + ' 换装：' + (it ? it.n : id) + '（穿透 ' + (it ? it.pen : 0) + '）', 'info');
  syncAmmo();                                   // M32b：换弹种 = 换 mirror（否则 HUD 还显示上一种的数量）
  render(); autosave();
}
/** M25：HUD 点弹药 chip = 在当前口径的弹种之间循环（不用翻背包） */
function cycleLoaded(){
  const wid = S.eq.wpn;
  const cal = wid && ITEMS[wid] && ITEMS[wid].cal;
  if(!cal){ log('❌ 手上的家伙不吃子弹。','dim'); return; }
  const list = (AMMO_OF[cal] || []).filter(a => (S.inv[a.id] || 0) > 0);
  if(list.length < 2){ log('🔩 这个口径只有' + (list.length ? '一种' : '零种') + '弹，没得换。','dim'); return; }
  const cur = loadedAmmo(cal);
  const i = list.findIndex(a => a.id === cur);
  setLoaded(cal, list[(i + 1) % list.length].id);
}
/** M25：背包里的弹药区 —— 每个口径一行，点弹种就换装（参考塔科夫的弹种分层） */
function ammoSectionHtml(){
  const cals = Object.keys(CALIBERS).filter(c => (AMMO_OF[c] || []).some(a => (S.inv[a.id] || 0) > 0));
  if(!cals.length) return '';
  const wid = S.eq.wpn;
  const curCal = wid && ITEMS[wid] && ITEMS[wid].cal;
  let h = '<div class="sect-title">弹药 <span class="badge">按口径分装</span></div>';
  h += '<p class="hint" style="margin-bottom:8px">同一口径可以有多种弹：<b>穿透 ≥ 目标装甲才打满伤害</b>（装甲丧尸 5、暴君 4）。打普通丧尸用便宜弹就够，遇到硬壳再换穿甲弹。</p>';
  cals.forEach(cal => {
    const list = (AMMO_OF[cal] || []).filter(a => (S.inv[a.id] || 0) > 0);
    const picked = loadedAmmo(cal);
    h += '<div class="card" style="padding:10px;margin-bottom:8px">' +
      '<div class="row"><span class="nm">' + CALIBERS[cal].n + '</span>' +
      (cal === curCal ? '<span class="tag eq">当前武器口径</span>' : '') +
      '<span class="spacer"></span><span class="hint">' + list.reduce((a, x) => a + (S.inv[x.id] || 0), 0) + ' 发</span></div><div class="grid g2" style="margin-top:6px">';
    list.forEach(a => {
      const it = ITEMS[a.id], on = a.id === picked;
      const good = a.pen >= 4;
      h += '<div class="lrow" style="align-items:center"><div><div class="nm">' + it.n + '</div>' +
        '<div class="ds">穿透 <b style="color:' + (good ? 'var(--warn)' : 'var(--dim)') + '">' + a.pen + '</b> · 伤害 ×' + (a.dmgMul || 1) +
        ' · <span class="mono">' + (S.inv[a.id] || 0) + ' 发</span></div></div><div class="rt">' +
        '<button class="btn xs ' + (on ? 'warn' : 'ok') + '" onclick="setLoaded(\'' + cal + '\',\'' + a.id + '\')">' + (on ? '已装填' : '装填') + '</button>' +
        '</div></div>';
    });
    h += '</div></div>';
  });
  return h;
}

// 制作配方：st = 哪个站，lv = 该站等级要求（老档没 st 的都归工作台）
const RECIPES = [
  {out:'bandage',  n:2, need:{cloth:2},                 st:'bench', lv:0, desc:'撕成条，煮沸，晾干。'},
  {out:'water',    n:1, need:{dirty:2, wood:1},         st:'bench', lv:0, desc:'煮沸消毒，去掉大部分病原。'},
  {out:'molotov',  n:1, need:{bottle:1, fuel:1, cloth:1}, st:'bench', lv:1, desc:'布条塞瓶口，点火就扔。'},
  {out:'tape',     n:1, need:{cloth:1, chem:1},         st:'bench', lv:1, desc:'劣质胶带，但能粘住东西。'},
  {out:'medkit',   n:1, need:{bandage:2, anti:1, tape:1}, st:'bench', lv:2, desc:'凑齐一套急救物资。'},
  {out:'grenade',  n:1, need:{powder:3, metal:2, tape:1}, st:'bench', lv:3, desc:'自制破片手雷，威力有限但够用。'},
  /* M56：避战道具（三档，越高档越能引走狠角色） */
  {out:'decoy1',   n:2, need:{cloth:2, rot:1},  st:'bench', lv:0, desc:'简易气味引诱器 ×2：把普通丧尸引开（腐坏食物就是最好的臭源）。'},
  {out:'decoy2',   n:2, need:{chem:2, cloth:2, tape:1}, st:'medlab', lv:1, desc:'强力气味引诱器 ×2：进阶丧尸也扛不住（化学药剂浓缩臭味）。'},
  {out:'decoy3',   n:2, need:{powder:2, chem:2, chip:1, cloth:1}, st:'loading', lv:3, desc:'军用信息素诱饵 ×2：精英与暴君都会转身离开。'},
  /* ── 弹药台：复装（参考塔科夫的"弹种"分层） ── */
  {out:'a9_fmj',   n:12, need:{powder:2, metal:1},       st:'loading', lv:0, desc:'9mm 复装弹 ×12，打普通丧尸够用。'},
  {out:'a556_fmj', n:12, need:{powder:3, metal:2},       st:'loading', lv:1, desc:'5.56 复装弹 ×12。'},
  {out:'a762_fmj', n:12, need:{powder:3, metal:2},       st:'loading', lv:1, desc:'7.62 复装弹 ×12，肉多。'},
  {out:'a12_buck', n:8,  need:{powder:3, metal:1, tape:1}, st:'loading', lv:1, desc:'12 号鹿弹 ×8，清场用。'},
  {out:'a9_ap',    n:8,  need:{powder:3, metal:3, chip:1}, st:'loading', lv:2, desc:'9mm 穿甲弹 ×8：钢芯，能啃装甲。'},
  {out:'a556_ap',  n:8,  need:{powder:4, metal:3, chip:1}, st:'loading', lv:2, desc:'5.56 穿甲弹 ×8。'},
  {out:'a762_ap',  n:8,  need:{powder:4, metal:3, chip:1}, st:'loading', lv:3, desc:'7.62 穿甲弹 ×8。'},
  {out:'a308_m',   n:6,  need:{powder:4, metal:3, chip:2}, st:'loading', lv:3, desc:'7.62N 竞赛弹 ×6：精准与穿透兼顾。'},
  {out:'a12_slug', n:6,  need:{powder:4, metal:2, tape:1}, st:'loading', lv:2, desc:'12 号独头弹 ×6。'},
  {out:'a308_ap',  n:5,  need:{powder:6, metal:4, chip:3}, st:'loading', lv:3, desc:'7.62N 穿甲弹 ×5：目前能打穿一切的东西。'},
  /* ── 医疗台：制药 ── */
  {out:'painkiller', n:2, need:{chem:1, water:1},        st:'medlab', lv:0, desc:'止痛药 ×2。'},
  {out:'antitoxin', n:1, need:{chem:2, water:1},         st:'medlab', lv:1, desc:'用化学药剂中和毒素。'},
  {out:'iodine',   n:3, need:{chem:1, water:1},          st:'medlab', lv:1, desc:'碘片 ×3：进辐射区之前先吃。'},
  {out:'anti',     n:1, need:{chem:2, chip:1},           st:'medlab', lv:2, desc:'抗生素。'},
  /* M50：抗真菌药 —— 闷湿季的续命药（原来只在文案里存在） */
  {out:'fungicide',n:1, need:{chem:2, water:1},          st:'medlab', lv:1, desc:'抗真菌药：压住真菌感染，别让它拖成后遗症。'},
  {out:'radaway',  n:1, need:{chem:3, anti:1, water:1},  st:'medlab', lv:2, desc:'抗辐射药：把已经吃进去的放射核素排出去。'},
  {out:'serum',    n:1, need:{chem:3, anti:1, chip:1},   st:'medlab', lv:3, desc:'低配版病毒抑制剂。'},
  /* M31：人体伤病的手术器械（三件都在医疗台做） */
  {out:'splint',    n:2, need:{wood:1, cloth:1},          st:'bench',  lv:0, desc:'夹板 ×2：骨折急救，先固定住再想办法动手术。'},
  {out:'burncream', n:2, need:{chem:1, water:1},          st:'medlab', lv:0, desc:'烧伤药膏 ×2。'},
  {out:'suture',    n:2, need:{cloth:1, metal:1, tape:1}, st:'medlab', lv:1, desc:'缝合包 ×2：处理大出血与贯穿伤的手术器械。'},
  {out:'antiseptic',n:2, need:{chem:2, water:1},          st:'medlab', lv:1, desc:'消毒剂 ×2：感染伤口清创用。'},
  {out:'surgerykit',n:1, need:{suture:1, metal:2, tape:2, chem:1}, st:'medlab', lv:2, desc:'手术包：骨折复位 + 贯穿清创，医疗技能越高越不容易失手。'},
  /* ── 灶台：把生食做熟（熟食回得更多，而且不会吃坏肚子） ── */
  {out:'water',    n:3, need:{dirty:3, wood:1},          st:'kitchen', lv:0, desc:'一锅煮三份净水。'},
  {out:'cooked',   n:1, need:{meat:1, wood:1},           st:'kitchen', lv:0, desc:'把生肉做熟：饱食与治疗都更高。'},
  {out:'jerky',    n:2, need:{meat:2, chem:1},           st:'kitchen', lv:1, desc:'风干肉 ×2：占位小、不腐坏。'},
  {out:'stew',     n:1, need:{meat:1, veg:1, water:1},   st:'kitchen', lv:2, desc:'热炖菜：回满饱食并且压感染。'},
  /* ── M30 工作台：湿度计（天气预报） ── */
  {out:'hygro',    n:1, need:{metal:1, chem:1, tape:1},  st:'bench', lv:1, desc:'湿度计：看一眼未来三天的雨/旱/寒潮，出门前先规划。'},
];
/* M25 兼容：归一化统一由 normalizeRecipes() 负责（定义在文件后段、两批配方都加完之后）。 */

// 技能：每级效果由对应系统读取
/* M24：技能从 6 条扩到 12 条，并且**每条都有升级来源 + 分级解锁**。
   用户反馈原话："技能目前我玩到的地方完全没用途，技能也太少了" —— 之前只有 4 条技能有加经验的地方
   （体能/潜行永远是 Lv.0），而且面板上只写了一句"伤害 +6%/级"，玩家根本看不到自己现在强在哪。
   现在每条技能都有 src（怎么涨）、desc（当前值随等级变）、perks（到级解锁的硬效果）。 */
const SKILLS = {
  shoot:   {n:'射击', icon:'🎯', desc:'枪械伤害 +6%/级', src:'开枪命中/击杀', perks:[[5,'暴击伤害 +30%']]},
  melee:   {n:'近战', icon:'🔪', desc:'近战伤害 +7%/级', src:'近战命中/击杀', perks:[[5,'击杀回 5 点体力']]},
  fitness: {n:'体能', icon:'💪', desc:'负重 +6/级 · 体力上限 +5/级', src:'每走一格 +1 · 睡醒 +2', perks:[[3,'睡醒多还 1 档睡眠债']]},
  survival:{n:'生存', icon:'🔥', desc:'搜刮收益 +8%/级 · 食水消耗 -3%/级', src:'搜刮/拆解/制作', perks:[[3,'野外过夜被夜袭的概率 -25%']]},
  medic:   {n:'医疗', icon:'💉', desc:'治疗效果 +8%/级 · 感染增长 -5%/级', src:'治疗/包扎/吃药', perks:[[3,'每夜自动回 3 点生命']]},
  stealth: {n:'潜行', icon:'🌑', desc:'遭遇率 -4%/级', src:'旅行没撞上东西 +1 · 逃跑成功 +4', perks:[[6,'遭遇率再 -10%']]},
  scout:   {n:'侦查', icon:'🧭', desc:'看得更远：Lv3 视野 +1 圈，Lv6 再 +1 圈', src:'走到没去过的区块 +2', perks:[[3,'视野 +1 圈'], [6,'视野再 +1 圈']]},
  gather:  {n:'采集', icon:'🧺', desc:'采集/伐木/拆解产量 +8%/级', src:'采集/伐木/拆解 +1', perks:[[3,'每次采集额外 +1 份']]},
  cook:    {n:'厨艺', icon:'🍲', desc:'煮沸与烹饪产出 +1/2 级', src:'煮水/做饭 +3', perks:[[3,'煮沸/烹饪额外 +1']]},
  craft:   {n:'制作', icon:'🔨', desc:'制作有 10%/级 概率返还材料', src:'制作/改装 +4', perks:[[3,'返还概率翻倍（20%/级）']]},
  mechanic:{n:'机械', icon:'⚙️', desc:'修车材料 -8%/级', src:'修车/加油 +4', perks:[[3,'修车材料再 -30%'], [6,'一桶汽油 +4 油']]},
  trade:   {n:'交易', icon:'🤝', desc:'商人价格 -4%/级', src:'和商人买卖 +3', perks:[[3,'价格再 -10%']]},
};
/** 某条技能现在生效的硬效果（面板直接显示，别让玩家自己算） */
function skillNow(k){
  const lv = S.skills[k] || 0;
  const pct = (per, cap) => Math.round(Math.min(cap === undefined ? .6 : cap, lv * per) * 100);
  switch(k){
    case 'shoot':   return '枪械伤害 +' + pct(.06) + '% · 暴击率 +' + Math.round(Math.min(.15, lv * .015) * 100) + '%';
    case 'melee':   return '近战伤害 +' + pct(.07) + '% · 体力消耗 -' + Math.min(30, lv * 3) + '%';
    case 'fitness': return '负重 +' + (lv * 6) + ' · 体力上限 +' + (lv * 5);
    case 'survival':return '搜刮收益 +' + pct(.08) + '% · 食水消耗 -' + Math.min(45, lv * 3) + '%';
    case 'medic':   return '治疗效果 +' + pct(.08) + '% · 感染增长 -' + Math.min(50, lv * 5) + '%';
    case 'stealth': return '遭遇率 -' + Math.min(35, lv * 4 + (lv >= 6 ? 10 : 0)) + '%';
    case 'scout':   return '视野 ' + (1 + (lv >= 3 ? 1 : 0) + (lv >= 6 ? 1 : 0)) + ' 圈';
    case 'gather':  return '采集/伐木/拆解产量 +' + pct(.08) + '%' + (lv >= 3 ? ' · 额外 +1 份' : '');
    case 'cook':    return '煮沸/烹饪产出 +' + Math.floor(lv / 2) + (lv >= 3 ? '（含 +1）' : '');
    case 'craft':   return '制作返还材料 ' + (lv * (lv >= 3 ? 20 : 10)) + '%';
    case 'mechanic':return '修车材料 -' + Math.min(50, lv * 8 + (lv >= 3 ? 30 : 0)) + '%' + (lv >= 6 ? ' · 一桶汽油 +4 油' : '');
    case 'trade':   return '商人价格 -' + Math.min(45, lv * 4 + (lv >= 3 ? 10 : 0)) + '%';
  }
  return '';
}
/** 技能 perk 是否已解锁（到级即生效，不需要点数） */
function hasPerk(k, lv){ return (S.skills[k] || 0) >= lv; }

// 同伴
const COMPANIONS = {
  vet:     {n:'老兵 · 霍克',  dmg:9,  hp:70, desc:'每回合稳定输出，擅长枪械。'},
  nurse:   {n:'护士 · 林',    dmg:4,  hp:50, desc:'每回合为你恢复少量生命。'},
  hunter:  {n:'猎手 · 阿蛮',  dmg:7,  hp:60, desc:'提高搜刮收益，发现更多秘闻。'},
};

// 商人货架（材料计价）。M32b：表搬到 v4/shop-core.ts（纯数据 + 兜底校验，可单测）——
// 弹药从此**按口径/弹种卖**（穿甲弹更贵、量更少），不再是一个笼统的 "ammo"。
const MERCHANT = MERCHANT_GOODS;

// 秘闻（图鉴·可发现）
const LORE = [
  {id:'l_company', n:'破坏伞公司', story:'「破坏伞公司」—— 末日之前全球最大的生物科技企业。\n\n表面上是医药巨头，暗地里却在从事违法的病毒武器研究。总部设在市中心地下，拥有全球最先进的生物实验室。\n\n末日后，幸存者们传言：破坏伞公司的最高机密实验室里，保存着"芥末"病毒的唯一解药。也有人说，那是他们用来制造更可怕生物的场所……'},
  {id:'l_virus', n:'"芥末"病毒', story:'全称 "Genetically Accelerated Mutagenic Organism Transmission"，简称 G.A.M.O.T.，代号"芥末"。\n\n一种人工设计的 RNA 病毒，能大幅加速细胞分裂与突变。原本为军事目的设计——创造超级士兵。\n\n但它有个致命副作用：感染后期破坏大脑前额叶，宿主失去理性，只剩原始攻击本能。这就是"丧尸"的由来。'},
  {id:'l_lab', n:'秘密实验室「方舟」', story:'破坏伞公司最高机密实验室，代号"方舟"。\n\n位于市中心地下 200 米，共 7 层防护门，每层需要不同的生物识别信息。传闻核心区域——第 7 层——保存着"芥末"病毒的唯一解药。\n\n但最近有传言说，实验室的自动防御系统仍在运行……而且有两只特殊的巨型丧尸被锁在第 6 层，它们似乎保留着某种程度的智能。'},
  {id:'l_outbreak', n:'末日的开端', story:'X-Day，末日第一天。\n\n一切都始于"方舟"实验室的一次"轻微泄漏"。公司高层试图掩盖真相，将事故定性为"局部污染"。\n\n当第一个感染者在市中心商业区失去控制时，一切都太晚了。病毒在 72 小时内扩散全城。军队的反应太慢、太弱。一周后，通讯彻底中断。\n\n这就是"旧世界"的终结。'},
  {id:'l_evo', n:'丧尸进化论', story:'「芥末」病毒有一个令人恐惧的特性：它每隔一段时间就会发生群体性进化。\n\n大约每 5 天，所有感染者同步变异一次——更快、更强、更顽强。科学家推测这是病毒群体智能的表现。\n\n更可怕的是，这种进化似乎也影响幸存者。许多人报告身体素质同步增强……仿佛病毒也在试图"平衡"这场博弈。'},
  {id:'l_tech', n:'旧世界的科技', story:'末日之前，人类的技术已经达到惊人的高度。\n\n智能手机、人工智能、基因编辑、量子计算……但在末日面前脆弱得可笑。电网瘫痪后，一切退回了蒸汽时代之前。\n\n不过仍有"旧世界的遗产"在废墟里等着被发现——太阳能板、无线电设备、医疗扫描仪……甚至破坏伞公司遗留的武器原型。'},
  {id:'l_survivors', n:'幸存者网络', story:'末日并不意味着文明的终结。\n\n仍有大大小小的幸存者营地散落在各地，通过无线电、信使和偶尔运作的节点保持联系。\n\n这些营地各有规则与文化：有些军事化管制，有些保留着末日前的民主。他们偶尔冲突，但大多数时候明白——真正的敌人不是彼此。'},
  {id:'l_military', n:'军方最后通讯', story:'末日第 14 天，军方发出最后一段广播：\n\n"这里是『铁锤』基地。我们正在失去城市北部的控制。感染者数量预计超过百万。我们即将启动『净空协议』……愿上帝保佑我们所有人。"\n\n广播结束后，城市北部传来巨大爆炸。军方用空袭摧毁了整个城区。但即便这样，也没能阻止病毒扩散。\n\n从那以后，再无军方的任何消息……'},
  {id:'l_patient0', n:'零号病人之谜', story:'关于第一个感染者——零号病人——的信息少之又少。\n\n破坏伞公司内部档案显示，零号病人是一名 35 岁的流浪汉，被公司以"临床试验"名义招募。他注射的并不是"芥末"病毒本身，而是一种早期、不稳定的版本。\n\n有传言说，零号病人并没有死。他可能仍在某处游荡……或者，他已经进化成了某种完全不同、更可怕的东西。'},
  {id:'l_the_one', n:'医生的日记', story:'（一份在你苏醒的医院里找到的褪色日记本）\n\n"第 47 天。我是这家医院最后的医生了。\n\n今天有一个受伤的男人被送到门口。他的手臂被咬伤，但我们还是把他带了进来。我给他做了截肢，用了最后的麻醉剂。\n\n他昏迷中不停重复同一个词：『方舟』。他说那里有答案。\n\n他醒来后告诉我，他是从破坏伞公司逃出来的研究员。他说公司在地下实验室做的那些事……不是人该做的。他说解药真的存在。\n\n然后他死了。\n\n我不知道还能坚持多久。但我要把消息传下去。如果有人读到这段话——去方舟实验室，找到解药。"\n\n—— 日记的主人如今不知所踪。你把这些话记在了心里。'},
  {id:'l_ark', n:'方舟协议', story:'（无线电截获的加密通话，反复播放）\n\n"……第 6 层隔离失效，实验体 A、B 苏醒。它们会叫。\n\n重复：它们会叫。不要回应任何呼叫。\n\n如果还有活人听到这段——解药在 7 层冷柜，密码是医生工号。别带枪下去，会引来更多。"\n\n通话到此中断。信号源已经沉默了 400 多天。'},
  {id:'l_end', n:'余烬', story:'（你写在日记最后一页的话）\n\n"如果这段文字被人读到，说明我至少活到了写下它的那一刻。\n\n世界没有结束，只是变慢了。人们学会了用火、用铁、用彼此的体温熬过夜晚。\n\n病毒教会我们一件事：活着不是本能，是每天都要重新做的选择。\n\n我选择继续。"'},
];

// 成就
const ACHIEVEMENTS = [
  {id:'a_first',   n:'第一次呼吸',   d:'完成第一次探索'},
  {id:'a_hunter',  n:'猎手',         d:'累计击杀 25 只丧尸'},
  {id:'a_slayer',  n:'清道夫',       d:'累计击杀 100 只丧尸'},
  {id:'a_quiet',   n:'无声之人',     d:'用近战武器击杀 20 只丧尸'},
  {id:'a_boom',    n:'噪音制造者',   d:'在同一场战斗中放倒 3 个以上的敌人'},
  {id:'a_horde',   n:'尸潮幸存者',   d:'撑过一次夜间尸潮'},
  {id:'a_base',    n:'工程师',       d:'任意据点设施升到满级'},
  {id:'a_craft',   n:'手艺活',       d:'完成 10 次制作'},
  {id:'a_lore',    n:'档案管理员',   d:'解锁 8 条秘闻'},
  {id:'a_scav',    n:'拾荒之王',     d:'搜刮 40 次'},
  {id:'a_immune',  n:'铁壁',         d:'一场战斗未受伤并获胜'},
  {id:'a_cure',    n:'解药',         d:'通关主线，取得解药'},
  {id:'a_endless', n:'余烬',         d:'通关后进入无尽模式'},
  {id:'a_naked',   n:'只剩撬棍',     d:'不使用枪械通关最终决战'},
];
/* ═══════════════════════════════════════════════
   v2.2 新增数据层：悬赏 / 精英词条 / 支线 / 改装 / 独占装备 / 区域剪影
   ═══════════════════════════════════════════════ */
LORE.push(
  {id:'l_hawk', n:'霍克的旧哨所', story:'（霍克第一次开口讲从前，是在他把最后一块巧克力分给你之后）\n\n"北边那个检查站，我曾经守了十一天。里面还有我的枪柜，密码是我的兵号。\n\n我不是不想回去。我是不想一个人回去。"\n\n—— 你们清完检查站的那天，他在沙袋上坐了很久，然后教你怎样在开枪之前先数敌人的呼吸。'},
  {id:'l_nurse', n:'林的药方', story:'（林在据点墙上钉了一张纸，字迹很小很密）\n\n"芥末病毒不是不能压。它会改写宿主的转录，但改写的速率有上限——只要在它完成一轮复制前把游离病毒颗粒清掉。\n\n抗生素不够纯，血清太贵，那我们就用能在废墟里找到的东西配。\n\n配方在下面。如果我不在了，照着做。"\n\n—— 她写完之后抬头笑了笑，说这是她这辈子写得最像论文的东西。'},
  {id:'l_hunter', n:'阿蛮的追踪课', story:'（阿蛮蹲在一具猎犬尸体旁边，用刀挑开它的鼻腔）\n\n"闻这里。它们的嗅觉是人的四十倍，所以它们不需要眼睛。\n\n你要学会的不是躲开它们，是让它们觉得你不值得追。风、水、铁锈味——都能盖住人味。\n\n它们追了你三天，你活了三天。现在轮到你追它们了。"'},
);
ACHIEVEMENTS.push(
  {id:'a_bounty', n:'赏金猎人', d:'完成 10 张悬赏委托'},
  {id:'a_elite',  n:'精英猎手', d:'击杀 1 只精英丧尸'},
  {id:'a_side',   n:'不是一个人', d:'完成任意一条同伴支线'},
  {id:'a_mod',    n:'军械师',   d:'给武器装上 2 个改装件'},
);
// 独占装备（unique:true：无法购买，只能靠支线拿到）
Object.assign(ITEMS, {
  hk_m14:      {n:'霍克的 M14', t:'wpn',  w:3.4, dmg:58, ammo:3, crit:.36, noise:5, unique:true,
                desc:'老兵擦了十年的枪：精准、沉稳，弹匣里永远留着最后一发。'},
  nurse_kit:   {n:'林的外科包', t:'med',  w:1.2, heal:70, cure:'bleed', unique:true,
                desc:'林的缝合手法比药更值钱，她只做了两个。'},
  hunter_charm:{n:'阿蛮的护符', t:'gear', w:0.2, slot:'trinket', dodge:.07, unique:true,
                desc:'一串兽牙。他说这能让你在废墟里少被盯上（闪避 +7%）。'},
});
// C16 精英词条：只加"结构"不加"原始伤害"，从根上避免和护甲减免叠加出怪物
const AFFIX = {
  corrupt:  {n:'腐化',   hp:.35,   desc:'生命 +35%'},
  swift:    {n:'迅捷',   spd:2,    desc:'每回合攻击两次'},
  burst:    {n:'爆裂',   burst:true, desc:'死亡时爆开，对近处造成伤害'},
  armored:  {n:'装甲',   armGun:.65, armMelee:.85, desc:'枪械伤害 -35%'},
  parasitic:{n:'寄生',   bite:.26, desc:'咬伤更狠，感染更高'},
};
// C17 悬赏池：metric 指向 S.stats 的计数器，进度用"接单时的快照"做差
const BOUNTY_POOL = [
  {id:'scav',   t:'搜刮任意区域 3 次',        metric:'scav',            need:3,  reward:{mat:10}},
  {id:'deep',   t:'完成 1 次深度搜索',        metric:'deep',            need:1,  reward:{mat:12, item:'bandage', n:2}},
  {id:'kill',   t:'击杀 6 只丧尸',            metric:'kills',           need:6,  reward:{mat:14}},
  {id:'elite',  t:'击杀 1 只精英丧尸',        metric:'elites',          need:1,  reward:{mat:18, item:'ammo', n:15}},
  {id:'clean',  t:'不受伤害赢下一场战斗',     metric:'cleanWins',       need:1,  reward:{mat:12, item:'painkiller', n:2}},
  {id:'craft',  t:'制作 1 件物品',            metric:'crafted',         need:1,  reward:{mat:8,  item:'cloth', n:3}},
  {id:'shots',  t:'打出 20 发弹药',           metric:'ammoUsed',        need:20, reward:{mat:10, item:'powder', n:3}},
  {id:'zh',     t:'搜刮圣玛丽医院 2 次',      metric:'zone:hospital',   need:2,  reward:{mat:10, item:'anti', n:1}},
  {id:'zm',     t:'搜刮惠民超市 2 次',        metric:'zone:market',     need:2,  reward:{mat:10, item:'can', n:2}},
  {id:'zs',     t:'搜刮地铁三号线 2 次',      metric:'zone:subway',     need:2,  reward:{mat:14, item:'chem', n:2}},
  {id:'horde',  t:'守住一次夜间尸潮',         metric:'hordes',          need:1,  reward:{mat:16, item:'metal', n:4}},
];
// 主线挂钩：每晚会有一张"指向当前主线"的委托（X06 修订：奖励直接给主线要的东西）
const QUEST_BOUNTIES = [
  {stage:0, t:'搜刮医院 1 次（找线索）',   metric:'zone:hospital', need:1, reward:{mat:8,  item:'bandage', n:2}},
  {stage:1, t:'搜刮第 9 分局 1 次（找枪）', metric:'zone:police',  need:1, reward:{mat:8,  item:'ammo', n:12}},
  {stage:2, t:'击杀 1 只装甲丧尸（门禁卡）', metric:'killBy:armored', need:1, reward:{mat:12, item:'keycard', n:1}},
  {stage:3, t:'搜刮地铁三号线 1 次（面具）', metric:'zone:subway', need:1, reward:{mat:12, item:'chem', n:2}},
  {stage:4, t:'搜刮老城区 2 次（电子元件）', metric:'zone:oldtown', need:2, reward:{mat:10, item:'chip', n:2}},
  {stage:5, t:'击杀 4 只丧尸（清路）',      metric:'kills',        need:4, reward:{mat:16, item:'medkit', n:1}},
];
// C21 三条同伴支线：step 0 在招募时开启
const SIDE_QUESTS = {
  vet:    {n:'霍克的旧哨所', comp:'vet', desc:'他从不提以前的事——直到你递给他一块巧克力。',
    steps:[{t:'给霍克 2 块巧克力', need:{choco:2}, type:'items'},
           {t:'陪他清一遍军方检查站（搜刮 3 次）', metric:'zone:military', need:3},
           {t:'击杀 5 只装甲丧尸', metric:'killBy:armored', need:5}],
    reward:{item:'hk_m14', n:1, lore:'l_hawk', xp:{shoot:40}}},
  nurse:  {n:'林的药方', comp:'nurse', desc:'她想把血清的配方重新算出来——用废墟里还能找到的东西。',
    steps:[{t:'收集 3 份化学药剂', need:{chem:3}, type:'items'},
           {t:'给她 2 支抗生素', need:{anti:2}, type:'items'},
           {t:'在感染 ≥40% 的状态下活过一夜', metric:'nights', need:1, cond:'infect40'}],
    reward:{item:'nurse_kit', n:2, lore:'l_nurse', xp:{medic:40}}},
  hunter: {n:'阿蛮的追踪课', comp:'hunter', desc:'他教你听风里的味道：哪个方向有活人，哪个方向只有死东西。',
    steps:[{t:'击杀 4 只变异猎犬', metric:'killBy:hound', need:4},
           {t:'完成 3 次深度搜索', metric:'deep', need:3},
           {t:'和他一起守一次夜（撑过尸潮）', metric:'hordes', need:1}],
    reward:{item:'hunter_charm', n:1, lore:'l_hunter', xp:{survival:40, stealth:30}}},
};
// C22 武器改装：每把武器最多 2 件，全部带取舍
const MODS = {
  supp:  {n:'自制消音器', cost:{metal:3, tape:2, cloth:1}, noise:-2, wmult:.9,  desc:'噪音 -2，伤害 -10%。'},
  mag:   {n:'扩容弹匣',   cost:{metal:4, powder:2, tape:1}, ammo:-1, wadd:.6,   desc:'每次射击少耗 1 发（最低 1），重量 +0.6。'},
  scope: {n:'瞄准镜',     cost:{metal:3, chip:2},           crit:.08,           desc:'暴击率 +8%。'},
  grip:  {n:'战术握把',   cost:{metal:2, cloth:2},          stamult:.75,        desc:'近战体力消耗 -25%。'},
};
// C20 区域剪影（32×32 单路径，纯装饰）
const ZONE_SIL = {
  hospital:'M6 6h20v20H6zM14 10h4v12h-4zM10 14h12v4H10z',
  police:'M16 4l10 4v8c0 6-4 10-10 12-6-2-10-6-10-12V8z',
  market:'M5 6h3l1 3h18l-3 10H10L7 6zM11 24a2 2 0 104 0 2 2 0 10-4 0M21 24a2 2 0 104 0 2 2 0 10-4 0',
  oldtown:'M16 4l12 10h-3v14H7V14H4z',
  gas:'M6 4h12v24H6zM20 8h4v14a2 2 0 11-4 0z',
  subway:'M6 6h20v14a6 6 0 01-6 6h-8a6 6 0 01-6-6zM10 26l-2 4M22 26l2 4',
  military:'M6 20a10 10 0 0120 0v4H6zM12 6h8v6h-8z',
  lab:'M16 4a6 6 0 016 6c0 3-3 4-3 6s3 3 3 6a6 6 0 11-12 0c0-3 3-4 3-6s-3-3-3-6a6 6 0 016-6z',
};

/* ═══════════ legacy/10-core.js ═══════════ */
/* ───────────── 状态与存档 ───────────── */
function newState(){
  return {
    v:VER, day:1, ap:14, apMax:14,   // M25.2：每天 14 点行动力（原 9 点 —— 用户「一天也太短了」）；成本表没动，所以一天能做的事多了
    __integrity:null,               // M8：存档指纹（内容校验和），随存档一起进 localStorage / 云盘
    hp:100, hpMax:100, sta:100, staMax:100, hun:100, thi:100, infect:0,
    ammo:24, mat:12,   // M32b：这 24 发是"开局弹药池"，initGame 里会被 materializeAmmoPool() 落成真弹（9mm FMJ）
    inv:{ can:2, water:2, bandage:1, crowbar:1 },
    store:{},
    eq:{ wpn:'crowbar', head:null, body:null, mask:null, feet:null, bag:null, trinket:null },
    base:{ door:0,bed:0,filter:0,garden:0,bench:0,storage:0,radio:0,wall:0 },
    skills:{ shoot:0,melee:0,survival:0,medic:0,fitness:0,stealth:0,scout:0,gather:0,cook:0,craft:0,mechanic:0,trade:0 },
    xp:{ shoot:0,melee:0,survival:0,medic:0,fitness:0,stealth:0,scout:0,gather:0,cook:0,craft:0,mechanic:0,trade:0 },
    quest:{ stage:0, keycards:0, data:0 },
    lore:[], comp:null, compHp:0, compMax:0,
    ach:[], stats:{ kills:0, meleeKills:0, scav:0, crafted:0, hordes:0, nights:0, dmgDealt:0, dmgTaken:0, multiKill:0,
                    deep:0, ammoUsed:0, cleanWins:0, elites:0, bounties:0, apKills:0, zoneCnt:{}, killBy:{} },   // v2.2：悬赏板与精英统计要用的计数器；apKills=M48 穿甲击杀
    flags:{ gotGun:false, labOpen:false, won:false, endless:false, cured:false,
            tips:{},                                // C04/C06 触发式提示去重
            rescueUsed:false, everDied:false },      // C05 濒死救援：整档唯一、落盘不可重置
    ui:{ bounties:null, pace:'fast', fs:14, amb:true, music:true },   // pace: fast=即时结算(默认) / beat=三段节拍；amb=环境底噪；music=配乐
    bounty:{ day:0, list:[], spent:0 },          // C17 悬赏板：每晚刷新，当日材料预算封顶
    side:{ vet:0, nurse:0, hunter:0 },           // C21 三条支线进度
    sideBase:{},                                 // C21 当前步骤的计数器快照（漏了这行会在支线推进时抛 TypeError）
    mods:{},                                     // C22 武器改装 {武器id:[改装id]}
    eliteToday:0,                                // C16 精英词条：每日 ≤1 只
    shop:{ day:0, bought:{} },                   // C22 商人每日限购
    /* ── v3.0 世界层：位置 / 防线 / 伤口 / 腐坏 / 日历 ── */
    loc:'base',                                  // 当前所在（base 或区域 id）：搜刮必须先到那儿
    def:{ doorHp:0, wallHp:0, traps:{ spike:0, fire:0, alarm:0 } },   // 基地防线与陷阱
    wounds:[],                                   // 持续性伤口 [{t:'bleed'|'fracture'|'sick', sev, left}]
    spoil:{},                                    // 生鲜腐坏计时 {物品id: 剩余天数}
    horde:{ eta:0, size:0 },                     // 尸群迁徙追踪（eta=还有几天到）
    cal:{ powerOff:false, bloodMoon:false, warned:0 },                // 日历状态
    seen:{},              // 区域首次发现记录
    noise:0,              // 噪音值：引尸潮
    starveN:0, thirstN:0, // M55：连续挨饿/脱水几晚（夜里按它加码掉血；吃东西喝水就归零）
    world:null,           // v4.0 大世界进度（区块位置/迷雾/POI 剩余次数/载具）：由 src/v4/worldstate.ts 解释
    // M13：委托（接单制）与「大故事」章节进度 —— 逻辑全在 src/v4/contracts-core.ts / story-core.ts，
    // 这里只留两个字段做存档容器；老档没有它们 → 由 v4 侧 ensure 补齐。
    contracts:{ day:1, board:[], active:[], done:0, failed:0, log:[] },
    story:{ chapter:0, done:[], log:[] },
    // M15：已解锁的结局 id（跨周目累计，任务页「结局档案」显示）
    endings:[],
    // M6：季节/天气/体温（env）与菜园地块（plots）——数值与公式全在 src/v4/env-core.ts
    env:{ weather:'clear', tomorrow:'cloudy', temp:50, rainToday:0, coldTier:0 },
    plots:[],
    /* M25：口径与辐射。
       load  = 每个口径"现在装的是哪种弹"（玩家在弹药台/背包里选，没选就自动挑穿透最高的）
       rad   = 体内辐射累积 0~100（核电站/废料场周边会涨，碘片与抗辐射药能压下去） */
    load:{},
    rad:0,
    logBuf:[], sfx:true, tab:'explore', over:false
  };
}
let S = newState();
let battle = null, fxLock = false;
const RM = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;

/* ── M29 存档安全带（加密版）：所有落盘都经过保险箱（worker 里的 AES-GCM-256）──
   写：内存缓存立刻更新，密文异步落盘；读：启动时已解密好，同步取。
   备份（.bak）也是密文，供"主档写坏"时在 ☰ 菜单里回滚。 */
const BAK_KEY = SAVE_KEY + '.bak';
window.__renderErr = null;
/** M33：教程沙盒（iframe ?sandbox=1）—— 平行世界，**一个字节都不许落盘**。
    所有落盘都过 writeSave 这一个口子，所以在它头上拦一刀就够了（自动存档、手动保存、重开新档全覆盖）。 */
const isLab = () => !!(window.__ZSV_LAB);
const vault = () => (typeof window.V4Vault === 'object' && window.V4Vault) ? window.V4Vault : null;
function writeSave(s){
  if(isLab()) return true;                                     // 沙盒：假装存了，实际什么都不写
  try{
    const payload = JSON.stringify(s);
    const v = vault();
    if(v){
      const prev = (v.status && v.status().cached) || null;   // 上一份明文（内存里的），当备份
      v.write(payload, { backup: !!prev, backupRaw: prev });
      /* M39：顺手考虑存一份历史快照（节流规则在 backup-core：天数变了必存、同一天最多 2 份、间隔 ≥5 分钟） */
      if(v.maybeSnapshot) void v.maybeSnapshot(payload);
      return true;                                            // 落盘是异步的，失败会写进 status().lastError
    }
    /* 保险箱没起来（极罕见）：退回老的 localStorage 直写，宁可明文也不能丢档 */
    const prev2 = localStorage.getItem(SAVE_KEY);
    if(prev2){
      localStorage.setItem(BAK_KEY, prev2);
      if(localStorage.getItem(BAK_KEY) !== prev2) return false;
    }
    localStorage.setItem(SAVE_KEY, payload);
    return localStorage.getItem(SAVE_KEY) === payload;
  }catch(e){ return false; }
}
function saveGame(quiet){
  const ok = writeSave(S);
  if(!quiet) ok ? log('💾 进度已保存（第 '+S.day+' 天，加密落盘）。','info') : toast('保存失败','本地存储被拒绝或已满。','bad');
  return ok;
}
function autosave(){
  if(S.over) return;
  if(window.__renderErr) return;   // C01 熔断：渲染已崩，不把坏状态写死进唯一键位
  writeSave(S);
}
/** M29：读档走保险箱解密后的内存副本（boot 时已 hydrate）；没有就回退老路径 */
function readSavedRaw(){
  const v = vault();
  const cached = v && v.read ? v.read() : null;
  if(cached) return cached;
  return localStorage.getItem(SAVE_KEY);
}
function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function lsSet(k,v){ try{ localStorage.setItem(k,v); return true; }catch(e){ return false; } }

/* ── C01/C02 存档清洗：白名单 + id 回字典校验，坏档被修好而不是崩 ── */
// M6：存档清洗要认识的天气与作物 id（真值在 src/v4/env-core.ts，这里只做白名单校验）
const WEATHER_IDS = ['clear','cloudy','rain','storm','fog','snow','heat','cold'];
const CROP_IDS = ['veg','grain'];
function sanitizeSave(d){
  if(!d || typeof d !== 'object') return null;
  const base = newState(), out = {};
  for(const k in base) if(k in d) out[k] = d[k];
  const num = (v, def, lo, hi) => (typeof v === 'number' && isFinite(v)) ? clamp(v, lo, hi) : def;
  out.day = Math.floor(num(out.day, 1, 1, 100000)); out.ap = Math.floor(num(out.ap, 14, 0, 99));
  out.apMax = Math.floor(num(out.apMax, 14, 1, 99));
  out.hpMax = Math.floor(num(out.hpMax, 100, 1, 1e9)); out.hp = num(out.hp, out.hpMax, 0, out.hpMax);
  out.staMax = Math.floor(num(out.staMax, 100, 1, 1e9)); out.sta = num(out.sta, out.staMax, 0, out.staMax);
  out.hun = num(out.hun, 100, 0, 100); out.thi = num(out.thi, 100, 0, 100); out.infect = num(out.infect, 0, 0, 100);
  out.ammo = Math.floor(num(out.ammo, 0, 0, 1e6)); out.mat = Math.floor(num(out.mat, 0, 0, 1e7));
  out.noise = Math.floor(num(out.noise, 0, 0, 99));
  const bag = (src, cap) => { const dst = {}; if(src && typeof src === 'object') for(const id in src){
      const n = Math.floor(num(src[id], 0, 0, cap)); if(ITEMS[id] && n > 0) dst[id] = n; } return dst; };
  out.inv = bag(out.inv, 9999); out.store = bag(out.store, 9999);
  /* M25 存档迁移：老档只有一个笼统的 S.ammo（无口径）→ 折成 9mm 复装弹放进背包；
     多出来的旧 "ammo" 物品也一并折算（它是"杂牌弹药"，按 1:1 变成 9mm FMJ）。
     M39 修正：M32b 之后 S.ammo 是"装填镜像"（存档里天然是正数），无脑折算 = 每次读档白送一份弹药
     （实测刷新页面 100 → 200 → 400）。判据搬进 ammo-core.legacyAmmoFold：只有"没有口径信息 **且**
     背包里一件弹药都没有"的真老档才折。 */
  {
    const fold = legacyAmmoFold(out.ammo, out.load, out.inv, ITEMS);
    if(fold > 0) out.inv.a9_fmj = (out.inv.a9_fmj || 0) + fold;
    delete out.inv.ammo;
    out.ammo = 0;
    /* load：每个口径记住玩家选的弹种（只认合法 id，坏档忽略） */
    const ld = {}; const src = out.load && typeof out.load === 'object' ? out.load : {};
    for(const c in CALIBERS){ const v = src[c]; if(typeof v === 'string' && ITEMS[v] && ITEMS[v].cal === c) ld[c] = v; }
    out.load = ld;
    out.rad = Math.floor(num(out.rad, 0, 0, 100));
  }
  const slots = { wpn:'wpn', head:'head', body:'body', mask:'mask', feet:'feet', bag:'bag', trinket:'trinket' };
  const eq = {}; for(const sl in slots){ const v = (out.eq || {})[sl];
    eq[sl] = (typeof v === 'string' && ITEMS[v] && ITEMS[v].slot === slots[sl]) ? v : base.eq[sl]; }
  out.eq = eq;
  const b = {}; for(const k in BASE_UP) b[k] = Math.floor(num((out.base||{})[k], 0, 0, BASE_UP[k].max)); out.base = b;
  const sk = {}, xp = {}; for(const k in SKILLS){ sk[k] = Math.floor(num((out.skills||{})[k], 0, 0, 10)); xp[k] = Math.floor(num((out.xp||{})[k], 0, 0, 1e6)); }
  out.skills = sk; out.xp = xp;
  out.quest = { stage: Math.floor(num((out.quest||{}).stage, 0, 0, 6)), keycards: Math.floor(num((out.quest||{}).keycards, 0, 0, 3)), data: Math.floor(num((out.quest||{}).data, 0, 0, 9)) };
  out.lore = Array.isArray(out.lore) ? out.lore.filter(x => LORE.some(l => l.id === x)) : [];
  out.ach = Array.isArray(out.ach) ? out.ach.filter(x => ACHIEVEMENTS.some(a => a.id === x)) : [];
  out.comp = (typeof out.comp === 'string' && COMPANIONS[out.comp]) ? out.comp : null;
  out.compHp = num(out.compHp, 0, 0, 1e6); out.compMax = num(out.compMax, 0, 0, 1e6);
  const st = {};
  for(const k in base.stats){
    if(k === 'zoneCnt' || k === 'killBy'){
      st[k] = {}; const src = (out.stats || {})[k];
      if(src && typeof src === 'object') for(const id in src){
        const v = Math.floor(num(src[id], 0, 0, 1e9));
        // M13：zoneCnt 的键不再只认 legacy 区域——委托按 POI 粒度计数（药房/警局/家电城…），
        // 那些键不在 ZONES 里；只校验键名形状，值域照旧卡住。
        const ok = k === 'zoneCnt' ? /^[a-z][a-z0-9_]{1,24}$/.test(id) : !!ZOMBIES[id];
        if(v > 0 && ok) st[k][id] = v;
      }
    } else st[k] = Math.floor(num((out.stats||{})[k], 0, 0, 1e9));
  }
  out.stats = st;
  // v2.2 新增字段白名单
  const bo = out.bounty || {};
  out.bounty = { day: Math.floor(num(bo.day, 0, 0, 1e6)), spent: Math.floor(num(bo.spent, 0, 0, 1e6)),
    list: Array.isArray(bo.list) ? bo.list.filter(x => x && (BOUNTY_POOL.some(p => p.id === x.id) || /^q_\d+$/.test(x.id)))
      .map(x => ({ id:x.id, prog: Math.floor(num(x.prog, 0, 0, 1e6)), done: !!x.done, base: Math.floor(num(x.base, 0, 0, 1e9)) })) : [] };
  const sd = out.side || {};
  out.side = {}; for(const k in SIDE_QUESTS) out.side[k] = Math.floor(num(sd[k], 0, 0, SIDE_QUESTS[k].steps.length));
  out.sideBase = (out.sideBase && typeof out.sideBase === 'object') ? out.sideBase : {};
  /* M13：委托与剧情。这里只做"形状"兜底（对象/数组/数字），细粒度校验在 v4 侧
     contracts-core.ensureContracts / story-core.ensureStory 里做（那边有单测盯着）。 */
  const ct = out.contracts || {};
  out.contracts = {
    day: Math.floor(num(ct.day, 1, 1, 1e6)),
    board: Array.isArray(ct.board) ? ct.board.slice(0, 8) : [],
    active: Array.isArray(ct.active) ? ct.active.slice(0, 8) : [],
    done: Math.floor(num(ct.done, 0, 0, 1e6)), failed: Math.floor(num(ct.failed, 0, 0, 1e6)),
    log: Array.isArray(ct.log) ? ct.log.filter(x => typeof x === 'string').slice(-12) : [],
  };
  const sy = out.story || {};
  out.story = {
    chapter: Math.floor(num(sy.chapter, 0, 0, 6)),
    done: Array.isArray(sy.done) ? sy.done.filter(x => typeof x === 'string').slice(0, 60) : [],
    log: Array.isArray(sy.log) ? sy.log.slice(-40) : [],
    choices: (sy.choices && typeof sy.choices === 'object') ? sy.choices : {},
  };
  /* M15：结局档案。细粒度校验（只留真实存在的结局 id）在 v4 侧 ensureEndings 里做。 */
  out.endings = Array.isArray(out.endings) ? out.endings.filter(x => typeof x === 'string').slice(0, 16) : [];
  const md = out.mods || {};
  out.mods = {}; for(const w in md){
    if(ITEMS[w] && ITEMS[w].t === 'wpn' && Array.isArray(md[w])) out.mods[w] = md[w].filter(x => MODS[x]).slice(0, 2);
  }
  out.eliteToday = Math.floor(num(out.eliteToday, 0, 0, 9));
  // v3.0 世界层白名单
  out.loc = (typeof out.loc === 'string' && (out.loc === 'base' || ZONES[out.loc] || MAP[out.loc])) ? out.loc : 'base';
  const df = out.def || {};
  out.def = {
    doorHp: num(df.doorHp, 0, 0, 1e6), wallHp: num(df.wallHp, 0, 0, 1e6),
    traps: { spike: Math.floor(num((df.traps||{}).spike, 0, 0, 99)), fire: Math.floor(num((df.traps||{}).fire, 0, 0, 99)), alarm: Math.floor(num((df.traps||{}).alarm, 0, 0, 9)) }
  };
  out.wounds = Array.isArray(out.wounds) ? out.wounds.filter(w => w && ['bleed','fracture','sick'].indexOf(w.t) >= 0)
    .map(w => ({ t:w.t, sev: Math.floor(num(w.sev, 1, 1, 3)), left: Math.floor(num(w.left, 0, 0, 99)) })).slice(0, 4) : [];
  out.spoil = {}; if(out.spoil && typeof out.spoil === 'object')
    for(const id in out.spoil) if(ITEMS[id] && ITEMS[id].fresh) out.spoil[id] = Math.floor(num(out.spoil[id], 0, 0, 99));
  const hd = out.horde || {};
  out.horde = { eta: Math.floor(num(hd.eta, 0, 0, 99)), size: Math.floor(num(hd.size, 0, 0, 99)) };
  const ca = out.cal || {};
  out.cal = { powerOff: !!ca.powerOff, bloodMoon: !!ca.bloodMoon, warned: Math.floor(num(ca.warned, 0, 0, 999)) };
  /* M55：饥饿/脱水计数（老档没有这两个字段 → 0；手改档塞进负数/天文数字也拉回安全区间） */
  out.starveN = Math.floor(num(out.starveN, 0, 0, 999));
  out.thirstN = Math.floor(num(out.thirstN, 0, 0, 999));
  const sh = out.shop || {};
  out.shop = { day: Math.floor(num(sh.day, 0, 0, 1e6)), bought: {} };
  if(sh.bought && typeof sh.bought === 'object') for(const id in sh.bought)
    if(MERCHANT.some(m => m.id === id)) out.shop.bought[id] = Math.floor(num(sh.bought[id], 0, 0, 99));
  out.seen = {}; if(out.seen && typeof out.seen === 'object') for(const z in out.seen) if(ZONES[z]) out.seen[z] = 1;
  out.flags = deepMerge(base.flags, (out.flags && typeof out.flags === 'object') ? out.flags : {});
  delete out.flags.cheat;   // 作弊码机制已下线：老档里留下的旗标一并清掉（不然成就会被永久锁死）
  out.flags.tips = (out.flags.tips && typeof out.flags.tips === 'object') ? out.flags.tips : {};
  out.ui = deepMerge(base.ui, (out.ui && typeof out.ui === 'object') ? out.ui : {});
  out.ui.music = out.ui.music !== false;      // 布尔开关：老档没有这个字段时按"开"处理
  out.ui.amb = out.ui.amb !== false;
  out.ui.pace = (out.ui.pace === 'beat') ? 'beat' : 'fast';
  out.logBuf = Array.isArray(out.logBuf) ? out.logBuf.slice(-60) : [];
  // M6 白名单：季节/天气/体温 + 菜园地块（坏值一律拉回安全默认，不让旧档/手改档把夜里的结算搞崩）
  const ev0 = (out.env && typeof out.env === 'object') ? out.env : {};
  out.env = {
    weather: WEATHER_IDS.indexOf(ev0.weather) >= 0 ? ev0.weather : 'clear',
    tomorrow: WEATHER_IDS.indexOf(ev0.tomorrow) >= 0 ? ev0.tomorrow : 'cloudy',
    temp: num(ev0.temp, 50, 0, 100),
    rainToday: Math.floor(num(ev0.rainToday, 0, 0, 9)),
    coldTier: Math.floor(num(ev0.coldTier, 0, 0, 999)),
  };
  out.plots = Array.isArray(out.plots) ? out.plots.slice(0, 3)
    .filter(p => p && typeof p === 'object' && CROP_IDS.indexOf(p.crop) >= 0)
    .map(p => ({ crop: p.crop, day: Math.floor(num(p.day, 0, 0, 99)) })) : [];
  out.sfx = out.sfx !== false; out.over = false;
  /* M51：通关 = 无尽延续。老档里"已通关但没进无尽"（won=true / endless=false）的残留状态现在没有
     任何 UI 出口了（旧版那个「进入无尽模式」按钮本身就是旧界面的一部分），读档时直接归一 ——
     否则顶栏会留下 "101 / 100" 这种看着像坏档的天数。 */
  if(out.flags.won) out.flags.endless = true;
  out.tab = TABS.some(t => t.id === out.tab) ? out.tab : 'explore';
  return deepMerge(newState(), out);
}
/* ── C01 版本闸门 + 迁移阶梯（先迁移，再清洗；顺序不可反） ── */
const MIGRATIONS = {
  // 1 → 2：v1 存档走 migrateV1()（键位不同，不在此表内），这里为未来版本留好阶梯
};
function migrateSave(d){
  let v = (typeof d.v === 'number' && isFinite(d.v)) ? d.v : 1;
  if(v > VER) return { error:'存档来自更新的版本（v'+v+'），当前游戏只支持到 v'+VER+'。' };
  while(v < VER){ const m = MIGRATIONS[v]; if(m) d = m(d); v++; d.v = v; }
  return { data:d };
}

function loadGame(silent){
  /* M29：主档走保险箱的内存副本（启动时已解密）；备份是密文，异步解 —— 这里用同步的
     `readSavedRaw()`，坏档回退那一步交给下面 catch 里的异步备份读取。 */
  const rawText = (key) => (key === SAVE_KEY ? readSavedRaw() : lsGet(key));
  const readAndParse = (key) => { const raw = rawText(key); return raw ? JSON.parse(raw) : null; };
  try{
    let d = null, source = '';
    try{ d = readAndParse(SAVE_KEY); source = '主存档'; }catch(e){ d = null; }
    if(!d){ // 主键损坏 → 回退到 .bak（备份是密文，异步解一次）
      const v = vault();
      if(v && v.loadBackup){
        v.loadBackup().then((txt) => {
          if(!txt){ if(!silent) toast('没有可用存档','主存档与备份都读不出来，可以重新开始。','bad'); return; }
          try{
            const mig2 = migrateSave(JSON.parse(txt));
            if(mig2.error){ toast('读档被拒绝', mig2.error, 'bad'); return; }
            S = sanitizeSave(mig2.data);
            if(!S){ toast('读档失败','存档内容无法解析。','bad'); return; }
            battle = null; window.__renderErr = null; closeAllModals(); clearLog();
            log('📂 读取存档：第 '+S.day+' 天（来源：加密备份 .bak）。','info');
            log('🛟 主存档损坏，已自动回退到上一次的备份。','danger');
            render();
          }catch(e){ toast('读档失败','备份也解析不了。','bad'); }
        });
        return true;
      }
      try{ d = readAndParse(BAK_KEY); source = '备份存档(.bak)'; }catch(e){ d = null; }
    }
    if(!d){ if(!silent) toast('没有可用存档','主存档与备份都读不出来，可以重新开始。','bad'); return false; }
    const mig = migrateSave(d);
    if(mig.error){ toast('读档被拒绝', mig.error, 'bad'); return false; }
    S = sanitizeSave(mig.data);
    if(!S){ toast('读档失败','存档内容无法解析。','bad'); return false; }
    battle = null; window.__renderErr = null;
    closeAllModals(); clearLog();
    syncAmmo();                                  // M32b：读档后把 S.ammo 镜像对齐到背包里的实弹（旧版这里是 0 → 有弹也开不了枪）
    log('📂 读取存档：第 '+S.day+' 天（来源：'+source+'）。','info');
    if(source !== '主存档') log('🛟 主存档损坏，已自动回退到上一次的备份。','danger');
    render();
    return true;
  }catch(e){ toast('读档失败', e.message, 'bad'); return false; }
}
// v1 存档迁移：老玩家不用从零开始
function migrateV1(){
  try{
    const raw = localStorage.getItem(V1_KEY);
    if(!raw) return false;
    const o = JSON.parse(raw);
    const n = newState();
    if(typeof o.health === 'number') n.hp = Math.min(o.health, o.maxHealth || 100);
    n.hpMax = Math.max(100, o.maxHealth || 100);
    n.mat = o.resources || 12;
    n.ammo = o.ammo || 24;    n.day = o.days || 1;
    let startAmmo = n.ammo;                       // M32b：v1 只有"弹药总数"，迁移时落成真弹
    n.ammo = 0;                                   // 池子清空，下面 grant 之后由 syncAmmo() 重算
    n.quest.stage = Math.min(5, o.questStage || 0);
    n.lore = Array.isArray(o.discoveredLore) ? o.discoveredLore.filter(x => LORE.some(l => l.id === x)) : [];
    // 注意：此时全局 S 还是旧档，物品必须写进新对象 n，否则迁移时物品会丢
    const gains = {};
    const map = { '急救包':'medkit', '防毒面具':'gasmask', '防化服':'hazmat' };
    (o.inventory || []).forEach(name => {
      const id = map[name];
      if(id) gains[id] = (gains[id] || 0) + 1;
      if(name === '弹药箱') startAmmo += 20;
    });
    if(o.equipped && o.equipped.gasMask) gains.gasmask = (gains.gasmask || 0) + 1;
    if(o.equipped && o.equipped.hazmatSuit) gains.hazmat = (gains.hazmat || 0) + 1;
    for(const k in gains) n.inv[k] = (n.inv[k] || 0) + gains[k];
    if(o.foundGun) n.flags.gotGun = true;
    n.flags.migrated = true;
    S = n;
    const cnt = Math.max(2, Math.round((o.food || 50) / 20));
    S.inv.can = (S.inv.can || 0) + cnt;
    S.inv.water = (S.inv.water || 0) + cnt;
    grant('ammo', startAmmo, true);              // M32b：v1 的笼统弹药数落成真弹（不再是 S.ammo 里的死数）
    clearLog(); render();
    log('📦 已把 v1.0 存档迁移到 v2.1（旧档保留在原键位）。','info');
    toast('存档已迁移','v1.0 的进度被带进了 v2.0。','ok');
    autosave(); return true;
  }catch(e){ return false; }
}
function deepMerge(base, over){
  for(const k in over){
    if(over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]))
      deepMerge(base[k], over[k]);
    else if(over[k] !== undefined) base[k] = over[k];
  }
  return base;
}
/** M29：**导出/导入存档这两条路被去掉了**（用户：「强制云端存档或者本地存档，不做可直接导出存档」）。
    取而代之的是：
      · 本地存档 = 加密落盘（`writeSave` 走 SaveVault，密文前缀 ZSV1:）；
      · 云存档 = ☰ 菜单 → 世界与账号 → 账号（上传的也是密文）；
      · 本机加密备份 = `restoreBackup()`（主档写坏时回滚）。
    老玩家手里可能还有 M28 的 ZSE1 导出文本 —— 那一版没进过正式发布，所以这里不保留导入入口；
    如果哪天需要"换设备搬档"，正确做法是加一条**基于口令**的导出（口令不入代码），而不是回到明文。 */
function restoreBackup(){
  if(isLab()){ toast('沙盒里没有存档','这里是平行世界，不读也不写你的主档。','info'); return; }   // M33：沙盒不许碰主档备份
  const v = (typeof window.V4Vault === 'object' && window.V4Vault) ? window.V4Vault : null;
  if(!v || !v.loadBackup){ toast('没有备份','这个构建读不到本机备份。','bad'); return; }
  const confirmModal = () => modal({ title:'🛟 回滚到上次备份', sticky:true,
    body:'<p class="muted">本机保存着<b>上一次</b>的加密备份（每次存档前自动转存）。回滚会把当前进度换成它，'+
      '当前进度会被覆盖。<br>用于"主档读不出来 / 刚做了一堆后悔的操作"这类情况。</p>',
    footer:'<button class="btn danger" id="bak-go">回滚并覆盖当前进度</button><button class="btn" data-close>取消</button>',
    onMount(){ $('#bak-go').onclick = () => {
      v.loadBackup().then((txt) => {
        if(!txt){ toast('没有备份','备份位是空的。','bad'); return; }
        try{
          const mig = migrateSave(JSON.parse(txt));
          if(mig.error){ toast('回滚被拒绝', mig.error, 'bad'); return; }
          const clean = sanitizeSave(mig.data);
          if(!clean){ toast('回滚失败','备份内容不完整。','bad'); return; }
          S = clean; battle = null; window.__renderErr = null; closeAllModals(); clearLog(); render();
          log('🛟 已回滚到备份：第 '+S.day+' 天。','info'); autosave();
        }catch(e){ toast('回滚失败','备份解析不了。','bad'); }
      });
    }; } });
  confirmModal();
}

/* ───────────── 工具 ───────────── */
/* ══════════ M39：存档的"搬得走 + 退得回" ══════════
   ⑤ 口令加密的导出/导入：跨设备搬档不再需要明文（口令不入代码、不落盘）
   ⑥ 备份历史：6 份轮转快照，能挑一份回滚（`.bak` 之外的"退好几步"） */

/** 把导入/回滚出来的明文接上（migrate + sanitize 全过一遍，坏档一律拒绝） */
function adoptPlainSave(plain, why){
  const mig = migrateSave(JSON.parse(plain));
  if(mig.error){ toast('读档被拒绝', mig.error, 'bad'); return false; }
  const clean = sanitizeSave(mig.data);
  if(!clean){ toast('读档失败','内容不完整。','bad'); return false; }
  S = clean; battle = null; window.__renderErr = null; closeAllModals(); clearLog();
  syncAmmo();                      // M39：导入/回滚走的是同一套清洗，镜像要跟着重算（否则 HUD 显示 0 发）
  log(why + '：第 ' + S.day + ' 天。','info');
  render(); autosave();
  return true;
}
function copyText(text){
  try{
    if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(text).then(() => toast('已复制','粘到新设备/聊天窗口都行（没有口令解不开）。','ok'), () => toast('复制失败','手动全选文本框复制吧。','bad')); return; }
  }catch(e){ /* 忽略 */ }
  toast('复制被拦','手动全选文本框复制吧。','info');
}
function downloadText(name, text){
  try{
    const url = URL.createObjectURL(new Blob([text], { type:'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
    log('⬇️ 已导出文件：' + name,'info');
  }catch(e){ toast('下载失败','可以手动复制文本框里的内容。','bad'); }
}
/** 导出/导入弹窗（prePlain 非空时导出的是"某一份历史快照"而不是当前进度） */
function openSavePort(prePlain, title){
  if(isLab()){ toast('沙盒里没有存档','这里是平行世界，不读也不写你的主档。','info'); return; }
  const v = vault();
  const src = prePlain || (v && v.currentPlain ? v.currentPlain() : null) || localStorage.getItem(SAVE_KEY) || '';
  const sum = src ? portSummary(src) : null;
  modal({ title: title || '🔐 导出 / 导入存档（口令加密）', sticky:true,
    body:'<div class="hint" style="line-height:1.9">' +
      '换设备、换浏览器搬档用这里。<b>口令不会存进游戏</b>（不落盘、不进代码）——但也意味着<b>忘了口令谁也解不开</b>。<br>' +
      '导出的文本本身是密文（PBKDF2 15 万次 + AES-GCM-256），贴到聊天窗口也不怕。</div>' +
      (sum ? '<div class="hint" style="margin-top:8px">当前导出的是：<b>第 ' + sum.day + ' 天</b> · 击杀 ' + sum.kills + ' · 背包 ' + sum.invKinds + ' 种</div>' : '') +
      '<div class="sect-title" style="margin-top:12px">① 导出</div>' +
      '<div class="row"><input id="port-pw" class="btn sm" style="flex:1 1 200px;min-width:0" type="password" placeholder="设一个口令（至少 6 位，别用生日）" />' +
      '<button class="btn sm primary" id="port-gen">生成导出文本</button></div>' +
      '<textarea id="port-out" readonly rows="4" style="width:100%;margin-top:8px;font-family:var(--mono);font-size:11px" placeholder="点上面的按钮生成…"></textarea>' +
      '<div class="row" style="margin-top:6px"><button class="btn sm" id="port-copy">📋 复制文本</button>' +
      '<button class="btn sm" id="port-dl">⬇️ 存成文件</button><span class="spacer"></span><span class="hint" id="port-size"></span></div>' +
      '<div class="sect-title" style="margin-top:14px">② 导入（覆盖本机进度）</div>' +
      '<textarea id="port-in" rows="4" style="width:100%;font-family:var(--mono);font-size:11px" placeholder="把导出的那一段（以 ' + PORT_MAGIC + ' 开头）粘到这里"></textarea>' +
      '<div class="row" style="margin-top:6px"><input id="port-pw2" class="btn sm" style="flex:1 1 200px;min-width:0" type="password" placeholder="输入当时设的口令" />' +
      '<button class="btn sm ok" id="port-import">导入并覆盖本机</button></div>' +
      '<div class="hint" style="margin-top:8px" id="port-msg"></div>',
    footer:'<button class="btn" data-close>关闭</button>',
    onMount(){
      $('#port-gen').onclick = () => {
        const pw = $('#port-pw').value || '';
        const bad = passphraseIssue(pw);
        const msg = $('#port-msg');
        if(bad){ msg.textContent = '⚠️ ' + bad; return; }
        msg.textContent = passphraseWeak(pw) ? '提示：口令偏短，建议再长一点。' : '';
        if(!src){ msg.textContent = '没有可导出的存档（先玩一局或保存一次）。'; return; }
        exportSaveText(src, pw).then((txt) => {
          $('#port-out').value = txt;
          $('#port-size').textContent = '导出文本 ' + portSizeKb(txt);
          log('🔐 已生成口令加密导出文本（' + portSizeKb(txt) + '）。','info');
          sfx('ok');
        }).catch((e) => { msg.textContent = '⚠️ 导出失败：' + (e && e.message ? e.message : e); });
      };
      $('#port-copy').onclick = () => { const t = $('#port-out').value; if(t) copyText(t); else $('#port-msg').textContent = '⚠️ 先生成导出文本。'; };
      $('#port-dl').onclick = () => { const t = $('#port-out').value; if(t) downloadText(portFileName(sum ? sum.day : S.day), t); else $('#port-msg').textContent = '⚠️ 先生成导出文本。'; };
      $('#port-import').onclick = () => {
        const txt = ($('#port-in').value || '').trim();
        const pw = $('#port-pw2').value || '';
        const msg = $('#port-msg');
        if(!parsePortText(txt)){ msg.textContent = '⚠️ 这段文本不是本游戏的导出备份。'; return; }
        msg.textContent = '解密中…';
        importSaveText(txt, pw).then((plain) => {
          const sum2 = portSummary(plain);
          if(!sum2){ msg.textContent = '⚠️ 解开了，但内容不是有效存档。'; return; }
          msg.textContent = '';
          modal({ title:'📥 导入确认', sticky:true,
            body:'<p class="muted">这段备份是 <b>第 ' + sum2.day + ' 天</b>（击杀 ' + sum2.kills + ' · 生命 ' + sum2.hp + ' · 背包 ' + sum2.invKinds + ' 种）。</p>' +
              '<p class="muted" style="margin-top:8px">导入会<b>覆盖当前进度</b>（当前进度会自动转存成本机备份，万一后悔还能回滚）。</p>',
            footer:'<button class="btn danger" id="port-do">覆盖并载入</button><button class="btn" data-close>取消</button>',
            onMount(){ $('#port-do').onclick = () => {
              try{ if(adoptPlainSave(plain, '📥 已导入口令备份')) log('　 原进度已转存本机加密备份，可在「备份历史 / 回滚备份」里找回。','dim'); }
              catch(e){ toast('导入失败','内容解析不了。','bad'); }
            }; } });
        }).catch((e) => { msg.textContent = '⚠️ ' + (e && e.message ? e.message : e); });
      };
    } });
}
/** 备份历史（6 份轮转快照 + `.bak` 那一步） */
function openBackupHistory(){
  if(isLab()){ toast('沙盒里没有存档','这里是平行世界，不读也不写你的主档。','info'); return; }
  const v = vault();
  if(!v || !v.listBackups){ toast('没有备份历史','这个构建读不到本机备份。','bad'); return; }
  const list = v.listBackups();
  const rows = list.length
    ? list.map((e, i) => '<div class="lrow"><div><div class="nm">' + (i === 0 ? '🆕 ' : '') + backupLabel(e) + '</div>' +
        '<div class="ds">键 ' + e.key + ' · ' + new Date(e.at).toLocaleString() + '</div></div>' +
        '<div class="rt"><button class="btn xs" onclick="restoreHistory(\'' + e.key + '\')">回滚到这份</button>' +
        '<button class="btn xs ghost" onclick="exportHistory(\'' + e.key + '\')">导出</button>' +
        '<button class="btn xs danger" onclick="deleteHistory(\'' + e.key + '\')">删除</button></div></div>').join('')
    : '<p class="muted">还没有历史快照。玩一会儿（过一天、或满 5 分钟做点事）就会自动存第一份。</p>';
  modal({ title:'🗂️ 备份历史（最近 ' + BACKUP_SLOTS + ' 份）', sticky:true,
    body:'<div class="hint" style="line-height:1.9">存档时自动存快照（<b>天数变化必存</b>；同一天最多 2 份、相隔至少 5 分钟），' +
      '最多留 ' + BACKUP_SLOTS + ' 份，密文落盘（和主档同一把本机密钥）。<br>' +
      '除了这份历史，另有「上一步」的 <b>.bak</b> 备份（菜单里的「回滚备份」）。</div>' +
      '<div class="sect-title" style="margin-top:12px">快照</div>' + rows,
    footer:'<button class="btn ok" id="bak-now">📸 立即存一份快照</button><button class="btn" data-close>关闭</button>',
    onMount(){ $('#bak-now').onclick = () => {
      v.maybeSnapshot(JSON.stringify(S), true).then((r) => {
        toast(r.saved ? '已存快照' : '这次没存', r.why, r.saved ? 'ok' : 'info');
        if(r.saved){ log('📸 手动快照：第 ' + S.day + ' 天。','info'); closeAllModals(); openBackupHistory(); }
      });
    }; } });
}
function restoreHistory(key){
  const v = vault();
  if(!v || !v.readBackupAt) return;
  modal({ title:'🛟 回滚到这份快照', sticky:true,
    body:'<p class="muted">回滚会把当前进度换成这份快照，当前进度仍会先转存成新的快照（后悔还能退回来）。</p>',
    footer:'<button class="btn danger" id="hs-go">回滚并覆盖</button><button class="btn" data-close>取消</button>',
    onMount(){ $('#hs-go').onclick = () => {
      v.maybeSnapshot(JSON.stringify(S), true).then(() => v.readBackupAt(key)).then((txt) => {
        if(!txt){ toast('这份快照读不出来','可能被清过站点数据。','bad'); return; }
        try{ adoptPlainSave(txt, '🛟 已回滚到历史快照'); }catch(e){ toast('回滚失败','快照内容解析不了。','bad'); }
      });
    }; } });
}
function exportHistory(key){
  const v = vault();
  if(!v || !v.readBackupAt) return;
  v.readBackupAt(key).then((txt) => {
    if(!txt){ toast('这份快照读不出来','可能被清过站点数据。','bad'); return; }
    openSavePort(txt, '🔐 导出这一份快照（口令加密）');
  });
}
function deleteHistory(key){
  const v = vault();
  if(!v || !v.deleteBackupAt) return;
  modal({ title:'🗑️ 删除这份快照', sticky:true,
    body:'<p class="muted">删了就找不回来了（其余快照不受影响）。</p>',
    footer:'<button class="btn danger" id="hs-del">删除</button><button class="btn" data-close>取消</button>',
    onMount(){ $('#hs-del').onclick = () => {
      v.deleteBackupAt(key).then((okDel) => {
        toast(okDel ? '已删除' : '没删成', okDel ? '这份快照已经从本机移除。' : '找不到这份快照。', okDel ? 'info' : 'bad');
        closeAllModals(); openBackupHistory();
      });
    }; } });
}

/* ───────────── 工具 ───────────── */
const $ = s => document.querySelector(s);const $$ = s => Array.prototype.slice.call(document.querySelectorAll(s));
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const rnd = (a,b) => a + Math.random() * (b - a);
const ri = (a,b) => Math.floor(rnd(a, b + 1));
const chance = p => Math.random() < p;
const pick = a => a[Math.floor(Math.random() * a.length)];
function wpick(obj){ let t = 0, k; for(k in obj) t += obj[k]; let r = Math.random() * t; for(k in obj){ r -= obj[k]; if(r <= 0) return k; } return Object.keys(obj)[0]; }
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ───────────── 音效（WebAudio 合成，无外部资源） ───────────── */
let AC = null, audioLive = 0;   // A9：并发上限，连击/尸潮时不再堆几十个 oscillator
const AUDIO_MAX = 6;
function actx(){ if(!AC){ try{ AC = new (window.AudioContext || window.webkitAudioContext)(); }catch(e){ AC = false; } } return AC; }
/* C19 环境底噪：一条低频 drone + 偶发远处拖行声；页面隐藏/静音即停 */
const AMB = { node:null, lfo:null, gain:null, timer:null, mode:null };
function ambStart(){
  if(AMB.node) return;
  const c = actx(); if(!c || !S.ui.amb || !S.sfx) return;
  try{
    const o = c.createOscillator(), g = c.createGain(), l = c.createOscillator(), lg = c.createGain();
    o.type = 'sine'; o.frequency.value = AMB.mode === 'night' ? 44 : 52;
    l.type = 'sine'; l.frequency.value = 0.06; lg.gain.value = 4;
    l.connect(lg).connect(o.frequency);
    g.gain.value = AMB.mode === 'night' ? .016 : .012;
    o.connect(g).connect(c.destination); o.start(); l.start();
    AMB.node = o; AMB.gain = g; AMB.lfo = l;
    AMB.timer = setInterval(ambBlip, 22000);
  }catch(e){ AMB.node = null; }
}
function ambBlip(){ if(!AMB.node || document.hidden || !S.ui.amb) return; if(Math.random() < .55) noise(.55, .045); }
function ambStop(){
  if(AMB.timer){ clearInterval(AMB.timer); AMB.timer = null; }
  if(AMB.node){ try{ AMB.node.stop(); AMB.lfo.stop(); }catch(e){} AMB.node = null; AMB.lfo = null; AMB.gain = null; }
}
function ambMode(m){
  AMB.mode = m;
  if(!AMB.node) return;
  try{ AMB.node.frequency.value = m === 'night' ? 44 : 52; AMB.gain.gain.value = m === 'night' ? .016 : .012; }catch(e){}
}
function ambSync(){
  (S.ui.amb && S.sfx && !document.hidden) ? ambStart() : ambStop();
  (S.ui.music && S.sfx && !document.hidden) ? musicStart() : musicStop();   // 配乐与环境底噪同生共死
}
document.addEventListener('visibilitychange', ambSync);

/* ═══ 配乐：程序化生成的极简末日氛围（纯 WebAudio，不含任何音频文件） ═══
   四小节循环 Am – F – C – E，分层：铺底和声垫 + 低音 + 稀疏五声旋律 + 战斗脉冲。
   速度与配器随状态变（白天/夜晚/战斗/守夜/残血），全部用 setTimeout 逐小节预约，
   不用 rAF；同时发声数有上限，音符自己 stop，不残留节点。 */
const MUS = { on:false, master:null, filt:null, delay:null, next:0, bar:0, timer:null, voices:0, mood:'day' };
const MUS_MAX = 22;                                   // 配乐同时发声上限（与音效并发上限互不占用）
const CHORDS = [                                      // Am – F – C – E（E 大三给和声小调的压迫感）
  { root:45, notes:[57, 60, 64] },
  { root:41, notes:[53, 57, 60] },
  { root:36, notes:[48, 52, 55] },
  { root:40, notes:[52, 56, 59] },
];
const PENTA = [0, 3, 5, 7, 10, 12, 15];               // A 小调五声
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
function musicMood(){
  if(S.over) return 'dead';
  if(battle) return battle.opts.siege ? 'siege' : 'combat';
  const p = phaseName()[1];
  if(S.hp < S.hpMax * .35) return 'tension';
  return p === 'night' ? 'night' : 'day';
}
function musicTempo(){
  const m = MUS.mood;
  if(m === 'siege') return 146;
  if(m === 'combat') return 132;
  if(m === 'night') return 52;
  if(m === 'tension') return 56;
  return 62;
}
function musicVoice(freq, t0, dur, type, gain, glideTo){
  if(MUS.voices >= MUS_MAX || !MUS.master) return;
  const c = actx(); if(!c) return;
  try{
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if(glideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), t0 + dur * .8);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(1.6, dur * .35));   // 慢起音，像远处飘过来
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(MUS.filt);
    MUS.voices++; o.onended = () => { MUS.voices = Math.max(0, MUS.voices - 1); };
    o.start(t0); o.stop(t0 + dur + .05);
  }catch(e){}
}
function musicNoiseHit(t0, gain, freq){               // 打击乐：滤波噪声当鼓/金属敲击
  const c = actx(); if(!c || MUS.voices >= MUS_MAX || !MUS.master) return;
  try{
    const len = Math.floor(c.sampleRate * .18), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for(let i = 0; i < len; i++) d[i] = (arnd() * 2 - 1) * Math.pow(1 - i / len, 2.4);
    const src = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
    f.type = freq > 800 ? 'bandpass' : 'lowpass'; f.frequency.value = freq; f.Q.value = 1.2;
    g.gain.value = gain;
    src.buffer = buf; src.connect(f).connect(g).connect(MUS.filt);
    MUS.voices++; src.onended = () => { MUS.voices = Math.max(0, MUS.voices - 1); };
    src.start(t0);
  }catch(e){}
}
function musicBar(){
  if(!MUS.on) return;
  const c = actx(); if(!c || !MUS.master) return;
  MUS.mood = musicMood();
  const bpm = musicTempo(), beat = 60 / bpm, barLen = beat * 4;
  let t0 = MUS.next || (c.currentTime + .1);
  if(t0 < c.currentTime + .05) t0 = c.currentTime + .05;   // 从后台回来：不补奏旧小节
  const ch = CHORDS[MUS.bar % CHORDS.length];
  const quiet = MUS.mood === 'tension' ? .6 : 1;

  // 1) 和声垫（整小节长音，轻微失谐形成拍频）
  ch.notes.forEach((n, i) => {
    musicVoice(mtof(n), t0, barLen * .95, 'sine', .028 * quiet);
    musicVoice(mtof(n) * 1.003, t0 + .05, barLen * .9, 'triangle', .012 * quiet);
  });
  // 2) 低音（每小节一个根音，夜晚更闷）
  musicVoice(mtof(ch.root), t0, barLen * .9, 'sine', (MUS.mood === 'night' ? .05 : .038));

  // 3) 旋律：白天稀疏、夜晚更少、战斗让位给节奏
  if(MUS.mood !== 'combat' && MUS.mood !== 'siege'){
    const p = MUS.mood === 'night' ? .16 : (MUS.mood === 'tension' ? .3 : .26);
    for(let b = 0; b < 4; b++){
      if(arnd() < p){
        const oct = arnd() < .22 ? 12 : 0;
        const n = 69 + PENTA[Math.floor(arnd() * PENTA.length)] + oct;   // A4 起
        musicVoice(mtof(n), t0 + b * beat, beat * 1.6, 'triangle', .03 * quiet);
      }
    }
    if(MUS.mood === 'night' && MUS.bar % 2 === 0){                        // 夜里心跳
      musicVoice(58, t0, .5, 'sine', .05, 40);
      musicVoice(54, t0 + beat * 2, .5, 'sine', .04, 38);
    }
  }
  // 4) 战斗/守夜：脉冲与敲击
  if(MUS.mood === 'combat' || MUS.mood === 'siege'){
    const hits = MUS.mood === 'siege' ? 4 : 3;
    for(let b = 0; b < hits; b++){
      musicVoice(120, t0 + b * beat, .22, 'sine', .06, 46);               // 底鼓
      if(b % 2 === 1) musicNoiseHit(t0 + b * beat + beat * .5, .035, 2100);
      if(arnd() < .45) musicNoiseHit(t0 + b * beat + beat * .25, .02, 520);
    }
  }
  // 5) 残血张力音：持续的小二度
  if(MUS.mood === 'tension'){ musicVoice(mtof(81), t0, barLen, 'sine', .012); musicVoice(mtof(82), t0, barLen, 'sine', .010); }

  MUS.next = t0 + barLen;
  MUS.bar++;
  // 按"本小节结束的绝对时刻"对齐下一个定时器：只减固定值会让误差逐小节累积
  // （实测 5 小节后预约时刻已跑到实时前面 2.8 秒，情绪采样会跟着漂）
  const fireIn = (MUS.next - c.currentTime) * 1000 - 150;
  MUS.timer = setTimeout(musicBar, Math.max(120, fireIn));
}
function musicStart(){
  if(MUS.on) return;
  const c = actx(); if(!c || !S.ui.music || !S.sfx) return;
  try{
    if(!MUS.master){
      MUS.master = c.createGain(); MUS.master.gain.value = 0;
      MUS.filt = c.createBiquadFilter(); MUS.filt.type = 'lowpass'; MUS.filt.frequency.value = 1150; MUS.filt.Q.value = .6;
      MUS.delay = c.createDelay(1.2); MUS.delay.delayTime.value = .42;
      const fb = c.createGain(); fb.gain.value = .3;
      const wet = c.createGain(); wet.gain.value = .28;
      MUS.filt.connect(MUS.master);
      MUS.filt.connect(MUS.delay); MUS.delay.connect(fb); fb.connect(MUS.delay); MUS.delay.connect(wet); wet.connect(MUS.master);
      MUS.master.connect(c.destination);
    }
    MUS.master.gain.cancelScheduledValues(c.currentTime);
    MUS.master.gain.setValueAtTime(MUS.master.gain.value, c.currentTime);
    MUS.master.gain.linearRampToValueAtTime(.5, c.currentTime + 2.5);     // 淡入，别吓人
    MUS.on = true; MUS.next = 0; MUS.bar = 0;
    musicBar();
  }catch(e){ MUS.on = false; }
}
function musicStop(){
  if(MUS.timer){ clearTimeout(MUS.timer); MUS.timer = null; }
  MUS.on = false;
  const c = actx();
  if(MUS.master && c){
    try{
      MUS.master.gain.cancelScheduledValues(c.currentTime);
      MUS.master.gain.setValueAtTime(MUS.master.gain.value, c.currentTime);
      MUS.master.gain.linearRampToValueAtTime(0, c.currentTime + .6);
    }catch(e){}
  }
}
/* 结局/死亡的一次性短动机（走独立的临时通道，不受主配乐淡出影响） */
function musicSting(kind){
  if(!S.ui.music || !S.sfx) return;
  const c = actx(); if(!c) return;
  try{
    const g = c.createGain(); g.gain.value = .12; g.connect(c.destination);
    const seq = kind === 'win' ? [69, 72, 76, 81] : [69, 68, 64, 57];
    seq.forEach((n, i) => {
      const o = c.createOscillator(), gg = c.createGain();
      const t0 = c.currentTime + .05 + i * .42;
      o.type = kind === 'win' ? 'triangle' : 'sine';
      o.frequency.setValueAtTime(mtof(n), t0);
      gg.gain.setValueAtTime(0.0001, t0);
      gg.gain.exponentialRampToValueAtTime(kind === 'win' ? .1 : .08, t0 + .12);
      gg.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.5);
      o.connect(gg).connect(g); o.start(t0); o.stop(t0 + 1.6);
    });
    setTimeout(() => { try{ g.disconnect(); }catch(e){} }, 4200);
  }catch(e){}
}
function tone(f0, f1, dur, type, vol){
  if(audioLive >= AUDIO_MAX) return;            // A9：并发上限，超了就丢帧，不堆节点
  const c = actx(); if(!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type || 'square'; o.frequency.setValueAtTime(f0, c.currentTime);
  if(f1) o.frequency.exponentialRampToValueAtTime(Math.max(30,f1), c.currentTime + dur);
  g.gain.setValueAtTime(vol || .05, c.currentTime);
  g.gain.exponentialRampToValueAtTime(.0001, c.currentTime + dur);
  o.connect(g).connect(c.destination);
  audioLive++; o.onended = () => { audioLive = Math.max(0, audioLive - 1); };
  o.start(); o.stop(c.currentTime + dur + .01);
}
let audioSeed = 20260911;
function arnd(){ audioSeed = (audioSeed * 1103515245 + 12345) & 0x7fffffff; return audioSeed / 0x7fffffff; }
function noise(dur, vol){
  if(audioLive >= AUDIO_MAX) return;            // A9
  const c = actx(); if(!c) return;
  const len = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
  for(let i = 0; i < len; i++) d[i] = (arnd() * 2 - 1) * (1 - i / len);   // 音频噪声用独立随机源，别污染游戏随机流
  const src = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 1100; g.gain.value = vol || .18;
  src.buffer = buf; src.connect(f).connect(g).connect(c.destination);
  audioLive++; src.onended = () => { audioLive = Math.max(0, audioLive - 1); };
  src.start();
}
const SFX = {
  ui:    () => tone(420, 300, .05, 'square', .03),
  shoot: () => { noise(.14, .22); tone(180, 60, .12, 'sawtooth', .06); },
  melee: () => { noise(.09, .16); tone(120, 70, .1, 'triangle', .05); },
  hit:   () => { noise(.07, .13); tone(90, 50, .09, 'sine', .05); },
  hurt:  () => tone(220, 90, .22, 'sawtooth', .07),
  loot:  () => { tone(660, 880, .09, 'sine', .05); setTimeout(() => tone(880, 1180, .12, 'sine', .045), 70); },
  ok:    () => { tone(520, 780, .12, 'triangle', .05); },
  bad:   () => { tone(200, 120, .3, 'sawtooth', .06); },
  win:   () => [0,120,240,380].forEach((t,i) => setTimeout(() => tone([523,659,784,1046][i], null, .22, 'triangle', .05), t)),
  lose:  () => [0,180,360].forEach((t,i) => setTimeout(() => tone([330,247,165][i], null, .5, 'sine', .07), t)),
  night: () => tone(160, 60, .8, 'sine', .05),
};
function sfx(k){ if(S.sfx && SFX[k]) { try{ SFX[k](); }catch(e){} } }

/* ───────────── 视觉反馈 ───────────── */
function floatText(txt, cls, anchor){
  const el = document.createElement('div');
  el.className = 'dmg ' + (cls || '');
  el.textContent = txt;
  let x = window.innerWidth / 2, y = window.innerHeight / 2;
  if(anchor && anchor.getBoundingClientRect){
    const r = anchor.getBoundingClientRect();   // C13：锚到实际挨打的那张卡／生命条；单次读取，不循环
    x = r.left + r.width / 2;
    y = r.top + Math.min(r.height * .45, 44);
  }
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  $('#fx').appendChild(el);
  setTimeout(() => el.remove(), 1000);
}
function shake(){ const a = $('#app'); a.classList.remove('shake'); void a.offsetWidth; a.classList.add('shake'); setTimeout(() => a.classList.remove('shake'), 300); }
function toast(title, body, kind){
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.innerHTML = '<b>' + esc(title) + '</b>' + esc(body || '');
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.transition = '.4s'; el.style.opacity = '0'; el.style.transform = 'translateX(30px)'; setTimeout(() => el.remove(), 420); }, 3600);
}
/* C04/C06 触发式提示：每条只弹一次，靠存档去重 */
let tipLast = 0;
function firstTip(key, msg){
  if(!S.flags.tips) S.flags.tips = {};
  if(S.flags.tips[key]) return false;
  S.flags.tips[key] = 1;
  const now = Date.now();
  if(now - tipLast < 700) { setTimeout(() => toast('💡 提示', msg, 'ok'), 720); }   // 同屏节流，避免连弹
  else toast('💡 提示', msg, 'ok');
  tipLast = now;
  return true;
}
function award(id){
  if(S.ach.indexOf(id) >= 0) return;
  const a = ACHIEVEMENTS.find(x => x.id === id); if(!a) return;
  S.ach.push(id); sfx('win');
  toast('🏆 成就解锁 · ' + a.n, a.d, 'ok');
}
function addXP(sk, amt){
  /* 修（M24，用户报"技能完全没用途"的根因）：原来写的是 `if(!S.skills[sk]) return;`——
     而技能初始等级就是 0，`!0 === true`，于是**任何技能都拿不到第一点经验，永远停在 Lv.0**。
     正确写法是"这条技能不存在才返回"（未定义才拦，0 级是合法的起点）。 */
  if(S.skills[sk] === undefined || S.xp[sk] === undefined) return;
  const lv = S.skills[sk];
  if(lv >= 10) return;
  S.xp[sk] += amt;
  let need = 20 + lv * 26;
  while(S.xp[sk] >= need && S.skills[sk] < 10){
    S.xp[sk] -= need; S.skills[sk]++;
    if(S.skills[sk] === 10) S.xp[sk] = 0;
    need = 20 + S.skills[sk] * 26;
    toast('📈 ' + SKILLS[sk].n + ' 提升到 Lv.' + S.skills[sk], SKILLS[sk].desc, 'ok');
    if(sk === 'fitness'){ S.staMax = 100 + S.skills.fitness * 5; S.sta = Math.min(S.staMax, S.sta + 5); }
  }
}

/* ───────────── 日志 ───────────── */
/* M49：跟不跟最新一行，看**玩家意图**（用户报障：「现场日志不知道为什么无法自动滚动」）。
   旧逻辑（M43）是"写每一行之前量一下离底多远"——而 #log 是 scroll-behavior:smooth，
   程序补底之后动画还在路上，这一量就是"离底两千多像素"，于是被当成"玩家往上翻了"，从此彻底不跟。
   现在：玩家的动作（轮子/手指/PgUp）才关跟随；程序补底期间（260ms 窗口）的滚动事件不参与判断。 */
let logFollow = true;        // 玩家是不是在跟最新一行（默认跟）
let logFollowWhy = '';       // 上一次"关掉跟随"是谁干的（自测/探针取证用；跟着时是空串）
let logPinUntil = 0;         // 这段时刻之前，日志面板的 scroll 事件算"我们自己滚的"
function logAtBottom(slack){ const b = $('#log'); return !!b && shouldStickToBottom(b, slack === undefined ? 24 : slack); }
/** 玩家意图 → 跟随开关（纯逻辑在 v4/scroll-keep.nextLogFollow） */
function logFollowBy(ev, why){
  const next = nextLogFollow(logFollow, ev);
  if(logFollow && !next) logFollowWhy = why || 'unknown';     // 只在"被关掉"时记一笔（探针取证用）
  if(next) logFollowWhy = '';
  logFollow = next;
}
/** 面板粘到最新一行：只要还在跟随就一直补（smooth 动画没跑完也不怕） */
function logPin(tries){
  const b = $('#log'); if(!b || !logFollow) return;
  b.scrollTop = b.scrollHeight;
  logPinUntil = (typeof performance === 'object' && performance.now) ? performance.now() + 260 : 0;
  if((tries || 0) < 12) requestAnimationFrame(() => logPin((tries || 0) + 1));
}
/** 给日志面板装"玩家意图"监听（只装一次）：轮子/手指/滚动条/键盘 + scroll 兜底 */
function bindLogFollow(){
  const box = $('#log');
  if(!box || box.__followBound) return;
  box.__followBound = true;
  /* 只有"面板真的能滚"时，往上翻才算"去看历史"（内容比面板短的时候怎么拨都没得看，继续跟） */
  const canScroll = () => box.scrollHeight - box.clientHeight > 4;
  box.addEventListener('wheel', e => {
    if((e.deltaY || 0) < 0 && canScroll()) logFollowBy({ userScrollingUp: true }, 'wheel');
    /* 往下拨**不在这里判"到底了没有"**：smooth 动画还在路上时量位置一定偏上，会把"人已经滚回底部"
       误判成"还在上面"（探针实测：滚回底部之后仍 d=178）。交给 scroll 监听按最终位置更新 —— 那才是真相。 */
  }, { passive: true });
  let lastY = 0;
  box.addEventListener('touchstart', e => { lastY = (e.touches[0] || {}).clientY || 0; }, { passive: true });
  box.addEventListener('touchmove', e => {
    const y = (e.touches[0] || {}).clientY || 0;                     // 手指往下拖 = 在看更早的行
    if(y - lastY > 2 && canScroll()) logFollowBy({ userScrollingUp: true }, 'touch');
    lastY = y;
  }, { passive: true });
  box.addEventListener('mousedown', () => { logPinUntil = 0; });      // 拖滚动条：马上按真实位置判
  box.addEventListener('keydown', e => {
    if(isAwayKey(e.key) && canScroll()) logFollowBy({ userScrollingUp: true }, 'key:' + e.key);
    /* PgDn/Down/End 同理：等滚动真的落到底部，由 scroll 监听把跟随打开 */
  });
  /* 其余滚动 = 玩家自己滚的（我们自己的补底在上面被时间戳挡掉了）：**等滚动落定 140ms 再判**。
     途中就判会被 smooth 动画骗：动画还没跑完时量到的是"离底两千多像素"，于是"玩家明明滚回底部了"被判成"还在上面"，
     跟随再也打不开（探针实测 d=178 卡在那里）。落定之后位置才是玩家真正停在的地方。 */
  let settleTimer = 0;
  let lastTop = box.scrollTop;
  box.addEventListener('scroll', () => {
    const top = box.scrollTop;
    const movedUp = top < lastTop - 1;      // 往上走 = 玩家在翻历史（我们自己的补底只会往下走）
    lastTop = top;
    const inPin = logPinUntil && (typeof performance !== 'object' || !performance.now || performance.now() < logPinUntil);
    if(inPin) return;                       // 补底窗口内一律不判：clearLog / 裁行 / render 还原都会让 scrollTop 往上跳
                                            //（玩家真正的往上翻走输入事件那条路：轮子/触摸/键盘/拖滚动条，见上面）
    if(movedUp) logFollowBy({ userScrollingUp: true }, 'scrollUp');   // 立刻停跟随：不给"下一行把我拽回去"留窗口
    if(typeof setTimeout !== 'function'){ logFollowBy({ userAtBottom: logAtBottom(48) }); return; }
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { logFollowBy({ userAtBottom: logAtBottom(48) }, 'settle'); }, 140);   // 落定后：真的回到底部就重新跟上
  }, { passive: true });
}
function log(msg, type){
  type = type || 'narrative';
  const el = document.createElement('div');
  el.className = 'le ' + type;
  el.textContent = msg;
  const box = $('#log');
  box.appendChild(el);
  while(box.children.length > 260){
    box.removeChild(box.firstChild);
    /* 裁掉最老那行会让 scrollTop 自己变小 —— 紧接着的 scroll 事件是"我们的"，不是玩家往上翻 */
    if(typeof performance === 'object' && performance.now) logPinUntil = performance.now() + 120;
  }
  if(logFollow){
    /* 刚 append 的那一行要等布局才算进 scrollHeight，字号/换行也可能再晚一点才定 —— 
       下一帧、80ms、300ms 各补一次，再挂 MutationObserver 兜底（见下）。守卫是 logFollow（玩家意图），
       **不再量距离**：量距离会被 smooth 动画骗到，那正是"日志不跟了"的根因。 */
    try{ requestAnimationFrame(() => logPin(0)); setTimeout(() => logPin(12), 80); setTimeout(() => logPin(12), 300); attachLogStick(); }catch(_){}
  }
  S.logBuf.push([type, msg]);
  if(S.logBuf.length > 90) S.logBuf.shift();
}
/* M49：内容可能在补底之后才真正长高（换行、字体度量），所以除了那几次补底，
   再挂一个 MutationObserver：只要**玩家还在跟**（logFollow）就继续补到最新一行。
   玩家一旦往上翻，logFollow=false，这里就彻底不动他。 */
let logStickObs = null;
function attachLogStick(){
  bindLogFollow();
  const box = $('#log');
  if(!box || logStickObs || typeof MutationObserver === "undefined") return;
  logStickObs = new MutationObserver(() => { if(logFollow) requestAnimationFrame(() => logPin(12)); });
  logStickObs.observe(box, { childList: true });
}
function clearLog(){
  $('#log').innerHTML = '';          // 清空会让 scrollTop 自己掉回 0：那一下是我们的，不是玩家往上翻
  logFollow = true;
  if(typeof performance === 'object' && performance.now) logPinUntil = performance.now() + 200;   // 这一下是我们自己滚的
}
function replayLog(){
  const box = $('#log'); box.innerHTML = '';
  (S.logBuf || []).slice(-40).forEach(p => { const d = document.createElement('div'); d.className = 'le ' + p[0]; d.textContent = p[1]; box.appendChild(d); });
  logFollow = true;
  box.scrollTop = box.scrollHeight;
  if(typeof performance === 'object' && performance.now) logPinUntil = performance.now() + 200;   // 这一下是我们自己滚的
}
function hr(){ log('────────────────────────','system'); }

/* ───────────── 计算 ───────────── */
function skillBonus(sk, per, cap){ return Math.min(cap === undefined ? .6 : cap, S.skills[sk] * per); }
function capWeight(){
  let c = 100 + S.skills.fitness * 6;
  const b = S.eq.bag; if(b && ITEMS[b].cap) c += ITEMS[b].cap;
  return c;
}
function carryWeight(){
  let w = 0, id;
  for(id in S.inv) w += (ITEMS[id] ? ITEMS[id].w : .5) * S.inv[id];
  for(id in S.eq){ const e = S.eq[id]; if(e && ITEMS[e]) w += ITEMS[e].w; }
  if(S.eq.wpn) w += modSum(S.eq.wpn, 'wadd');   // C22：扩容弹匣的重量代价
  return Math.round(w * 10) / 10;
}
function encumbrance(){ return carryWeight() / capWeight(); }
function armorTotal(){
  let a = 0;
  ['head','body','mask','feet'].forEach(sl => { const g = S.eq[sl]; if(g && ITEMS[g].armor) a += ITEMS[g].armor; });
  return a + Math.floor(S.skills.fitness / 3);
}
function addItem(id, n, silent){
  n = n || 1;
  if(!ITEMS[id]) return;
  S.inv[id] = (S.inv[id] || 0) + n;
  if(ITEMS[id].t === 'ammo') syncAmmo();       // M32b：捡到/做到弹药立刻刷新 S.ammo 镜像
  if(!silent){
    const over = encumbrance() > 1;
    log('📦 获得 ' + ITEMS[id].n + ' ×' + n + (over ? '（超重！移动变慢）' : ''), 'loot');
    if(over) firstTip('over', '超重了：把用不上的东西存进据点储物箱——超重会加快体力消耗并降低闪避。');
  }
}
function takeItem(id, n){
  n = n || 1;
  if(!S.inv[id] || S.inv[id] < n) return false;
  S.inv[id] -= n; if(S.inv[id] <= 0) delete S.inv[id];
  if(ITEMS[id] && ITEMS[id].t === 'ammo') syncAmmo();
  return true;
}
function itemCount(id){ return S.inv[id] || 0; }
function has(id, n){ return itemCount(id) >= (n || 1); }
function ammoInMag(){ return S.ammo; }

/* ───────────── 时段 / 行动力 / 昼夜 ───────────── */
/* M25.2：一天从 9 点提到 14 点（用户：「一天也太短了」），所以时段阈值改成**按比例**
   （清晨 7%、黄昏 71%、夜晚 86%），以后调 AP_MAX_BASE 不用再回来改这三个数。
   M25.3：用户接着说「我的意思是天黑的太早了」—— 14 点里旧阈值（57%/71%）等于**一半以上的
   行动都在黄昏和黑夜里做**，屏幕一直压着一层暗色（那不是他的本意）。所以把黄昏推到 71%、
   夜晚留到 86%：一整天里前 10 点（14 点制的 7~10 点）都是白天，天黑只是最后 2 点收尾。 */
function apCapNow(){ return Math.max(1, S.apMax || 14); }
function phaseName(){
  const p = phaseOf(apCapNow() - S.ap, apCapNow());     // M25.3：曲线真值在 night-core（可单测）
  return [PHASE_LABEL[p], p === 'dawn' ? 'day' : p];
}
function spendAP(n, label){
  n = n || 1;
  if(S.ap < n){ toast('行动力不足','今天做不了更多了，回据点睡觉进入下一天。','bad'); return false; }
  S.ap -= n;
  if(S.ap <= 0) firstTip('noap', '行动力用完了：睡觉进入下一天（会消耗食物与水，夜里也可能遇上尸潮）。');
  return true;
}
function tickVitals(mult){
  mult = mult || 1;
  const cut = 1 - skillBonus('survival', .03, .35);
  /* M30：干燥/中暑/脱水放大水分消耗（湿度是天气的导出量，所以玩家能靠看天预判） */
  const sv = (typeof window.V4Survival === 'object' && window.V4Survival) ? window.V4Survival : null;
  const vm = sv ? sv.vitalsMul() : { thirst: 1, temp: 1 };
  S.hun = clamp(S.hun - 3.6 * cut * mult, 0, 100);
  S.thi = clamp(S.thi - 4.4 * cut * mult * vm.thirst, 0, 100);
  const enc = encumbrance();
  /* M25：体内辐射压低体力上限（重度辐射时几乎跑不动）；M30：病症再压一档（中暑 −30% 等） */
  const radCap = S.staMax * radTier(S.rad).staMul * (sv ? sv.staCapMul() : 1);
  S.sta = clamp(S.sta - (6 + enc * 6) * mult, 0, radCap);
  /* M30：病症链推进（每若干步结算一次病程，掉血在 step 里扣） */
  if(sv) sv.step(1);
  /* M31：人体伤病的出血与康复也按步推进（medical.ts 内部有节流） */
  { const md = (typeof window.V4Medical === 'object' && window.V4Medical) ? window.V4Medical : null; if(md) md.stepBody(); }
  if(S.hun <= 0){ S.hp -= 4; log('🍖 饥饿到了极限，身体在消耗自己。','danger'); }
  else if(S.hun < 18) log('🍖 你饿得手在抖（伤害与命中下降）。','dim');
  if(S.thi <= 0){ S.hp -= 5; log('💧 严重脱水，视线开始发黑。','danger'); }   // C08：归零掉血 6/8 → 4/5，别让饥饿单独构成死亡螺旋
  else if(S.thi < 18) log('💧 喉咙干得发疼（闪避下降）。','dim');
  if(S.infect >= 100){ S.hp = 0; log('🦠 病毒攻陷了中枢。你听见自己的呼吸变成了别人的。','danger'); }
  if(S.noise > 0) firstTip('noise', '噪音越高，夜里越容易被尸潮撞门：近战无声，开枪很吵。');
}
function statMods(){
  const m = { dmgMul:1, dodge:0, note:[] };
  if(S.hun < 18){ m.dmgMul -= .15; m.note.push('饥饿'); }
  if(S.thi < 18){ m.dodge -= .10; m.note.push('脱水'); }
  if(S.infect >= 60){ m.dmgMul -= .15; m.note.push('感染加重'); }
  if(S.sta < 20){ m.dmgMul -= .10; m.note.push('力竭'); }
  if(encumbrance() > 1){ m.dodge -= .12; m.note.push('超重'); }
  if(S.comp === 'vet') m.dmgMul += .05;
  // v3.0 伤口惩罚（骨折走不快已在 travelCost 里另算）
  // 流血的提示交给 HUD 的伤口 chip，不再塞进 note（避免同一屏重复两次）
  if(hasWound('fracture')){ m.dodge -= .10; }
  if(hasWound('sick')){ m.dmgMul -= .10; }
  /* M30：湿度病症（中暑/脱水/呼吸道/真菌）合并进来 —— 数值在 survival-core，这里只合账 */
  const sv2 = (typeof window.V4Survival === 'object' && window.V4Survival) ? window.V4Survival : null;
  if(sv2){
    const cp = sv2.penaltyNow();
    m.dmgMul -= (1 - cp.apMul) * 0.5;        // 体力上限被压 → 伤害也弱一点（不叠加到 0，取一半）
    m.dodge -= cp.hit;
    const names = sv2.condNames();
    if(names.length) m.note.push(names.join('/'));
  }
  /* M25：辐射分档惩罚（轻度只提示、明显以上真的扣战力与治疗） */
  {
    const rt = radTier(S.rad);
    if(rt.tier >= 2) m.dmgMul -= .10;
    if(rt.tier >= 3) m.dodge -= .10;
    if(rt.tier >= 1) m.note.push('辐射 ' + rt.label);
  }
  /* M31：人体伤病的惩罚（双轨制：部位伤只影响能力，不参与生死判定） */
  {
    const md = (typeof window.V4Medical === 'object' && window.V4Medical) ? window.V4Medical : null;
    if(md){
      const bp = md.bodyPenaltyNow();
      m.dodge += bp.dodge;
      m.dmgMul *= bp.dmgMul;
      m.hit = (m.hit || 0) + bp.hit;
      if(bp.note.length) m.note.push(bp.note.slice(0, 2).join('/') + (bp.note.length > 2 ? '…' : ''));
    }
  }
  return m;
}
function sleepNight(){
  if(S.over) return;
  hr();
  defInit();
  const atBase = S.loc === 'base';
  if(!atBase) log('⚠️ 你在外面过夜：没有墙，只有一堆纸箱和一件外套。', 'danger');
  log('🌙 你把门窗顶死，缩进角落。这一夜会很长……','system');
  sfx('night');
  // 夜间消耗（M55：野外 ×1.5 —— 没热饭没净水，冻一夜更耗人）
  const cut = 1 - skillBonus('survival', .03, .35);
  const eat = nightConsumption(atBase);
  S.hun = clamp(S.hun - eat.hun * cut, 0, 100);
  S.thi = clamp(S.thi - eat.thi * cut, 0, 100);
  /* M30：病程在夜里推进得更快（"病了就早睡"要真的有用） */
  { const svN = (typeof window.V4Survival === 'object' && window.V4Survival) ? window.V4Survival : null; if(svN) svN.nightStep(); }
  /* M31：过夜也是康复的关键窗口（睡一觉，手术过的伤恢复得更快） */
  { const mdN = (typeof window.V4Medical === 'object' && window.V4Medical) ? window.V4Medical : null; if(mdN) mdN.nightBody(); }
  S.sta = S.staMax;
  /* M55：饥饿/脱水的夜间结算（用户报的速通漏洞就在这里 —— 以前睡觉这条路完全不结算饥饿伤害，
     于是"不吃不喝一直睡"既能回血又能推进天数，直接睡到第 100 天通关）。
     现在：归零当晚就掉血、连睡加剧、空腹回血只剩 1/4。 */
  const starve = starvationTick({ hun: S.hun, thi: S.thi, starveN: S.starveN, thirstN: S.thirstN });
  S.starveN = starve.starveN; S.thirstN = starve.thirstN;
  if(starve.hpLoss > 0){ S.hp -= starve.hpLoss; for(const ln of starve.lines) log(ln, 'danger'); }
  const warn = sleepWarning(S.hun, S.thi);
  if(warn) log(warn, 'danger');
  const bedHeal = Math.round((12 + S.base.bed * 9) * (atBase ? 1 : .45) * sleepHealMul(S.hun, S.thi));
  S.hp = Math.min(S.hpMax, S.hp + bedHeal);
  log('😴 睡了 ' + (atBase ? (S.base.bed ? '行军床' : '地板') : '露天') + '，恢复 ' + bedHeal + ' 生命、全部体力。' +
    (sleepHealMul(S.hun, S.thi) < 1 ? '（空腹/脱水：只恢复四分之一）' : ''),'success');
  // 感染自然消退 / 爆发
  if(S.infect > 0){
    if(S.infect >= 60){
      S.infect = Math.min(100, S.infect + 2);
      log('🦠 感染进入爆发期（+2%）。你开始听见不属于自己的声音。','danger');
    } else if(S.hun > 25 && S.thi > 25){   // C08：消退阈值 45 → 25，拆掉 18~45 之间的纯惩罚区
      const dec = 1 + Math.floor(S.skills.medic / 3);
      S.infect = Math.max(0, S.infect - dec);
      log('💉 身体在夜里压下了 ' + dec + ' 点感染。','info');
    } else {
      S.infect = Math.min(100, S.infect + 1);
      log('🦠 虚弱让感染又推进了 1 点。','danger');
    }
  }
  // 据点产出（v3.0：断水断电后净水器要烧燃料；菜园改为产新鲜蔬菜，会烂）
  const powered = (S.base.power || 0) > 0;              // M25：自建发电机 = 自己发电，不看电网脸色
  if(S.base.filter){
    const n = S.base.filter + (powered ? 1 : 0);        // M25 发电机：净水 +1
    if(powered){ addItem('water', n, true); log('🚰 净水装置产出 ' + n + ' 份净水（发电机供电 +1）。','success'); }
    else if(!powerOff()){ addItem('water', n, true); log('🚰 净水装置产出 ' + n + ' 份净水。','success'); }
    else if(has('fuel')){ takeItem('fuel', 1); addItem('water', n, true); log('⛽ 电网断了，你用汽油发电机带净水器跑了一夜（-1 汽油，+' + n + ' 净水）。','success'); }
    else log('🔌 断电了，净水器没燃料——今天没有净水产出。','danger');
  }
  if(S.base.garden){
    const n = S.base.garden;
    addItem('veg', n, true);
    /* M25 发电机：菜园生长快一天 —— 直接体现在保鲜期上（当晚收的菜能多放一天），
       比"改生长进度"更好懂：玩家看到的是"菜不容易烂了"。 */
    S.spoil.veg = ITEMS.veg.fresh + (powered ? 1 : 0);
    log('🌱 菜园收成 ' + n + ' 份新鲜蔬菜（' + S.spoil.veg + ' 天内要吃掉或炖了）。','success');
  }
  // 食物腐坏 / 伤口 / 防线自愈
  spoilTick();
  woundTick();
  const dm = defMax();
  if(atBase){ S.def.doorHp = Math.min(dm.door, S.def.doorHp + 6); S.def.wallHp = Math.min(dm.wall, S.def.wallHp + 5); }
  if(S.hp <= 0){ gameOver('伤口与饥饿在夜里一起收走了你。'); return; }
  // 尸潮判定（C18：判定保留、频率不变，但结算改成可玩的守夜战，放在天亮之后接）
  // v3.0：血月（每 7 天）与尸群迁徙到达时**必定**开战
  S.cal.bloodMoon = (S.day % 7 === 0);
  const hordeArrived = S.horde.eta > 0 && S.horde.eta - 1 <= 0;
  const raid = raidChance(S.day, S.noise);   // M54：概率算式在 v4/base-core（据点页展示的就是它）
  S.noise = Math.max(0, S.noise - 1);
  const raiding = S.cal.bloodMoon || hordeArrived || chance(Math.min(raid, .6));
  if(S.horde.eta > 0) S.horde.eta--;
  S.noise = Math.max(0, Math.round(S.noise * .4));
  S.day++; S.ap = S.apMax; S.stats.nights++;
  S.eliteToday = 0;        // C16：每日精英额度重置
  shopDayCheck();          // C22：商人每日限购重置
  rollBounties();          // C17：刷新委托板
  sideNightCheck();        // C21：条件步（感染 ≥40 活过一夜）
  if(S.cal.bloodMoon) log('🩸 血月在头顶——今天晚上不会安静。','danger');
  else if(hordeArrived) log('🧟 你听见了成片的脚步：迁徙的尸群到了。','danger');
  else if(!raiding) log('🌅 天亮了，什么都没有发生——这才是最可怕的。','dim');
  // 中期转折：第 14 天断水断电
  if(S.day >= 14 && !S.cal.powerOff){
    S.cal.powerOff = true;
    log('🔌 第 14 天：城市的电网彻底死了。净水器要烧燃料，生鲜开始腐烂，夜里的城市比之前更黑。','danger');
    toast('🔌 断水断电', '净水器需要汽油；生鲜 4 天内会烂；夜里出门更危险', 'bad');
  }
  // 第 100 天：救援结局（有无线电才有人来接）
  if(S.day > GOAL_DAY && !S.flags.won){ rescueEnding(); return; }
  // 病毒群体进化
  if(S.day % 5 === 0){
    S.hpMax += 10; S.hp = Math.min(S.hpMax, S.hp + 10);
    log('☀️ 第 ' + S.day + ' 天。病毒完成了一次群体进化——它们更快、更硬了。','system');
    log('❤️ 你的最大生命 +10（' + S.hpMax + '），这是身体在同步适应。','success');
    if(discoverLore('l_evo')) log('📖 秘闻解锁：丧尸进化论','lore');
  }
  checkQuest();
  checkAch();
  autosave();
  render();
  if(raiding) nightRaid();   // C18：守夜战最后接，它会自己开战斗弹窗
}
/* C18 夜间守夜战：尸潮从"一次性扣血结算"变成 1–2 回合的防守战。
   围墙/门窗每级直接少来一个方向的敌人；守住有收获，弃守走原来的损失分支（威胁总量不降、频率不变）。 */
function nightRaid(){
  defInit();
  S.stats.hordes++;
  sfx('bad'); shake();
  const blood = !!S.cal.bloodMoon;
  const horde = S.horde.eta <= 0 && S.horde.size > 0;
  const guardCut = S.base.wall + S.base.door;                    // 防线设施：每级少来一个方向
  const mul = (blood ? 1.9 : 1) * (horde ? 1.3 : 1);
  let count = clamp(Math.round((2 + Math.floor(S.day / 8) - guardCut * .6) * mul), 1, 6);
  if(horde) count = clamp(count + Math.round(S.horde.size / 3), 1, 7);
  const pool = ['walker','walker','crawler','runner'];
  if(S.day >= 8) pool.push('brute');
  if(S.day >= 15) pool.push('hound','brute');
  if(S.day >= 25) pool.push('giant');
  /* M11：新敌人按天数进池——自爆者逼你留远程手段，喷吐者逼你别指望格挡，
     孵化者逼你优先集火。血月再加一次暴君的抽奖（低权重）。 */
  if(S.day >= 12) pool.push('bomber');
  if(S.day >= 20) pool.push('spitter');
  if(S.day >= 30) pool.push('hatcher');
  const tyrantChance = blood ? .18 : (horde ? .1 : 0);
  const foes = [];
  for(let i = 0; i < count; i++) foes.push(pick(pool));
  if(Math.random() < tyrantChance){
    foes[0] = 'tyrant';
    log('💢 尸潮后面跟着个三米高的东西——它把围墙当纸。','danger');
  }
  log('💀💀💀 ' + (blood ? '血月夜，' : (horde ? '迁徙的尸群，' : '')) + '尸潮撞上据点！' +
      (guardCut ? '围墙和门窗替你挡掉了 ' + Math.min(guardCut, 3) + ' 个方向，' : '') + '还有 ' + count + ' 只挤了进来。', 'danger');
  startCombat(foes, {
    title:(blood ? '🩸 血月守夜 · 第 ' : '🛡️ 夜间守夜 · 第 ') + S.day + ' 天', sub:'尸潮', siege:true, bloodMoon:blood,
    hint:'它们在砸门窗（看右侧防线）。撑住就没事；撑不住可以按 5 弃守——据点会被搜刮一空。',
    onWin(){
      const loot = Math.round((4 + Math.floor(S.day / 3)) * (blood ? 2 : 1) * (horde ? 1.5 : 1));
      S.mat += loot; S.sta = S.staMax;
      log('🧱 天光发白，尸潮退去。你在门口捡回 ' + loot + ' 份材料。', 'success');
      if(blood){ log('🩸 你守住了第一个血月。城市里还有别的东西在看着你。', 'success'); S.cal.bloodMoon = false; }
      if(horde){ S.horde = { eta:0, size:0 }; log('🧟 迁徙的尸群被清空了，路上暂时会安静几天。', 'success'); }
      award('a_horde');
    },
    onFlee(){
      /* M54：弃守代价的算式搬到 v4/base-core（据点页会提前把这笔账算给玩家看，两处必须是同一个数） */
      const c = abandonCost({ day: S.day, doorLv: S.base.door || 0, wallLv: S.base.wall || 0, blood: blood, mat: S.mat });
      const hpLoss = c.hpLoss, matLoss = c.matLoss;
      S.hp -= hpLoss; S.mat = Math.max(0, S.mat - matLoss);
      S.def.doorHp = 0; S.def.wallHp = 0;
      log('🏚️ 你弃守了据点：受伤 ' + hpLoss + ' 点，物资损失 ' + matLoss + '，门窗全被拆了。', 'combat');
      if(S.comp) log('🤝 ' + COMPANIONS[S.comp].n + ' 掩护你撤进了地下室。', 'info');
      if(S.hp <= 0){ S.hp = 0; gameOver('你在撤离时被尸潮淹没了。', { noRescue:true }); }
    }
  });
  // 陷阱在开场结算（这是"提前准备"的回报）
  if(!battle) return;
  const tr = S.def.traps;
  if(tr.alarm > 0){ tr.alarm--; battle.foes.forEach(f => { f.hp = Math.round(f.hp * .8); }); cbLog('📡 警报器提前暴露了它们（全体 -20% 生命）。', 'good'); }
  if(tr.spike > 0){ tr.spike--; const f = battle.foes[0]; f.hp -= 22; cbLog('🔺 钉刺陷阱撕开了 ' + f.n + '（-22）。', 'good'); if(f.hp <= 0) killFoe(f); }
  if(tr.fire > 0){ tr.fire--; battle.foes.forEach(f => { if(!f.dead) f.hp -= 26; }); cbLog('🔥 燃烧陷阱烧成一片（全体 -26）。', 'good');
    battle.foes.forEach(f => { if(f.hp <= 0 && !f.dead) killFoe(f); }); }
  drawCombat();
}
/* 守夜战中的抢修：花行动力与材料把防线补回去（战斗里最值钱的操作） */
function combatRepair(){
  const b = battle; if(!b || !b.opts.siege) return;
  const m = defMax();
  if(S.def.doorHp >= m.door && S.def.wallHp >= m.wall){ cbLog('防线是完好的。', 'sys'); drawCombat(); return; }
  if(!has('metal', 2) || !has('wood', 2)){ cbLog('❌ 抢修需要铁片 ×2 与木料 ×2。', 'hurt'); drawCombat(); return; }
  if(S.ap < 1){ cbLog('❌ 没有行动力了，只能硬扛。', 'hurt'); drawCombat(); return; }
  S.ap--; takeItem('metal', 2); takeItem('wood', 2);
  S.def.doorHp = m.door; S.def.wallHp = Math.min(m.wall, S.def.wallHp + 30);
  sfx('ok'); cbLog('🔨 你顶着它们把门钉回去（门 ' + S.def.doorHp + ' / 墙 ' + S.def.wallHp + '）。', 'good');
  renderHud(); drawCombat();
}
/* 第 100 天：救援结局（有无线电才有人来接你） */
function rescueEnding(){
  /* M51：通关不再置 S.over —— over 是 v4 世界面板/移动/夜间结算的总闸，置上就等于把整屏交回
     旧版探索页（旧版「城市地图」+「本局已通关」图例），玩家得再点一次按钮才回得来。
     现在通关当场转入无尽延续（winContinue：清 over + 开 endless），界面全程是 v4。 */
  S.flags.won = true; S.flags.cured = false; S.quest.stage = 6;
  winContinue();
  sfx('win'); musicSting('win');
  const radio = S.base.radio > 0;
  hr();
  log('🚁 第 ' + S.day + ' 天，清晨。', 'system');
  if(radio){
    log('无线电里传来一个陌生又疲惫的声音：“坐标确认，屋顶清空，我们三分钟后到。”', 'narrative');
    log('你站在安全屋的屋顶上，看着那架直升机从灰白色的天际线里钻出来。', 'narrative');
    log('🏆 你活到了第 100 天，并且活着离开了这座城市。', 'success');
  } else {
    log('没有人来。无线电一直是沙沙声。', 'narrative');
    log('你活到了第 100 天——在这个世界上，这已经是一种胜利。', 'success');
  }
  const sc = runScore();
  log('📊 存活 ' + sc.days + ' 天 · 击杀 ' + sc.kills + ' · 探索 ' + sc.zones + ' 处 · 评分 ' + sc.rank, 'info');
  award('a_endless');
  modal({ title:'🚁 第 100 天', sticky:true,
    body:'<p class="muted">' + (radio ? '救援直升机把你带离了城市。' : '没人来接你，但你活下来了。') + '</p>' +
      '<p class="muted" style="margin-top:10px">游戏没有结束：你已经在<b>无尽模式</b>里了——丧尸仍会按天数进化，据点、图鉴、结局档案都还在。</p>' +
      recapHtml(sc),
    footer:'<button class="btn warn" data-close>♾️ 继续活下去（无尽）</button>' });
  /* M15：救援结局（把消息播出去过 → 「频率上的名字」，否则「第 100 天」） */
  if(window.__v4Ending) window.__v4Ending('rescue');
  render(); autosave();
}
function recapHtml(sc){
  /* M57：六格数字 + 这一局的瞬间（有料的才上，最多四条） */
  const s = {
    day: S.day, hp: 0, hun: S.hun, thi: S.thi, infect: S.infect, rad: S.rad, mat: S.mat, wounds: [],
    loc: S.loc, stats: S.stats, visited: Object.keys((S.world && S.world.visited) || {}).length,
    regions: Object.keys((S.world && S.world.seenRegions) || {}).length,
    lore: S.lore.length, baseLv: baseLevel(), score: sc.raw,
  };
  return '<div class="grid g3" style="margin-top:12px">' +
    [['存活天数', sc.days], ['击杀', sc.kills], ['到过的地方', sc.zones], ['据点等级', baseLevel()],
     ['秘闻', S.lore.length + '/' + LORE.length], ['评分', sc.raw]].map(r =>
      '<div class="card" style="padding:10px"><div class="hint">' + r[0] + '</div><div class="mono" style="font-size:18px;color:var(--bone)">' + r[1] + '</div></div>').join('') +
    '</div><p class="muted" style="margin-top:10px">评级：<b style="color:var(--warn)">' + sc.rank + '</b></p>' +
    '<div class="card" style="margin-top:10px;padding:10px">' + highlightsOf(s).map(h => '<div class="hint">' + h.icon + ' ' + esc(h.text) + '</div>').join('') + '</div>';
}

/* ───────────── 顶部 / HUD / 标签 ───────────── */
const TABS = [
  {id:'explore', n:'探索', icon:'🧭'},
  {id:'body',    n:'人体', icon:'🩺'},        // M31：人体状态分页（v4 渲染，见 medical.ts）
  {id:'base',    n:'据点', icon:'🏠'},
  {id:'inv',     n:'背包', icon:'🎒'},
  {id:'craft',   n:'制作', icon:'🛠️'},
  {id:'skills',  n:'技能', icon:'📈'},
  {id:'quest',   n:'任务', icon:'📋'},
  {id:'codex',   n:'图鉴', icon:'📖'},
  {id:'stats',   n:'统计', icon:'📊'},
];
function renderTop(){
  const p = phaseName();
  /* 无尽模式里天数会越过 GOAL_DAY（"101 / 100"看着像坏档），交给 endless-core 统一处理 */
  $('#clock-day').textContent = endDayLabel(S.day, !!S.flags.endless, GOAL_DAY);
  const ph = $('#clock-phase');
  ph.textContent = p[0]; ph.className = 'phase' + (p[1] === 'night' ? ' night' : '');
  // C12 昼夜色温：只切 class，颜色由 CSS 变量过渡；RM 下直接切色不过渡
  const used = S.apMax - S.ap;
  const tint = document.getElementById('daytint');
  if(tint){
    let c = 't-day';
    if(p[1] === 'night') c = 't-night';
    else if(p[1] === 'dusk') c = 't-dusk';
    else if(used <= 1) c = 't-dawn';
    if(RM) c += ' no-t';
    if(tint.className !== c) tint.className = c;
  }
  if(AMB.node) ambMode(p[1] === 'night' ? 'night' : 'day');   // C19：底噪跟着昼夜换频
  let pips = '';
  for(let i = 0; i < S.apMax; i++) pips += '<div class="ap' + (i < S.ap ? ' on' : '') + '"></div>';
  $('#ap-pips').innerHTML = pips + '<span class="ap-label">行动力 ' + S.ap + '/' + S.apMax + '</span>';
  const btn = $('#btn-sfx');
  btn.textContent = S.sfx ? '🔊' : '🔇';
  btn.className = 'icobtn' + (S.sfx ? '' : ' off');
}
function bar(cls, v, max, label, txt){
  const pct = clamp(v / max * 100, 0, 100);
  return '<div class="hbar"><div class="top"><span>' + label + '</span><b>' + txt + '</b></div>' +
    '<div class="bar"><i class="' + cls + '" style="width:' + pct + '%"></i></div></div>';
}
function renderHud(){
  const mods = statMods();
  const w = carryWeight(), cw = capWeight();
  const wpn = S.eq.wpn ? ITEMS[S.eq.wpn].n : '赤手空拳';
  let h = '<div class="hud-bars">';
  h += bar('hp', S.hp, S.hpMax, '❤️ 生命', Math.max(0, Math.round(S.hp)) + '/' + S.hpMax);
  h += bar('sta', S.sta, S.staMax, '⚡ 体力', Math.round(S.sta) + '/' + S.staMax);
  h += bar('hun', S.hun, 100, '🍖 饱食', Math.round(S.hun));
  h += bar('thi', S.thi, 100, '💧 水分', Math.round(S.thi));
  h += bar('inf', S.infect, 100, '🦠 感染' + (S.infect >= 60 ? ' · 爆发期' : (S.infect >= 35 ? ' · 警戒' : '')), Math.round(S.infect) + '%');
  h += '</div><div class="hud-chips">';
  /* M25：口径分开后 HUD 报总弹数 + 当前武器的口径与弹种；有 2 种以上可换弹时整条可点（循环换装） */
  const wCal = (S.eq.wpn && ITEMS[S.eq.wpn] && ITEMS[S.eq.wpn].cal) ? ITEMS[S.eq.wpn].cal : null;
  const wAmmo = wCal ? loadedAmmo(wCal) : null;
  const swappable = wCal ? (AMMO_OF[wCal] || []).filter(a => (S.inv[a.id] || 0) > 0).length >= 2 : false;
  h += '<span class="chip cold"' + (swappable ? ' style="cursor:pointer" title="点一下换弹种" onclick="cycleLoaded()"' : '') + '>🔫 弹药 <b>' + ammoCount() + '</b>' +
    (wAmmo ? ' <span class="mono" style="opacity:.75">' + CALIBERS[wCal].short + '·' + ITEMS[wAmmo].n.split(' ').pop() +
      ' 穿透' + (ITEMS[wAmmo].pen || 0) + ' ×' + (S.inv[wAmmo] || 0) + '</span>' + (swappable ? ' ⟳' : '') : '') + '</span>';
  /* M25：辐射 chip —— 只有真的吃进去才显示，标签直接给分档 */
  if(S.rad > 0){
    const rt = radTier(S.rad);
    h += '<span class="chip ' + (rt.tier >= 2 ? 'heavy warnpulse' : '') + '" title="' + rt.note + '">☢️ 辐射 <b>' + Math.round(S.rad) + '</b> · ' + rt.label + '</span>';
  }
  h += '<span class="chip gold">🔩 材料 <b>' + S.mat + '</b></span>';
  h += '<span class="chip ' + (w > cw ? 'heavy warnpulse' : '') + '">🎒 负重 <b>' + w + '/' + cw + '</b></span>';
  h += '<span class="chip">🛡️ 护甲 <b>' + armorTotal() + '</b></span>';
  h += '<span class="chip">🗡️ <b>' + wpn + '</b></span>';
  h += '<span class="chip">🏠 据点 <b>Lv.' + baseLevel() + '</b></span>';
  if(S.comp) h += '<span class="chip med">🤝 <b>' + COMPANIONS[S.comp].n + '</b> <b>' + Math.max(0,Math.round(S.compHp)) + '/' + S.compMax + '</b></span>';
  // v3.0：位置 / 日历 / 尸群 / 伤口 —— 出门前先看这一行
  h += '<span class="chip">📍 <b>' + (MAP[S.loc] ? MAP[S.loc].n : '安全屋') + '</b></span>';
  h += '<span class="chip ' + (threatLevel() >= 3 ? 'heavy warnpulse' : '') + '">📅 <b>' + nextEventText() + '</b></span>';
  if(S.def.doorHp < defMax().door || S.def.wallHp < defMax().wall) h += '<span class="chip heavy">🚪 防线 <b>门 ' + Math.round(S.def.doorHp) + ' / 墙 ' + Math.round(S.def.wallHp) + '</b></span>';
  (S.wounds || []).forEach(w => { h += '<span class="chip heavy warnpulse">' + WOUND_DEF[w.t].icon + ' <b>' + WOUND_DEF[w.t].n + '</b></span>'; });
  /* M31：人体伤病的 HUD 提示（点一下直接进人体页处理） */
  { const mdH = (typeof window.V4Medical === 'object' && window.V4Medical) ? window.V4Medical : null;
    if(mdH){ const line = mdH.hudLine(); if(line) h += '<span class="chip heavy warnpulse" style="cursor:pointer" onclick="setTab(\'body\')" title="点一下打开人体页">🩺 ' + esc(line) + '</span>'; } }
  if(mods.note.length) h += '<span class="chip heavy warnpulse">⚠️ ' + mods.note.join(' · ') + '</span>';
  h += '</div>';
  // C06 常驻「下一步」：任意时刻屏幕上只有一条可点击的下一步
  const ns = nextStep();
  h += '<div class="row" id="next-step" style="margin-top:6px">' +
    '<span class="hint">👉 <b style="color:var(--bone)">下一步：</b>' + esc(ns.txt) + '</span>' +
    (ns.act ? '<button class="btn xs ghost" onclick="' + ns.act + '">' + esc(ns.btn || '去做') + '</button>' : '') +
  '</div>';
  $('#hud').innerHTML = h;
}
/* C06 下一步建议：按「要死了 → 饿了渴了 → 没行动力 → 主线目标」的优先级给一条 */
function nextStep(){
  /* M51：over=true 现在只剩"真死了"一种情形（通关改成无尽延续，不再置 over），所以这里直说死亡 */
  if(S.over) return { txt:'你倒下了。可以重新开始，或读取上一次存档。', act:'loadGame()', btn:'读取存档' };
  if(S.hp <= S.hpMax * .3) return { txt:'生命很低：吃东西／用药，或者回据点睡觉。', act:"setTab('inv')", btn:'打开背包' };
  if(S.hun < 30) return { txt:'饿了（饱食 ' + Math.round(S.hun) + '）：背包里的罐头 +30、饼干 +16。', act:"setTab('inv')", btn:'打开背包' };
  if(S.thi < 30) return { txt:'渴了（水分 ' + Math.round(S.thi) + '）：净水 +35，污水会涨感染。', act:"setTab('inv')", btn:'打开背包' };
  if(S.ap <= 0) return { txt:'行动力用完了：睡觉进入第 ' + (S.day + 1) + ' 天（会消耗食物与水）。', act:'sleepNight()', btn:'睡觉' };
  if(S.quest.stage >= 6) return { txt:'主线已完成。继续搜刮、把图鉴与成就收满，或者重开一局挑战更快通关。', act:"setTab('stats')", btn:'看统计' };
  if(S.quest.stage === 5) return { txt:'主线到最后一步了：带足弹药与药，下到方舟实验室第 6 层。', act:"setTab('quest')", btn:'看任务' };
  if(S.quest.stage === 0 && !S.seen.hospital) return { txt:'先去圣玛丽医院——那里有药，也有你的第一条线索。', act:"setTab('explore')", btn:'去探索' };
  const st = QUEST_STAGES[Math.min(S.quest.stage, 6)];
  return { txt:'推进「' + st.n + '」：' + st.hint, act:"setTab('explore')", btn:'去探索' };
}
function renderTabs(){
  $('#tabs').innerHTML = TABS.map(t => '<button class="tab' + (S.tab === t.id ? ' on' : '') + '" onclick="setTab(\'' + t.id + '\')">' +
    t.icon + ' ' + t.n + '</button>').join('');
}
function setTab(id){ S.tab = id; sfx('ui'); render(); }
function render(){
  try{
    renderTop(); renderHud(); renderTabs();
    const v = $('#view');
    /* M43：同页签的自动刷新（每次搜刮/休整/制作都会走这里）不该把滚动条拽回顶上 ——
       玩家滚到「采集 / 水体 / 菜园 / 今夜」点一下，屏幕一跳回顶部，等于每一步都要重新滚
       （用户报障：「为啥每次行动后滚动会自动回到顶上，这不方便」）。
       规则：**换页签**才回顶部；同一页签刷新则还原原来的偏移（内容变短由浏览器自己夹住）。 */
    const tabChanged = v.dataset.tab !== S.tab;
    const snap = snapshotScroll();
    /* M31：人体状态页是 v4 那边渲染的（分页 + SVG 方块人形）。挂载失败不能让整屏挂掉，
       所以单独 try/catch，失败就退回探索页。 */
    let v4tab = null;
    try{ v4tab = (window.V4Medical && window.V4Medical.renderTab) ? window.V4Medical.renderTab(S.tab) : null; }catch(e){ console.warn('[v4] 人体页渲染失败', e); v4tab = null; }
    const f = { explore:renderExplore, base:renderBase, inv:renderInv, craft:renderCraft, skills:renderSkills, quest:renderQuest, codex:renderCodex, stats:renderStats }[S.tab] || renderExplore;
    v.innerHTML = (v4tab !== null && v4tab !== undefined) ? v4tab : f();
    v.dataset.tab = S.tab;
    restoreScroll(keepOffsets(snap, { resetView: tabChanged }), { skip: tabChanged ? ['#v4cards', '.v4world .wmapwrap'] : [] });
    /* M49：这一步会把 #log 还原成快照里的旧偏移（内容比快照时更长 → 相对当前位置是"往上跳"），
       而日志跟随把"往上"当成玩家在翻历史 —— 实战表现就是"打着打着现场日志就不跟了"。
       所以这一下明确标成"我们自己滚的"，不参与意图判定。 */
    if(typeof performance === 'object' && performance.now) logPinUntil = performance.now() + 200;   // 这一下是我们自己滚的
    window.__renderErr = null;
  }catch(e){
    // C01 护栏：渲染崩了也不能白屏，更不能让 autosave 把坏状态写进唯一键位
    window.__renderErr = e;
    try{ console.error('[render]', e); }catch(_){}
    try{
      S.logBuf.push(['danger', '⚠️ 渲染异常：' + (e && e.message ? e.message : e)]);
      $('#view').innerHTML = '<div class="card"><h3>⚠️ 界面渲染出错</h3>' +
        '<p class="muted">这一屏没画出来，但你的存档没有被写坏。可以把下面这行发给作者：</p>' +
        '<div class="hint mono" style="margin-top:8px">' + esc(String(e && e.stack ? e.stack.split('\n')[0] : e)) + '</div>' +
        '<div class="row" style="margin-top:10px"><button class="btn" onclick="window.__renderErr=null;render()">重新渲染</button>' +
        '<button class="btn danger" onclick="restart()">新游戏</button>' +
        '<button class="btn" onclick="loadGame()">读取存档</button></div></div>';
    }catch(_){}
  }
}
function baseLevel(){ let s = 0, k; for(k in S.base) s += S.base[k]; return s; }

/* ───────────── 弹窗 ───────────── */
let modalStack = [];
function modal(o){
  const root = $('#overlay-root');
  const ov = document.createElement('div');
  ov.className = 'overlay';
  const id = 'ov' + (++modalSeq);
  ov.id = id;
  ov.innerHTML = '<div class="modal">' +
    (o.title ? '<div class="strip"></div><div class="modal-hd"><h2>' + o.title + '</h2>' +
      '<button class="icobtn" data-close>✕</button></div>' : '') +
    '<div class="modal-bd">' + (o.body || '') + '</div>' +
    (o.footer ? '<div class="modal-ft">' + o.footer + '</div>' : '') + '</div>';
  root.appendChild(ov);
  modalStack.push(id);
  ov.querySelectorAll('[data-close]').forEach(b => b.onclick = () => closeModal(id));
  if(!o.sticky) ov.addEventListener('mousedown', e => { if(e.target === ov) closeModal(id); });
  if(o.onMount) o.onMount(id);
  return id;
}
let modalSeq = 0;
function closeModal(id){
  if(id){ const el = document.getElementById(id); if(el) el.remove(); modalStack = modalStack.filter(x => x !== id); return; }
  const last = modalStack.pop(); if(last){ const el = document.getElementById(last); if(el) el.remove(); }
}
function closeAllModals(){ modalStack.slice().forEach(closeModal); }

/* ═══════════ legacy/20-combat.js ═══════════ */
/* ───────────── 战斗 ───────────── */
function mkFoe(src){
  if(typeof src === 'object'){
    return { id:src.id||'boss', n:src.n, hp:src.hp, hpMax:src.hp, dmg:src.dmg, spd:src.spd||1, xp:src.xp||0,
      t:src.t||{desc:src.desc||'', loot:{}}, st:{burn:0}, dead:false, boss:!!src.boss };
  }
  const t = ZOMBIES[src], step = Math.floor((S.day - 1) / 5);
  const hp = Math.round(t.hp * (1 + step * .22));
  // t 必须是副本：精英词条要改写 armGun/bite，直接引用模板会永久污染 ZOMBIES
  const foe = { id:src, n:t.n, hp:hp, hpMax:hp, dmg:Math.round(t.dmg * (1 + step * .14)), spd:t.spd, xp:t.xp,
    t:Object.assign({}, t), st:{burn:0}, dead:false, boss:false };
  const aff = affixRoll();
  if(aff) applyAffix(foe, aff);
  return foe;
}
function startCombat(foes, opts){
  opts = opts || {};
  // v4 桥接：主入口被 v4 接管后，legacy 内部发起的战斗（区域遭遇 / 夜间守夜战 / 最终决战两阶段）
  // 也必须走同一套回合制引擎——否则会两套战斗界面并存（旧界面只有 legacy 自己调得到）。
  if(typeof window.__v4StartCombat === 'function') return window.__v4StartCombat(foes, opts);
  battle = { foes:foes.map(mkFoe), target:0, round:1, clean:true, pSt:{bleed:0,poison:0}, msgs:[], opts:opts };
  sfx('bad');
  if(opts.title === undefined) log('⚔️ 战斗开始：' + battle.foes.map(f => f.n).join('、'), 'combat');
  openCombatModal();
}
let combatModalId = null;
function openCombatModal(){
  if(combatModalId) closeModal(combatModalId);
  combatModalId = modal({
    title:'⚔️ ' + (battle.opts.title || '遭遇战') + (battle.opts.sub ? ' <span class="muted">· ' + battle.opts.sub + '</span>' : ''),
    body:'<div id="cb-body"></div>',
    sticky:true,
    onMount(){ drawCombat(); }
  });
}
function cbLog(t, cls){ battle.msgs.push([t, cls || 'sys']); if(battle.msgs.length > 60) battle.msgs.shift(); }
function drawCombat(){
  const b = battle; if(!b) return;
  const box = $('#cb-body'); if(!box) return;
  const mods = statMods();
  const w = ITEMS[S.eq.wpn] || ITEMS.crowbar;
  let foes = '';
  b.foes.forEach((f, i) => {
    const pct = clamp(f.hp / f.hpMax * 100, 0, 100);
    const traits = [];
    if(f.elite && f.affix) traits.push('精英·' + AFFIX[f.affix].n);
    if(f.spd >= 2) traits.push('迅捷 ×' + (f.spd >= 2.5 ? 2 : 2));
    if(f.t && f.t.armGun) traits.push('抗弹');
    if(f.t && f.t.poison) traits.push('毒雾');
    if(f.t && f.t.summon) traits.push('呼救');
    if(f.t && f.t.bleed) traits.push('撕裂');
    if(f.t && f.t.dodge) traits.push('难命中');
    if(f.st.burn > 0) traits.push('🔥 燃烧 ' + f.st.burn);
    foes += '<div class="enemy' + (f.dead ? ' dead' : (i === b.target ? ' target' : '')) + (f.elite ? ' elite' : '') + '" id="foe-' + i + '" data-foe="' + i + '"' +
      (f.dead ? '' : ' onclick="battleTarget(' + i + ')"') + '>' +
      '<div class="en">' + esc(f.n) + '<span class="mono" style="font-size:11px;color:var(--dim)">' + (f.dead ? '已清除' : 'HP ' + Math.max(0, Math.round(f.hp))) + '</span></div>' +
      '<div class="es">每次伤害 ' + f.dmg + ' · 速度 ' + f.spd + (f.boss ? ' · <span style="color:var(--blood2)">BOSS</span>' : '') + '</div>' +
      '<div class="bar thin"><i class="foe" style="width:' + pct + '%"></i></div>' +
      (traits.length ? '<div class="traits">' + traits.map(t => '<span class="tr">' + t + '</span>').join('') + '</div>' : '') +
      '</div>';
  });
  const rounds = b.msgs.map(m => '<div class="' + m[1] + '">' + esc(m[0]) + '</div>').join('');
  const canGun = w.ammo && S.ammo >= w.ammo;
  const canMelee = !w.ammo && S.sta >= (w.sta || 0);
  const wid2 = (S.eq.wpn && ITEMS[S.eq.wpn]) ? S.eq.wpn : 'crowbar';
  const modNames = modsOf(wid2).map(m => MODS[m].n).join('+');
  const wpnLine = w.ammo
    ? '🔫 ' + w.n + (modNames ? '（' + modNames + '）' : '') + ' · 伤害 ' + Math.round(effDmg(w, true).d) + ' · 弹药 ' + Math.max(1, w.ammo + modSum(wid2, 'ammo')) + '/次'
    : '🗡️ ' + w.n + (modNames ? '（' + modNames + '）' : '') + ' · 伤害 ' + Math.round(effDmg(w, false).d) + ' · 体力 ' + Math.round((w.sta || 0) * modMul(wid2, 'stamult')) + '/次';
  box.innerHTML =
    '<div class="combat-grid">' +
      '<div class="grid" style="gap:8px">' + foes + '</div>' +
      '<div>' +
        '<div class="card" style="padding:10px">' +
          '<h3 style="margin-bottom:6px">🧑 你的状态</h3>' +
          '<div class="kv"><span>❤️ 生命</span><b>' + Math.max(0, Math.round(S.hp)) + '/' + S.hpMax + '</b></div>' +
          '<div class="kv"><span>⚡ 体力</span><b>' + Math.round(S.sta) + '</b></div>' +
          '<div class="kv"><span>🔫 弹药</span><b>' + S.ammo + '</b></div>' +
          '<div class="kv"><span>🛡️ 护甲</span><b>' + armorTotal() + '</b></div>' +
          '<div class="kv"><span>🦠 感染</span><b>' + Math.round(S.infect) + '%</b></div>' +
          '<div class="kv"><span>🩸 流血 / ☠️ 中毒</span><b>' + b.pSt.bleed + ' / ' + b.pSt.poison + '</b></div>' +
          (mods.note.length ? '<div class="hint" style="margin-top:6px;color:#e08a72">状态惩罚：' + mods.note.join('、') + '</div>' : '') +
        '</div>' +
        '<div class="card" style="padding:10px;margin-top:8px">' +
          '<h3 style="margin-bottom:6px">当前武器</h3>' +
          '<div class="hint">' + wpnLine + '</div>' +
          (S.comp ? '<div class="hint" style="margin-top:6px;color:#7fd6a8">🤝 ' + COMPANIONS[S.comp].n + ' · ' + Math.max(0, Math.round(S.compHp)) + '/' + S.compMax + '</div>' : '') +
        '</div>' +
        (b.opts.siege ? siegePanelHtml() : '') +
      '</div>' +
    '</div>' +
    '<div class="row" style="margin-top:12px">' +
      (w.ammo ? '<button class="btn primary" onclick="combatAct(\'shoot\')" ' + (canGun && !b.busy ? '' : 'disabled') + '>🔫 射击 <kbd>1</kbd></button>' : '') +
      (!w.ammo ? '<button class="btn primary" onclick="combatAct(\'melee\')" ' + (canMelee && !b.busy ? '' : 'disabled') + '>🗡️ 挥击 <kbd>1</kbd></button>' : '') +
      '<button class="btn ok" onclick="combatAct(\'guard\')" ' + (b.busy ? 'disabled' : '') + '>🛡️ 防御 <kbd>2</kbd></button>' +
      '<button class="btn warn" onclick="combatAct(\'item\')" ' + (b.busy ? 'disabled' : '') + '>💊 用药 <kbd>3</kbd></button>' +
      '<button class="btn" onclick="combatAct(\'throw\')" ' + (b.busy ? 'disabled' : '') + '>💣 投掷 <kbd>4</kbd></button>' +
      /* M56：避战道具（身上有气味引诱器才出现）—— 引走敌人，够了就直接脱离接触 */
      (DECOYS.some(d => itemCount(d.id) > 0) ? '<button class="btn" onclick="combatAct(\'decoy\')" ' + (b.busy ? 'disabled' : '') + ' title="' + DECOYS.filter(d => itemCount(d.id) > 0).map(d => d.icon + d.name + '×' + itemCount(d.id)).join('、') + '">🧪 引诱器 <kbd>6</kbd></button>' : '') +
      (b.opts.noFlee ? '' : '<button class="btn danger" onclick="combatAct(\'flee\')" ' + (b.busy ? 'disabled' : '') + '>🏃 逃跑 <kbd>5</kbd></button>') +
    '</div>' +
    '<div class="round-log" id="cb-log" style="margin-top:10px;height:150px">' + rounds + '</div>' +
    (b.opts.hint ? '<div class="hint" style="margin-top:8px">' + b.opts.hint + '</div>' : '');
  // C04 死前三次可操作提示：首战第 1 回合给操作说明，之后按血量阈值各给一次
  if(b.round === 1) firstTip('cbt1', '点敌人卡片切换目标；打不动就按 2 防御（回 14 体力 + 减伤 55%）。');
  if(S.hp < S.hpMax * .6) firstTip('cbt2', '生命过半了：按 3 用药（绷带 +15 / 急救包 +50），别硬撑。');
  if(S.hp < S.hpMax * .35) firstTip('cbt3', '生命见底：按 5 逃跑，潜行与军靴能提高成功率——活着比赢重要。');
  const lg = $('#cb-log'); if(lg) lg.scrollTop = lg.scrollHeight;
}
function battleTarget(i){ if(battle && battle.foes[i] && !battle.foes[i].dead){ battle.target = i; sfx('ui'); drawCombat(); } }
/* 守夜战的防线面板：门/墙血条 + 抢修 + 剩余陷阱 */
function siegePanelHtml(){
  const m = defMax();
  const bar = (label, v, max) => '<div class="hbar" style="margin-top:5px"><div class="top"><span>' + label + '</span><b>' + Math.round(v) + '/' + max + '</b></div>' +
    '<div class="bar"><i class="sta" style="width:' + clamp(v / Math.max(1, max) * 100, 0, 100) + '%"></i></div></div>';
  const canFix = has('metal', 2) && has('wood', 2) && S.ap >= 1 && (S.def.doorHp < m.door || S.def.wallHp < m.wall);
  return '<div class="card" style="padding:10px;margin-top:8px">' +
    '<h3 style="margin-bottom:4px">🏠 防线' + (battle.opts.bloodMoon ? ' <span class="sub" style="color:var(--blood2)">血月</span>' : '') + '</h3>' +
    bar('🚪 门窗', S.def.doorHp, m.door) + bar('🧱 围墙', S.def.wallHp, m.wall) +
    '<div class="hint" style="margin-top:6px">' + (S.def.doorHp + S.def.wallHp > 0 ? '它们正在砸防线——修得比砸得快，你就不用拿身体挡。' : '⚠️ 防线已被拆穿，伤害 +25%。') + '</div>' +
    '<button class="btn sm block ' + (canFix ? 'ok' : '') + '" style="margin-top:6px" ' + (canFix ? '' : 'disabled') + ' onclick="combatRepair()">🔨 抢修 (1 AP + 铁片2/木料2)</button>' +
    '<div class="hint" style="margin-top:6px">陷阱余量：🔺' + S.def.traps.spike + ' 🔥' + S.def.traps.fire + ' 📡' + S.def.traps.alarm + '</div>' +
  '</div>';
}
function effDmg(w, isGun){
  const wid = (S.eq.wpn && ITEMS[S.eq.wpn]) ? S.eq.wpn : 'crowbar';
  let d = w.dmg;
  d *= isGun ? (1 + skillBonus('shoot', .06, .7)) : (1 + skillBonus('melee', .07, .7));
  /* M25：装上什么弹就打什么伤害（竞赛/独头更疼，穿甲弹打无甲略亏） */
  const ammo = (isGun && w.cal) ? ITEMS[loadedAmmo(w.cal)] : null;
  if(ammo) d *= (ammo.dmgMul || 1);
  d += Math.floor(S.day / 5) * 2;
  d *= statMods().dmgMul;
  d *= modMul(wid, 'wmult');                                   // C22 消音器的伤害代价
  let crit = (w.crit || 0) + modSum(wid, 'crit') + (isGun ? S.skills.shoot : S.skills.melee) * .005;   // C22 瞄准镜
  return { d:d, crit:crit };
}
/** M25：这一枪对某个目标的实际伤害 —— 穿透等级 vs 装甲等级（参考塔科夫） */
function damageVs(foe, base, isGun, w){
  const t = (foe && foe.t) || {};
  const armor = t.armor || 0;
  if(!isGun || !armor || !w || !w.cal) return base;
  const aid = loadedAmmo(w.cal);
  const pen = (aid && ITEMS[aid]) ? (ITEMS[aid].pen || 0) : 0;
  const m = penMul(pen, armor);
  if(m < 1) foe.__pen = { pen:pen, armor:armor, m:m };        // 战斗日志用：这发被挡掉多少
  return base * m;
}
/* C15 战斗节拍器：combatAct 只做"调度"，结算拆成 combatResolve（玩家动作）+ combatAfter（胜负判定与敌方回合）。
   beat 模式下两段之间插 180/300ms 间隔并锁按钮；fast（默认）模式下与旧版完全同步，随机数调用顺序不变。 */
function combatAct(kind, arg){
  const b = battle; if(!b) return;
  if(b.busy) return;
  if(S.ui.pace === 'beat' && !RM){
    b.busy = true;
    sfx(kind === 'shoot' || kind === 'throw' ? 'shoot' : (kind === 'melee' ? 'melee' : 'ui'));
    drawCombat();
    setTimeout(() => {
      if(battle !== b) return;
      combatResolve(kind, arg, true);
      if(battle === b) drawCombat();
    }, 180);
    setTimeout(() => {
      if(battle !== b) return;
      b.busy = false;
      combatAfter();
      if(battle === b) drawCombat();
    }, 480);
    return;
  }
  combatResolve(kind, arg, false);
  combatAfter();
}
function combatAfter(){
  if(!battle) return;
  if(battle.foes.every(f => f.dead)){ endCombat('win'); return; }
  afterPlayerTurn();
}
function combatResolve(kind, arg, staged){
  const b = battle; if(!b) return;
  const alive = b.foes.filter(f => !f.dead);
  if(!alive.length) return;
  let ti = b.foes[b.target] && !b.foes[b.target].dead ? b.target : b.foes.findIndex(f => !f.dead);
  const foe = b.foes[ti];
  const wid = (S.eq.wpn && ITEMS[S.eq.wpn]) ? S.eq.wpn : 'crowbar';
  const w = ITEMS[wid];

  if(kind === 'shoot' || kind === 'melee'){
    const isGun = kind === 'shoot';
    const ammoCost = isGun ? Math.max(1, (w.ammo || 1) + modSum(wid, 'ammo')) : 0;   // C22 扩容弹匣
    const aid = isGun && w.cal ? loadedAmmo(w.cal) : null;                           // M25：这一口径装的是哪种弹
    if(isGun && (!aid || itemCount(aid) < ammoCost)){
      cbLog('弹药不足！' + (w.cal ? '（' + CALIBERS[w.cal].short + ' 只剩 ' + (aid ? itemCount(aid) : 0) + ' 发）' : ''), 'hurt'); drawCombat(); return;
    }
    if(!isGun && S.sta < (w.sta || 0)){ cbLog('体力不够挥不动了，先防御回气。', 'hurt'); drawCombat(); return; }
    if(isGun){
      takeItem(aid, ammoCost); syncAmmo(); S.stats.ammoUsed += ammoCost;   // M25：按口径消耗实弹（M32b：镜像改由 syncAmmo 收口）
      S.noise += Math.max(0, (w.noise >= 3 ? 2 : 1) + modSum(wid, 'noise'));         // C22 消音器
      noiseCheck();                                                               // v3.0：噪音会招来迁徙尸群
      if(!staged) sfx('shoot');
      if(battle.opts.final) S.flags.usedGunFinal = true;
    }
    else { S.sta -= (w.sta || 0) * (1 - skillBonus('melee', .03, .3)) * modMul(wid, 'stamult'); if(!staged) sfx('melee'); }   // C22 战术握把
    const e = effDmg(w, isGun);
    const crit = chance(e.crit);
    let dmg = crit ? e.d * 1.8 : e.d;
    dmg = damageVs(foe, dmg, isGun, w);                      // M25：穿透 vs 装甲
    hitFoe(foe, dmg, { gun:isGun, apen:!!w.apen, crit:crit, source:w.n });
    if(foe.__pen && foe.__pen.m < 1){
      cbLog('🛡️ 子弹被装甲吃掉了大半（穿透 ' + foe.__pen.pen + ' vs 装甲 ' + foe.__pen.armor +
        '，只剩 ' + Math.round(foe.__pen.m * 100) + '% 伤害）——换穿甲弹试试。', 'hurt');
      foe.__pen = null;
    }
    addXP(isGun ? 'shoot' : 'melee', isGun ? 4 : 3);
    if(w.apen) cbLog('🪓 ' + w.n + ' 劈开了它的防护。', 'good');
  } else if(kind === 'guard'){
    b.guard = true; S.sta = clamp(S.sta + 14, 0, S.staMax);
    cbLog('🛡️ 你收势防御，喘了口气（+14 体力，本回合减伤 55%）。', 'good'); sfx('ui');
  } else if(kind === 'item'){
    const list = ['bandage','medkit','painkiller','antitoxin','anti','serum'].filter(id => itemCount(id) > 0);
    if(!list.length){ cbLog('身上没有能用的药。', 'hurt'); drawCombat(); return; }
    const id = list[0];
    useConsumable(id, true);
    cbLog('💊 你在战斗中使用了 ' + ITEMS[id].n + '。', 'good');
  } else if(kind === 'throw'){
    const bombs = ['molotov','grenade','smoke'].filter(id => itemCount(id) > 0);
    if(!bombs.length){ cbLog('没有可投掷的物品（燃烧瓶 / 手雷 / 烟雾弹）。', 'hurt'); drawCombat(); return; }
    const id = bombs[0];
    takeItem(id, 1);
    if(id === 'smoke'){
      cbLog('💨 烟雾弹炸开，视野全白——你脱离了接触。', 'good');
      endCombat('flee'); return;
    }
    const dmg = (ITEMS[id].dmg || 40) * (1 + S.skills.shoot * .02);
    sfx('shoot'); shake();
    b.foes.forEach(f => { if(!f.dead) hitFoe(f, dmg, { gun:true, apen:true, crit:false, source:ITEMS[id].n, aoe:true }); });
    if(id === 'molotov') b.foes.forEach(f => { if(!f.dead) f.st.burn = 3; });
    cbLog('💥 ' + ITEMS[id].n + ' 在尸群里炸开！', 'good');
    S.noise += 2; noiseCheck();
  } else if(kind === 'decoy'){
    /* M56：避战道具 —— 按场上威胁自动挑"够档的最低档"；全引走 = 脱离接触；引不走的不消耗 */
    const plan = planDecoy(S.inv, b.foes, { noFlee: !!b.opts.noFlee });
    if(!plan.item){ cbLog(plan.text, 'hurt'); drawCombat(); return; }
    takeItem(plan.item, 1);
    plan.driven.forEach(i => { const f = b.foes[i]; f.dead = true; f.hp = 0; f.driven = true; });   // 引走 ≠ 击杀：不掉战利品、不给经验
    cbLog(plan.text, 'good');
    if(plan.clears){ endCombat('flee'); return; }
    afterPlayerTurn();                              // 引走一部分也要过一个回合
  } else if(kind === 'flee'){
    const enc = encumbrance();
    const fast = alive.some(f => f.spd >= 2);
    /* M56：成功率算式在 v4/flee-core；**反复失败会越来越难跑**，失败还要挨白打（用户报的漏洞：
       旧版失败只写一行日志，"一直点逃跑" = 无限免战）。 */
    const chanceOf = (tries) => fleeChanceOf({ base: .42, stealthLv: S.skills.stealth, hasBoots: !!S.eq.feet, fast, encOver: enc > 1, noFlee: !!b.opts.noFlee, tries });
    if(chance(chanceOf(b.fleeTries || 0))){ cbLog('🏃 你甩开了它们。', 'good'); endCombat('flee'); return; }
    const plan = fleeFailPlan(alive.length);
    b.fleeTries = (b.fleeTries || 0) + 1;
    S.sta = Math.max(0, S.sta - plan.staCost);
    cbLog(plan.text, 'hurt');
    afterPlayerTurn();                              // 把后背露给它们 = 每个活着的敌人白打一轮（含死亡判定与重绘）
    if(battle && !battle.over) cbLog('（下一次逃跑成功率：' + Math.round(chanceOf(b.fleeTries) * 100) + '%）', 'dim');
  }
}
function hitFoe(foe, dmg, o){
  o = o || {};
  let d = dmg;
  const t = foe.t || {};
  if(!o.apen){
    if(o.gun && t.armGun) d *= t.armGun;
    if(!o.gun && t.armMelee) d *= t.armMelee;
  }
  if(t.dodge && chance(t.dodge * (o.gun ? 1 : .6))){
    cbLog('↘️ ' + foe.n + ' 贴地一闪，攻击落空。', 'sys');
    return;
  }
  d = Math.max(1, Math.round(d));
  foe.hp -= d;
  S.stats.dmgDealt += d;
  cbLog((o.crit ? '💥 暴击！' : '› ') + (o.aoe ? '' : '') + foe.n + ' 受到 ' + d + ' 点伤害' + (o.source ? '（' + o.source + '）' : '') + '。', 'hit');
  const idx = battle ? battle.foes.indexOf(foe) : -1;
  const card = idx >= 0 ? document.getElementById('foe-' + idx) : null;
  floatText((o.crit ? '暴击 ' : '') + d, o.crit ? 'crit' : '', card);
  if(card && !RM){ card.classList.remove('hit'); void card.offsetWidth; card.classList.add('hit'); }  // C13 抖动：纯 CSS 100ms，无 rAF
  sfx('hit');
  if(foe.hp <= 0) killFoe(foe);
}
function killFoe(foe){
  foe.dead = true; foe.hp = 0;
  const t = foe.t || {};
  S.stats.kills++;
  S.stats.killBy[foe.id] = (S.stats.killBy[foe.id] || 0) + 1;   // C17 悬赏/支线的击杀分类计数
  if(foe.elite) S.stats.elites++;                              // C16 精英击杀
  const w = ITEMS[S.eq.wpn];
  if(!w || !w.ammo) S.stats.meleeKills++;
  /* M48：教学沙盒第 2 章「用穿甲弹打死装甲目标」的真计数器（原来的"换弹"目标只证明玩家点过切换）。
     口径 = 击杀那一刻装填的是穿甲弹种（pen ≥ 4）且这只确实是装甲目标（armor ≥ 4）；近战、普通弹都不算。 */
  if(w && w.ammo && w.cal){
    const ad = ITEMS[loadedAmmo(w.cal)];
    if(ad && apKillOnArmored(ad.pen, (t.armor || 0))) S.stats.apKills = (S.stats.apKills || 0) + 1;
  }
  cbLog('☠️ ' + foe.n + ' 倒下了。', 'good');
  log('✅ 击杀 ' + foe.n + '。', 'success');
  if(t.burst){                                                 // C16 爆裂词条：死亡时炸开
    const bd = ri(8, 14); S.hp -= bd;
    cbLog('💥 它炸开了！冲击波把你掀翻，-' + bd + ' 生命。', 'hurt');
    if(typeof floatText === 'function') floatText('-' + bd, 'self', document.querySelector('#hud .bar i.hp'));
  }
  // 经验
  if(w && w.ammo) addXP('shoot', foe.xp || 4); else addXP('melee', foe.xp || 4);
  /* M24：近战 Lv5 perk —— 击杀回体力（近战本来就吃体力，这是"越打越顺"的手感） */
  if(!w || !w.ammo){
    if(hasPerk('melee', 5)){ S.sta = Math.min(S.staMax, S.sta + 5); }
  }
  // 掉落
  let got = [];
  if(t.loot) for(const id in t.loot){ if(chance(t.loot[id] * (1 + skillBonus('survival', .08, .5)))){ grant(id, 1, true); got.push(itemName(id)); } }
  if(t.keycard && chance(t.keycard) && S.quest.keycards < 3){ S.quest.keycards++; got.push('门禁卡碎片(' + S.quest.keycards + '/3)'); checkQuest(); }
  const mats = ri(2, 4) + Math.floor(S.day / 6);
  S.mat += mats;
  got.push('材料 ×' + mats);
  if(foe.elite){                                              // C16 精英额外掉落
    S.mat += 10;
    const bonus = wpick({ serum:2, kevlar:2, grenade:3, ammo:5 });
    grant(bonus, bonus === 'ammo' ? 20 : 1, true);
    got.push('精英掉落：' + (bonus === 'ammo' ? '弹药 ×20' : itemName(bonus)) + ' + 10 材料');
  }
  log('📦 战利品：' + got.join('、'), 'loot');
  if(S.comp === 'hunter' && chance(.3)){ S.mat += 3; }
  // 尖叫者死亡可能引来更多
  if(t.summon && chance(.45) && battle.foes.filter(f => !f.dead).length < 4){
    const nf = mkFoe(pick(['walker','runner','crawler']));
    battle.foes.push(nf);
    cbLog('📣 尖叫声在废墟里回荡……' + nf.n + ' 冲了过来！', 'hurt');
  }
  bountyTick();          // C17：击杀可能直接完成委托
  sideTick();            // C21：支线的击杀类步骤
}
function afterPlayerTurn(){
  const b = battle; if(!b) return;
  companionTurn();
  if(!battle) return;
  if(battle.foes.every(f => f.dead)){ endCombat('win'); return; }
  b.round++;
  // 状态结算（玩家）
  if(b.pSt.bleed > 0){
    const d = 3 + Math.floor(S.day / 4); S.hp -= d; b.pSt.bleed--; b.clean = false;
    cbLog('🩸 流血不止，损失 ' + d + ' 生命。', 'hurt');
  }
  if(b.pSt.poison > 0){
    const d = 4 + Math.floor(S.day / 5); S.hp -= d; b.pSt.poison--; b.clean = false;
    cbLog('☠️ 毒素扩散，损失 ' + d + ' 生命。', 'hurt');
  }
  if(S.infect >= 100){ S.hp = 0; cbLog('🦠 感染到了尽头——你已经分不清哪些念头是自己的。', 'hurt'); }
  if(S.hp <= 0){ endCombat('dead'); return; }
  // 敌人行动
  battle.foes.forEach(f => { if(!f.dead) foeTurn(f); });
  if(!battle) return;
  if(S.hp <= 0){ endCombat('dead'); return; }
  drawCombat(); renderHud();
}
function companionTurn(){
  if(!S.comp || S.compHp <= 0) return;
  const c = COMPANIONS[S.comp];
  const alive = battle.foes.filter(f => !f.dead);
  if(!alive.length) return;
  if(S.comp === 'nurse'){
    const h = 7 + Math.floor(S.day / 4);
    S.hp = Math.min(S.hpMax, S.hp + h);
    cbLog('💉 ' + c.n + ' 迅速替你处理了伤口（+' + h + ' 生命）。', 'good');
    return;
  }
  const foe = alive[0];
  const d = Math.round(c.dmg * (1 + Math.floor(S.day / 6) * .1));
  foe.hp -= d;
  cbLog('🤝 ' + c.n + ' 出手，' + foe.n + ' 受到 ' + d + ' 点伤害。', 'good');
  if(foe.hp <= 0) killFoe(foe);
}
function foeTurn(foe){
  const b = battle; if(!b) return;
  // 燃烧
  if(foe.st.burn > 0){
    const d = 14; foe.hp -= d; foe.st.burn--;
    cbLog('🔥 ' + foe.n + ' 在燃烧（-' + d + '）。', 'good');
    if(foe.hp <= 0){ killFoe(foe); return; }
  }
  const times = foe.spd >= 2 ? 2 : 1;
  for(let i = 0; i < times; i++){
    if(foe.dead) return;
    // v3.0 守夜战：敌人在砸防线（门先扛，门破了砸墙），防线没了才冲你
    if(b.opts && b.opts.siege && (S.def.doorHp > 0 || S.def.wallHp > 0) && chance(.45)){
      const dd = Math.max(4, Math.round(foe.dmg * .9));
      if(S.def.doorHp > 0){ S.def.doorHp = Math.max(0, S.def.doorHp - dd); cbLog('🚪 ' + foe.n + ' 在砸门（门 ' + S.def.doorHp + '）。', 'sys'); }
      else { S.def.wallHp = Math.max(0, S.def.wallHp - dd); cbLog('🧱 ' + foe.n + ' 撞在围墙上（墙 ' + S.def.wallHp + '）。', 'sys'); }
      if(S.def.doorHp === 0 && S.def.wallHp === 0) cbLog('💥 防线被拆穿了！它们从缺口涌进来——现在只能靠你。', 'hurt');
      continue;
    }
    // 同伴挡刀
    if(S.comp && S.compHp > 0 && chance(.22)){
      let cd = Math.max(1, Math.round(foe.dmg * .8));
      S.compHp -= cd;
      cbLog('🛡️ ' + COMPANIONS[S.comp].n + ' 替你挡下了这一下（-' + cd + '）。', 'sys');
      if(S.compHp <= 0){
        cbLog('💀 ' + COMPANIONS[S.comp].n + ' 倒在了血泊里。', 'hurt');
        log('💀 同伴 ' + COMPANIONS[S.comp].n + ' 牺牲了。', 'danger');
        S.comp = null; S.compHp = 0; S.compMax = 0;
      }
      continue;
    }
    const mods = statMods();
    let gearDodge = 0;
    ['feet','trinket'].forEach(sl => { const g = S.eq[sl]; if(g && ITEMS[g] && ITEMS[g].dodge) gearDodge += ITEMS[g].dodge; });   // C21：护符也提供闪避
    let dodge = clamp(.05 + gearDodge + S.skills.stealth * .015 + mods.dodge, 0, .55);
    if(chance(dodge)){ cbLog('💨 你侧身躲开了 ' + foe.n + ' 的攻击。', 'good'); continue; }
    let d = foe.dmg * rnd(.85, 1.15);
    d *= 1 - skillBonus('fitness', .012, .24);
    // C07 护甲改百分比主导：flat 减免会让后期小怪恒被压到 2 点，敌人伤害成长整条失效
    const arm = armorTotal();
    d = Math.max(d * (1 - Math.min(.45, arm * .05)), d - arm * 1.2, 1);
    if(S.eq.body === 'hazmat') d *= .6;      // C11 修订：减伤倍率按决议保持 0.6 不动
    if(b.opts && b.opts.siege && S.def.doorHp === 0 && S.def.wallHp === 0) d *= 1.25;   // 防线破了：它们毫无阻碍
    if(b.guard) d *= .45;
    d = Math.max(1, Math.round(d));
    // 头盔减爆头
    let crit = .08 * (S.eq.head === 'helmet' ? .5 : 1);
    if(chance(crit)) d = Math.round(d * 1.6);
    S.hp -= d; b.clean = false;
    S.stats.dmgTaken += d;
    cbLog('💢 ' + foe.n + ' 命中你，-' + d + ' 生命。', 'hurt');
    floatText('-' + d, 'self', document.querySelector('#hud .bar i.hp'));   // C13：玩家受伤数字从生命条蹦出
    shake(); sfx('hurt');
    // 咬伤 → 感染（C11 修订：咬伤率 .25→.5；防化服的替代收益是降低感染接触，而不是继续三刀齐下）
    const t = foe.t || {};
    if(t.bite && chance(t.bite * (S.eq.body === 'hazmat' ? .5 : 1))){
      let inc = Math.round(rnd(10, 17) * (1 - skillBonus('medic', .05, .5)));
      if(S.eq.body === 'hazmat') inc = Math.max(1, Math.round(inc * .75));
      S.infect = clamp(S.infect + inc, 0, 100);
      cbLog('🦠 它咬穿了你的手臂！感染 +' + inc + '（当前 ' + Math.round(S.infect) + '%）', 'hurt');
      log('🦠 你被咬伤了，感染度上升到 ' + Math.round(S.infect) + '%。抗生素可以压制它。', 'danger');
      if(Math.round(S.infect) >= 35) firstTip('infectHigh', '感染 60% 是爆发期：那时每晚都会 +2，抗生素（-25）要在 60 之前吃。');
      else firstTip('infect', '感染会累积：吃饱睡好每晚自然消退；超过 60% 就只涨不降，抗生素 -25、血清 -60。');
    }
    if(t.bleed && chance(.4)){ b.pSt.bleed = Math.max(b.pSt.bleed, 3); cbLog('🩸 伤口被撕开，开始流血。', 'hurt'); }
    // v3.0 持续性伤口：撕裂常见，重击可能打断骨头（防化服降低概率）
    if(chance(S.eq.body === 'hazmat' ? .08 : .16)) addWound('bleed', 1);
    if(d >= 12 && chance(.10)) addWound('fracture', 1);
    if(t.poison){
      if(S.eq.mask === 'gasmask') cbLog('😷 防毒面具滤住了毒雾。', 'good');
      else { b.pSt.poison = Math.max(b.pSt.poison, 4); cbLog('☠️ 你吸入了毒雾，中毒了。', 'hurt'); }
    }
    if(t.summon && chance(.3) && battle.foes.filter(x => !x.dead).length < 4){
      const nf = mkFoe(pick(['walker','crawler']));
      battle.foes.push(nf);
      cbLog('📣 ' + foe.n + ' 的尖叫引来了 ' + nf.n + '！', 'hurt');
    }
  }
}
function endCombat(result){
  const b = battle; if(!b) return;
  battle = null;
  closeModal(combatModalId); combatModalId = null;
  const wasClean = b.clean;
  if(result === 'win'){
    log('🏁 战斗结束：你活下来了。', 'success');
    sfx('ok');
    if(wasClean) S.stats.cleanWins++;              // C17 悬赏："不受伤害赢下一场"
    if(wasClean && b.foes.length >= 1) award('a_immune');
    if(b.foes.length >= 3) award('a_boom');
    if(S.comp === 'hunter' && chance(.35)){ S.mat += 2; }
    if(b.opts.onWin) b.opts.onWin();
  } else if(result === 'flee'){
    log('🏃 你脱离了战斗。', 'dim');
    if(b.opts.onFlee) b.opts.onFlee();
  } else if(result === 'dead'){
    S.hp = 0;
    gameOver('你在废墟里流干了最后一滴血。', { noRescue: !!b.opts.final || !!b.opts.siege });
  }
  checkQuest(); checkAch(); autosave();
  if(!S.over) render(); else renderHud();
}
/* C05 濒死救援：整档唯一、落盘不可重置、最终决战与尸潮守夜无效、仍扣一半材料 */
function gameOver(msg, opts){
  opts = opts || {};
  const canRescue = !opts.noRescue && !S.flags.rescueUsed && !S.flags.everDied && S.day <= 3;
  if(canRescue){
    S.flags.rescueUsed = true; S.flags.everDied = true;
    const lost = Math.floor(S.mat / 2);
    S.mat -= lost;
    S.hp = Math.max(25, Math.round(S.hpMax * .25));
    S.sta = Math.max(20, Math.round(S.staMax * .3));
    S.infect = Math.min(S.infect, 50);
    if(battle){ battle = null; closeModal(combatModalId); combatModalId = null; }
    sfx('ok'); hr();
    log('🩸 你眼前一黑……再睁眼时，天已经亮了。', 'narrative');
    log('有人把你从尸堆里拖了出来，给你缠了绷带，然后一言不发地走了。', 'narrative');
    log('💊 生命恢复到 ' + S.hp + '，材料损失 ' + lost + ' 点。这是这一档唯一的一次救援。', 'danger');
    toast('🩸 唯一救援已用', '你活下来了，但只此一次：整档有效、不可重置。', 'bad');
    S.flags.tips = S.flags.tips || {};
    autosave();
    checkAch();
    render();
    return;
  }
  S.over = true; S.ap = 0; S.hp = 0;   // 死透：hp 必须归零，否则"over=true 但还有血"这种半死状态会漏进存档与统计
  sfx('lose');
  musicSting('lose');
  const sc = runScore();
  /* M57：死亡结算 —— 把"怎么死的 / 这一局留下了什么 / 下次改什么"讲清楚（旧版只有六格数字） */
  const recapState = {
    day: S.day, hp: 0, hun: S.hun, thi: S.thi, infect: S.infect, rad: S.rad, mat: S.mat,
    wounds: ((S.body && S.body.injuries) || []).map(i => i.id + ':' + i.part),
    loc: S.loc, stats: S.stats, visited: Object.keys((S.world && S.world.visited) || {}).length,
    regions: Object.keys((S.world && S.world.seenRegions) || {}).length,
    lore: S.lore.length, baseLv: baseLevel(), score: sc.raw,
  };
  const cause = causeOfDeath(msg, recapState);
  const record = readBestRun();
  const merged = mergeBest(record, { score: sc.raw, days: S.day, kills: S.stats.kills });
  writeBestRun(merged.best);
  hr();
  log('💀 ' + msg, 'danger');
  log('你生存了 ' + S.day + ' 天，击杀 ' + S.stats.kills + ' 只丧尸。', 'system');
  log('尸体很快会被别的东西吃掉。这就是末日的规则。', 'dim');
  modal({ title:'💀 你死了', sticky:true,
    body:'<p class="muted">' + esc(msg) + '</p>' +
      '<p class="muted" style="margin-top:8px">倒在第 <b class="mono">' + S.day + '</b> / ' + GOAL_DAY + ' 天 · 死在 <b>' + ((MAP[S.loc] || MAP.base).n) + '</b></p>' +
      /* 死因判词（M57）：一句话说清"你是怎么没的" */
      '<div class="card" style="margin-top:12px;padding:10px"><div class="row"><b style="font-size:15px">' + cause.icon + ' ' + cause.label + '</b>' +
      '<span class="spacer"></span><span class="hint">' + esc(cause.how) + '</span></div></div>' +
      recapHtml(sc) +
      /* 下次怎么做（带数字） */
      '<div class="card" style="margin-top:12px;padding:10px"><div class="hint" style="margin-bottom:4px">🧭 下次可以这样：</div>' +
      adviceOf(cause, recapState).map(a => '<div class="hint">· ' + esc(a) + '</div>').join('') + '</div>' +
      /* 本机历史最好 */
      '<p class="muted" style="margin-top:10px">生涯记录：' + esc(bestLine({ score: sc.raw, days: S.day, kills: S.stats.kills }, record, merged.improved)) + '</p>' +
      (S.flags.rescueUsed
        ? '<p class="muted" style="margin-top:8px;color:#e08a72">唯一救援已用（第 1–3 天那次获救不会再来）。</p>'
        : '<p class="muted" style="margin-top:8px">第一次濒死救援还留着：第 1–3 天阵亡会被救回一次（扣一半材料）。</p>'),
    footer:'<button class="btn warn" onclick="restart()">🔄 重新开始</button>' +
      '<button class="btn" onclick="loadGame()">📂 读取存档</button>' +
      '<button class="btn ghost" data-close>看看日志</button>' });
  /* M15：死亡结局（死在实验室 / 死在别处是两种不同的收束） */
  if(window.__v4Ending) window.__v4Ending('dead');
  render();
}
function restart(){
  closeAllModals();
  S = newState(); battle = null;
  clearLog(); initGame(true);
  // M7.1：进游戏改成自动读档后，"新游戏"必须立刻把旧档覆盖掉——否则新开一局还没自动存就关页面，旧档会复活
  writeSave(S);
}
/** M7.1：自动读档之后，重开 = 不可逆地丢进度，必须二次确认（想做的是防误点丢档） */
function confirmRestart(){
  modal({ title:'🔄 重开新档', sticky:true,
    body:'<p class="muted">现在进游戏会自动读档。重开会丢弃当前进度、从第 1 天重新开始，旧存档被覆盖后<b>无法恢复</b>。<br>想留个后路：先在 ☰ 菜单点「💾 保存」（会刷新本机加密备份），之后还能用「🛟 回滚备份」找回来。</p>',
    footer:'<button class="btn danger" onclick="closeAllModals();restart()">确认重开</button>' +
      '<button class="btn" data-close>取消</button>' });
}

/* ═══════════ legacy/30-systems.js ═══════════ */
/* ───────────── 探索 / 区域 ───────────── */
function zoneOpen(id){
  const z = ZONES[id];
  if(z.req && z.req.quest !== undefined && S.quest.stage < z.req.quest) return false;
  return true;
}
function zoneLockText(id){
  const z = ZONES[id];
  if(z.req && z.req.quest !== undefined && S.quest.stage < z.req.quest) return '需要主线推进到「' + QUEST_STAGES[z.req.quest].n + '」（需先架设无线电）';
  return '';
}
function renderExplore(){
  const p = phaseName();
  let h = '<div class="sect-title">今日行动 · 第 ' + S.day + ' 天 ' + p[0] + '</div>';
  h += '<div class="card" style="margin-bottom:12px">' +
    '<div class="row">' +
      '<button class="btn warn" onclick="sleepNight()">🌙 睡觉（进入第 ' + (S.day + 1) + ' 天）</button>' +
      '<button class="btn ok" onclick="restHere()">☕ 就地休整 <span class="mono">(1 行动力)</span></button>' +
      '<button class="btn" onclick="openMerchant()">🏪 呼叫商人</button>' +
      '<span class="spacer"></span>' +
      '<span class="hint">行动力 ' + S.ap + '/' + S.apMax + ' · 搜索 1 点 · 深度搜索 2 点</span>' +
    '</div>' +
    '<div class="hint" style="margin-top:8px">' + (S.ap <= 0
      ? '⚠️ 今天已经没有行动力了。硬撑着继续只会让饥饿和感染追上来——睡觉吧。'
      : '搜刮会消耗饱食与水分，战斗会消耗弹药与体力。' + (S.base.radio ? '无线电已架设：方舟实验室坐标已解锁。' : '架设无线电（据点 → 建设）后才能定位方舟实验室。')) + '</div>' +
  '</div>';
  h += quickBarHtml();          // M38：补给快捷键（数字键 1-5，手机也能点）
  h += renderBounties();
  /* M51：旧版「城市地图」卡整块删除 —— 大世界地图（v4）从 M17 起就取代它了，它唯一还会露脸的时机
     是"本局已结束"的旧版回退窗口，露脸时还带一条「本局已通关」的旧图例（用户报障的截图就是它）。 */
  h += renderCalendar();
  h += '<div class="sect-title">可搜刮区域</div><div class="grid g2">';
  for(const id in ZONES){
    const z = ZONES[id], open = zoneOpen(id), d = +z.d;
    const known = S.seen[id];
    h += '<div class="zone d' + d + (open ? '' : ' locked') + '" ' + (open ? 'onclick="openZone(\'' + id + '\')"' : '') + '>' +
      '<svg class="zsil" viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="' + (ZONE_SIL[id] || '') + '"/></svg>' +
      '<div class="zbody">' +
      '<div class="zn">' + z.icon + ' ' + z.n + '<span class="badge">危险 ' + z.d + '</span>' + (known ? '' : '<span class="badge">未探索</span>') + '</div>' +
      '<div class="zd">' + (open ? z.desc : '🔒 ' + zoneLockText(id)) + '</div>' +
      '<div class="zmeta"><span class="dg">☠️ ' + z.enemies.filter((v, i, a) => a.indexOf(v) === i).map(e => ZOMBIES[e].n).join('/') + '</span>' +
      '<span>📦 掉落 ' + Object.keys(z.loot).filter(k => ITEMS[k]).map(k => itemName(k)).slice(0, 3).join('/') + '</span></div>' +
      '</div></div>';
  }
  h += '</div>';
  return h;
}
/* M38：探索页的补给快捷键条 —— 槽位含义固定（1 止血 / 2 治疗 / 3 补水 / 4 进食 / 5 状态药），
   候选链在 qol-core.QUICK_CHAIN 里；背包里没有的槽整条不显示，键位不会因为少带一样就整体错位。 */
function quickBarHtml(){
  const slots = quickSlots(S.inv, ITEMS);
  if(!slots.length) return '';
  return '<div class="card v4quick" style="margin-bottom:12px"><div class="row" style="flex-wrap:wrap;gap:6px">' +   // M45：给个类名，卡片墙才能认出它是「补给快捷」而不是退化成「📋 ⌨️ 补给快捷（键盘数字」
    '<span class="hint">⌨️ 补给快捷（键盘数字键 / 点一下就用）</span>' +
    slots.map(s => '<button class="btn sm" onclick="useConsumable(\'' + s.id + '\')" title="' + s.hint + '">' +
      '<span class="mono" style="color:var(--warn)">' + s.key + '</span> ' + ITEMS[s.id].n + ' <span class="mono" style="color:var(--dim)">×' + s.n + '</span></button>').join('') +
    '<span class="spacer"></span><span class="hint">' + slots.map(s => s.key + '=' + s.hint).join(' · ') + '</span>' +
    '</div></div>';
}
function openZone(id){
  const mid = modal({ sticky:true, title:'',
    body:'<div id="zone-body"></div>',
    footer:'<button class="btn" data-close>离开</button>',
    onMount(){ drawZone(id); } });
  window.__zoneModal = mid;
}
function drawZone(id){
  const z = ZONES[id], d = +z.d, box = $('#zone-body'); if(!box) return;
  const rows = Object.keys(z.loot).filter(k => ITEMS[k]).map(k =>
    '<div class="lrow"><span class="nm">' + itemName(k) + '</span><span class="ds">' + (ITEMS[k].desc || '') + '</span></div>').join('');
  const foes = z.enemies.filter((v, i, a) => a.indexOf(v) === i).map(e => {
    const t = ZOMBIES[e];
    return '<div class="lrow"><span class="nm" style="color:#ff9b86">' + t.n + '</span><span class="ds">' + t.desc + '</span>' +
      '<span class="rt"><span class="tag">HP ' + Math.round(t.hp * (1 + Math.floor((S.day - 1) / 5) * .22)) + '</span><span class="tag">伤害 ' + t.dmg + '</span></span></div>';
  }).join('');
  box.innerHTML =
    '<div class="modal-hd" style="margin:-16px -16px 12px"><h2>' + z.icon + ' ' + z.n + ' <span class="badge" style="margin-left:6px">危险 ' + z.d + '</span></h2></div>' +
    '<p class="muted" style="margin-bottom:12px">' + z.desc + '</p>' +
    '<div class="sect-title">可能遭遇</div>' + foes +
    '<div class="sect-title">可能找到</div>' + rows +
    (S.loc !== id ? '<div class="row" style="margin-top:14px"><span class="chip heavy">🚶 你还不在' + z.n + '</span>' +
      '<button class="btn primary" onclick="travelTo(\'' + id + '\');drawZone(\'' + id + '\')">前往（' + travelCost(id) + ' 行动力）</button>' +
      '<span class="hint">直接点搜索也会自动走过去，同样要付路程的行动力，路上可能撞上东西。</span></div>' : '') +
    '<div class="row" style="margin-top:14px">' +
      '<button class="btn primary" onclick="searchZone(\'' + id + '\',0)">🔍 搜索 <span class="mono">(1 AP' + (S.loc !== id ? ' + 路程 ' + travelCost(id) : '') + ')</span></button>' +
      '<button class="btn warn" onclick="searchZone(\'' + id + '\',1)">🔦 深度搜索 <span class="mono">(2 AP · 更危险 · 更好的东西)</span></button>' +
    '</div>' +
    '<div class="hint" style="margin-top:10px">当前行动力 ' + S.ap + '/' + S.apMax + ' · 负重 ' + carryWeight() + '/' + capWeight() + ' · 噪音 ' + S.noise + '</div>';
}
/* M32b：`ammo` 是 M25 之前的伪 id（背包里根本没有这条物品）。旧版 `grant('ammo')` 只加到 S.ammo
   这个镜像上 → 商人卖它、委托奖它、掉落给它的结果全是"东西没了"。现在统一折成真弹再进背包：
   手上枪是哪个口径就给哪个口径的弹（捡到的补给是你用得上的），没枪就 9mm FMJ。 */
function grant(id, n, silent){
  n = n || 1;
  id = resolveAmmoId(id, ITEMS, curCal());
  if(!ITEMS[id]) return;                       // 兜底：未知 id 一律不进背包（旧版这里会静默吞掉）
  addItem(id, n, silent);
  syncAmmo();
}
function searchZone(id, deep){
  if(S.over) return;
  if(!zoneOpen(id)){ log('🔒 你还不知道这里的坐标。','dim'); return; }
  if(S.loc !== id){                       // v3.0：搜刮必须先到那儿（路程要花行动力，路上可能撞上东西）
    if(!travelTo(id)) return;
    if(battle) return;                    // 路上打起来了：先打完
  }
  const cost = deep ? 2 : 1;
  if(!spendAP(cost)) return;
  const z = ZONES[id], d = +z.d;
  S.stats.scav++;
  S.stats.zoneCnt[id] = (S.stats.zoneCnt[id] || 0) + 1;   // v2.2：悬赏/支线的"按区域搜刮"计数
  if(deep) S.stats.deep++;                                // v2.2：深度搜索计数
  tickVitals(deep ? 1.5 : 1);
  addXP('survival', deep ? 5 : 3);
  if(S.hp <= 0){ gameOver('你的身体先一步投降了。'); return; }
  hr();
  log((deep ? '🔦 你在' + z.n + '深处翻找，每一秒都在赌命……' : '🔍 你搜索' + z.n + '……'), 'narrative');
  if(deep){ S.noise += 1; noiseCheck(); }
  if(!S.seen[id]){ S.seen[id] = 1; applyFirst(id); bountyTick(); sideTick(); autosave(); drawZone(id); render(); return; }
  const stealth = skillBonus('stealth', .04, .32);
  const w = {
    fight: (0.30 + d * .05) * (deep ? 1.35 : 1) * (1 - stealth),
    item:  .14 * (deep ? 1.5 : 1),
    mats:  .16,
    surv:  .07,
    trap:  .07 + d * .012,
    lore:  .09 * (deep ? 2 : 1) * (S.comp === 'hunter' ? 1.6 : 1),
    empty: .12,
  };
  const kind = wpick(w);
  if(kind === 'fight') encounterRoll(id, deep);
  else if(kind === 'item'){ lootItem(id, deep); }
  else if(kind === 'mats'){
    // C24：深搜的权重被 fight/lore 稀释，实测每 AP 材料低于普通搜索；按隔离实验（_exp_search.js）反推到 16.5 期望值才持平
    const m = deep ? (ri(4, 9) + d * 3 + 4) : (ri(2, 5) + d);
    S.mat += m; sfx('loot');
    log('🔩 你撬开一堆残骸，回收了 ' + m + ' 份材料。', 'loot');
  }
  else if(kind === 'surv') survivorEvent();
  else if(kind === 'trap'){
    const dodge = S.skills.stealth * .02 + (S.eq.feet ? .1 : 0);
    if(chance(dodge)) log('⚠️ 你及时发现了一个陷阱并绕开（潜行生效）。', 'info');
    else { const dmg = ri(4, 8) + d * 2 + Math.floor(S.day / 6) * 2; S.hp -= dmg; sfx('hurt'); shake();   // C24：陷阱按天数钝化
      log('⚠️ 你踩进了一个捕兽夹／绊线陷阱，受到 ' + dmg + ' 点伤害。', 'combat'); }
  }
  else if(kind === 'lore'){
    const pool = (z.lore || []).concat(['l_outbreak','l_tech','l_survivors','l_evo','l_patient0','l_ark']);
    const un = pool.filter(x => !S.lore.includes(x));
    if(un.length && discoverLore(pick(un))) log('📖 你找到了一份可读的记录，秘闻已收录到图鉴。', 'lore');
    else log('📄 墙上贴着几张被雨泡烂的告示，没有可用信息。', 'dim');
  }
  else {
    const empty = ['你翻遍了每一个抽屉，只有灰尘和老鼠屎。',
      '远处传来拖拽的脚步声，你决定先撤。',
      '有人比你先来过这里，能拿的都拿走了。',
      '你听见楼上有响动——不想知道那是什么。',
      '一具新鲜的尸体，身上的东西早被拿光了。'];
    log(pick(empty), 'dim');
  }
  if(S.hp <= 0){ gameOver('你在搜刮时被这一带彻底吞掉了。'); return; }
  bountyTick(); sideTick();                       // C17/C21：搜刮可能推进委托与支线
  checkQuest(); checkAch();
  if(!S.over){ autosave(); drawZone(id); render(); }   // C01/U8：每次行动后自动存档，死亡回档窗口从半天缩到一次搜刮
}
function applyFirst(id){
  const z = ZONES[id], f = z.first;
  hr();
  log('📍 第一次抵达 ' + z.n + '：' + f.log, 'info');
  if(f.item) grant(f.item, f.n || 1);
  if(f.ammo) grant('ammo', f.ammo);
  if(id === 'police'){ S.flags.gotGun = true; firstTip('gun', '拿到枪了：按 I 打开背包 → 装备。枪声很吵，会招来更多东西。'); }
  (z.lore || []).forEach(l => { if(discoverLore(l)) log('📖 秘闻解锁。', 'lore'); });
  addXP('survival', 6);
  toast('新区域', '解锁 ' + z.n + ' 的搜刮信息。', 'ok');
  checkQuest();
}
function lootItem(id, deep){
  const z = ZONES[id];
  const table = {};
  for(const k in z.loot) table[k] = z.loot[k] * (deep ? 1.5 : 1);
  const got = wpick(table);
  const n = ri(1, deep ? 3 : 2);
  grant(got, n);
  sfx('loot');
  addXP('survival', 2);
  if(deep && chance(.25)){
    const bonus = wpick({ ammo:3, medkit:1, grenade:1, kevlar:1, marksman:1 });
    grant(bonus, bonus === 'ammo' ? 12 : 1);
    log('✨ 深处还有别人没找到的东西。', 'loot');
  }
}
function encounterRoll(zoneId, deep){
  const z = ZONES[zoneId], d = +z.d;
  let pool = z.enemies.slice();
  let n = 1;
  // C03 首战降档：还没杀过任何东西的第一天，永远只来 1 只，且不刷尖叫者（它的召唤链是新手猝死主因）
  const firstFight = S.stats.kills === 0 && S.day <= 1;
  const r = Math.random();
  if(r < .18 + d * .02) n = 2;
  if(r < .06 + d * .015) n = 3;
  if(deep && chance(.25)) n++;
  if(firstFight){
    n = 1;
    pool = pool.filter(x => x !== 'screamer');
    if(!pool.length) pool = ['walker'];
  }
  const foes = [];
  for(let i = 0; i < n; i++) foes.push(pick(pool));
  if(n >= 3) log('💀 你被一群丧尸堵在了死角。', 'danger');
  startCombat(foes, { title:'遭遇战 · ' + z.n, sub:'第 ' + S.day + ' 天',
    hint: firstFight ? '第一次交手：点敌人卡片换目标，打不动就按 2 防御（回体力+减伤），按 5 可以逃。'
                     : '点击敌人卡片可以切换目标。' });
}
function survivorEvent(){
  const r = Math.random();
  if(!S.comp && S.day >= 3 && r < .35){
    const ids = Object.keys(COMPANIONS);
    const opts = ids.map(id => {
      const c = COMPANIONS[id];
      return '<div class="lrow"><div><div class="nm">' + c.n + '</div><div class="ds">' + c.desc + '</div></div>' +
        '<span class="rt"><button class="btn sm ok" onclick="recruit(\'' + id + '\')">邀请同行</button></span></div>';
    }).join('');
    modal({ title:'🤝 幸存者营地', body:'<p class="muted">你在废墟里遇到一个还能说话的人。他／她愿意跟你走一段——只要你分得出食物。</p>' + opts,
      footer:'<button class="btn ghost" data-close>婉拒（继续独行）</button>' });
  } else if(r < .6){
    const give = pick(['bandage','can','water','ammo','cloth','powder']);
    const n = give === 'ammo' ? 8 : ri(1, 3);
    grant(give, n);
    log('🤝 你遇到了一队路过的幸存者，他们分了你一些物资。', 'success');
    log('📦 获得 ' + itemName(give) + ' ×' + n, 'loot');
    if(discoverLore('l_survivors')) log('📖 秘闻解锁：幸存者网络', 'lore');
  } else if(r < .8){
    log('🤝 你遇到一个受伤的陌生人。你替他包扎，他给了你一条情报。', 'info');
    addXP('medic', 6);
    if(chance(.5) && S.quest.keycards < 3 && S.day > 3){ S.quest.keycards++; log('📋 他说在军方检查站见过类似的识别卡碎片（门禁卡 ' + S.quest.keycards + '/3）。', 'info'); checkQuest(); }
    else { S.mat += 5; log('🔩 他把身上的零件都给了你（材料 +5）。', 'loot'); }
  } else {
    log('🤝 远处有人朝你挥手，等你走过去时只剩下被扯烂的背包。', 'dim');
    grant('cloth', 2);
  }
}
function recruit(id){
  const c = COMPANIONS[id];
  S.comp = id; S.compHp = c.hp; S.compMax = c.hp;
  closeAllModals();
  log('🤝 ' + c.n + ' 加入了你的队伍。', 'success');
  toast('同伴加入', c.n + ' · ' + c.desc, 'ok');
  if(SIDE_QUESTS[id]){                       // C21：招募即开启该同伴的支线
    log('📜 支线开启：' + SIDE_QUESTS[id].n + ' —— ' + SIDE_QUESTS[id].desc, 'lore');
    toast('📜 支线开启', SIDE_QUESTS[id].n, 'lore');
  }
  render();
}
function restHere(){
  if(S.over) return;
  if(!spendAP(1)) return;
  S.sta = clamp(S.sta + 50, 0, S.staMax);
  S.hp = Math.min(S.hpMax, S.hp + 6);
  S.hun = clamp(S.hun - 3, 0, 100); S.thi = clamp(S.thi - 4, 0, 100);
  sfx('ok');
  log('☕ 你在阴影里坐下来，啃了点东西，把气喘匀了（体力 +50，生命 +6）。', 'success');
  checkAch(); autosave(); render();
}
/* ───────────── 消耗品 / 装备 ───────────── */
function useConsumable(id, inCombat){
  if(!has(id)) return false;
  const it = ITEMS[id];
  takeItem(id, 1);
  const healMul = (1 + skillBonus('medic', .08, .8)) * radTier(S.rad).healMul;   // M25：重度辐射下伤口长得慢
  const notes = [];
  /* M25：碘片 / 抗辐射药 —— 把体内辐射压下去 */
  if(it.rad){
    const before = S.rad;
    S.rad = clamp(S.rad + it.rad, 0, 100);
    notes.push('辐射 ' + before + ' → ' + S.rad);
  }
  if(it.heal){ const h = Math.round(it.heal * healMul); S.hp = Math.min(S.hpMax, S.hp + h); notes.push('生命 +' + h); }
  if(it.hun){ const h = Math.round(it.hun * (1 + skillBonus('survival', .05, .4))); S.hun = clamp(S.hun + h, 0, 100); notes.push('饱食 +' + h); }
  if(it.thi){ const sv3 = (typeof window.V4Survival === 'object' && window.V4Survival) ? window.V4Survival : null; const dryMul = sv3 ? sv3.drinkGain() : 1; const h = Math.round(it.thi * (1 + skillBonus('survival', .05, .4)) * dryMul); S.thi = clamp(S.thi + h, 0, 100); notes.push('水分 +' + h + (dryMul < 1 ? '（干燥天只补七成）' : '')); }
  if(it.sta){ S.sta = clamp(S.sta + it.sta, 0, S.staMax); notes.push('体力 +' + it.sta); }
  if(it.infect){
    const v = Math.round(it.infect * (1 - skillBonus('medic', .05, .5)));
    S.infect = clamp(S.infect + v, 0, 100);
    notes.push('感染 ' + (v > 0 ? '+' : '') + v + '%');
  }
  if(it.cure && battle && battle.pSt[it.cure]){ battle.pSt[it.cure] = 0; notes.push('已解除' + (it.cure === 'bleed' ? '流血' : '中毒')); }
  if(it.cureWound && cureWound(it.cureWound)) notes.push('已处理' + WOUND_DEF[it.cureWound].n);
  /* M50：抗生素 / 抗真菌药这类"治病的药"：顺手把对应的病症压下去（人体页那个按钮走的是同一条路） */
  if(it.clearCond){
    const sv5 = (typeof window.V4Survival === 'object' && window.V4Survival) ? window.V4Survival : null;
    const cured = sv5 && sv5.treatByItem ? sv5.treatByItem(id) : null;
    if(cured) notes.push('压住了' + cured);
  }
  /* M30：湿度计 —— 看一眼未来三天的湿度走势（确定性：由种子+天数决定，和 env.ts 的翻日同一套） */
  if(it.forecast){
    const sv4 = (typeof window.V4Survival === 'object' && window.V4Survival) ? window.V4Survival : null;
    const lines = sv4 ? sv4.forecastLines(3) : ['（湿度计坏了，读数一片模糊）'];
    log('🌡️ 湿度计读数：' + lines.join(' / '), 'info');
    notes.push('未来三天读出');
  }
  if(it.sick && chance(it.sick)){ addWound('sick', 1); notes.push('吃坏了肚子'); }
  sfx('ok');
  log('💊 使用 ' + it.n + '：' + notes.join('，'), 'success');
  addXP('medic', 2);
  if(!inCombat){ render(); }
  return true;
}
function equipItem(id){
  const it = ITEMS[id]; if(!it || !it.slot) return;
  const slot = it.slot;
  const old = S.eq[slot];
  if(old === id){ S.eq[slot] = null; log('🧥 卸下了 ' + it.n + '。', 'info'); }
  else {
    S.eq[slot] = id;
    log('🧥 装备 ' + it.n + '。' + (it.desc ? '（' + it.desc + '）' : ''), 'info');
  }
  if(slot === 'bag') S.staMax = 100 + S.skills.fitness * 5;
  render(); autosave();
}
function equipWeapon(id){
  if(!isWpn(id) || !has(id)) return;
  S.eq.wpn = id;
  syncAmmo();                                   // M32b：换了枪就换了口径，HUD 的弹药数要跟着换
  log('🗡️ 换上 ' + ITEMS[id].n + '（伤害 ' + ITEMS[id].dmg + (ITEMS[id].ammo ? ' · 弹药 ' + ITEMS[id].ammo + '/次' : ' · 体力 ' + (ITEMS[id].sta || 0) + '/次') + '）', 'info');
  render(); autosave();
}
/* M38：丢几个 / 存几个 / 背包筛选状态（会话级，跟 codexCat 一样不进存档） */
function dropItem(id, n){
  const have = itemCount(id);
  const k = dropCount(have, n === undefined ? 'all' : n);
  if(!k) return;
  if(k >= have) delete S.inv[id]; else S.inv[id] = have - k;
  log('🗑️ 丢弃了 ' + itemName(id) + ' ×' + k + '。', 'dim');
  render();
}
let bagFilter = 'all';
function setBagFilter(f){ bagFilter = f; sfx('ui'); render(); }
function deposit(id){
  const have = itemCount(id); if(!have) return;
  const cap = S.base.storage * 12;
  const used = Object.keys(S.store).reduce((a, k) => a + S.store[k], 0);
  /* M38：以前箱子"塞不下就整笔拒绝"，现在能塞多少塞多少（剩下的留在背包里并说明白） */
  const plan = depositCount(have, used, cap);
  if(!plan.n){ log('❌ ' + plan.reason, 'dim'); return; }
  if(plan.n >= have) delete S.inv[id]; else S.inv[id] = have - plan.n;
  S.store[id] = (S.store[id] || 0) + plan.n;
  log('📦 存入储物箱：' + itemName(id) + ' ×' + plan.n + (plan.reason ? '（' + plan.reason + '）' : ''), 'info');
  render(); autosave();
}
/* M38：批量存入 —— 当前筛选那类，或"非消耗品"（材料/武器/装备/投掷/剧情/弹药）。
   刻意不把食物/饮水/医疗算进"全部"：出门前一键把吃的全塞箱子是纯手滑。 */
function depositAll(){
  const cap = S.base.storage * 12;
  let used = Object.keys(S.store).reduce((a, k) => a + S.store[k], 0);
  const ids = Object.keys(S.inv).filter(k => !!ITEMS[k]);
  const pick = bagFilter === 'all'
    ? ids.filter(k => ['food','drink','med'].indexOf(ITEMS[k].t) < 0)
    : filterInv(ids, ITEMS, bagFilter);
  let moved = 0, kinds = 0, reason = '';
  pick.forEach(id => {
    const have = itemCount(id); if(!have) return;
    const plan = depositCount(have, used, cap);
    if(!plan.n){ reason = plan.reason; return; }
    if(plan.n >= have) delete S.inv[id]; else S.inv[id] = have - plan.n;
    S.store[id] = (S.store[id] || 0) + plan.n;
    used += plan.n; moved += plan.n; kinds++;
    if(plan.reason) reason = plan.reason;
  });
  if(!moved){ log('❌ ' + (reason || '这类东西背包里没有。'), 'dim'); return; }
  log('📦 批量存入：' + kinds + ' 种 · ' + moved + ' 件' + (reason ? '（' + reason + '）' : ''), 'info');
  render(); autosave();
}
function withdraw(id){
  const n = S.store[id]; if(!n) return;
  delete S.store[id]; addItem(id, n, true);
  log('📦 取出：' + itemName(id) + ' ×' + n, 'info');
  render(); autosave();
}
const TYPE_LABEL = { food:'食物', drink:'饮水', med:'医疗', mat:'材料', wpn:'武器', gear:'装备', thr:'投掷', key:'剧情', ammo:'弹药' };
const TYPE_TAG = { food:'med', drink:'mat', med:'med', mat:'mat', wpn:'wpn', gear:'gear', thr:'thr', key:'key', ammo:'key' };
function renderInv(){
  const slots = [['wpn','🗡️ 武器'],['head','⛑️ 头部'],['body','🧥 身体'],['mask','😷 面罩'],['feet','👟 足部'],['trinket','🦴 挂饰'],['bag','🎒 背包']];
  let h = '<div class="sect-title">装备</div><div class="grid g3">';
  slots.forEach(s => {
    const id = S.eq[s[0]];
    h += '<div class="card" style="padding:10px"><div class="hint">' + s[1] + '</div>' +
      (id ? '<div class="nm" style="margin:4px 0;color:var(--bone)">' + ITEMS[id].n + '</div><div class="ds hint">' + (ITEMS[id].desc || '') + '</div>' +
        (s[0] === 'wpn' ? '<span class="tag eq" style="display:inline-block;margin-top:6px">战斗中自动使用</span>'
          : '<button class="btn xs ghost" style="margin-top:6px" onclick="equipItem(\'' + id + '\')">卸下</button>')
        : '<div class="nm" style="margin:4px 0;color:var(--dim)">空</div>') + '</div>';
  });
  h += '</div>';
  h += ammoSectionHtml();        // M25：口径与弹种（换装入口，HUD 也能点）
  h += '<div class="sect-title">携带物品 <span class="badge">' + carryWeight() + ' / ' + capWeight() + ' kg</span></div>';
  /* M24.1：过滤掉 ITEMS 里不存在的 id —— 坏档/旧档里如果混进未知物品，
     原来会在这里 sort 时读 undefined.t 直接抛异常（整个背包页白屏）。 */
  const allIds = Object.keys(S.inv).filter(k => !!ITEMS[k] && S.inv[k] > 0);
  /* M38：筛选条（空类不显示）+ 批量存入按钮。筛选只作用于随身背包，储物箱永远是全量。 */
  const tabs = filterTabs(allIds, ITEMS);
  if(allIds.length){
    h += '<div class="row" style="margin-bottom:8px;flex-wrap:wrap;gap:4px">' +
      tabs.map(t => '<button class="btn xs ' + (bagFilter === t.id ? 'warn' : 'ghost') + '" onclick="setBagFilter(\'' + t.id + '\')">' +
        t.label + (t.id === 'all' ? '' : ' ' + t.n) + '</button>').join('') +
      '<span class="spacer"></span>' +
      '<button class="btn xs ok" onclick="depositAll()">📦 ' + (bagFilter === 'all' ? '存入非消耗品' : '把这一类全存') + '</button>' +
      '</div>';
  }
  const ids = (() => { allIds.sort((a, b) => (ITEMS[a].t + a).localeCompare(ITEMS[b].t + b)); return filterInv(allIds, ITEMS, bagFilter); })();
  if(!allIds.length) h += '<p class="muted">背包是空的。去找点能用的东西。</p>';
  else if(!ids.length) h += '<p class="muted">这一类里什么都没有。<button class="btn xs ghost" onclick="setBagFilter(\'all\')">看全部</button></p>';
  else {
    if(bagFilter !== 'all') h += '<div class="hint" style="margin-bottom:6px">筛选「' + (BAG_FILTERS.find(f => f.id === bagFilter) || {}).label + '」· ' + ids.length + ' 种（筛选只作用于随身背包）</div>';
    h += '<div class="grid g2">';
    ids.forEach(id => {
      const it = ITEMS[id], n = S.inv[id];
      const usable = it.t === 'food' || it.t === 'drink' || it.t === 'med';
      h += '<div class="lrow"><div><div class="nm">' + it.n + ' <span class="mono" style="color:var(--dim)">×' + n + '</span></div>' +
        '<div class="ds">' + (it.desc || '') + '</div></div><div class="rt">' +
        '<span class="tag ' + TYPE_TAG[it.t] + '">' + TYPE_LABEL[it.t] + '</span>' +
        (usable ? '<button class="btn xs ok" onclick="useConsumable(\'' + id + '\')">使用</button>' : '') +
        (it.slot ? '<button class="btn xs ' + (S.eq[it.slot] === id ? 'warn' : '') + '" onclick="equipItem(\'' + id + '\')">' + (S.eq[it.slot] === id ? '已装备' : '装备') + '</button>' : '') +
        (it.t === 'wpn' ? '<button class="btn xs ' + (S.eq.wpn === id ? 'warn' : '') + '" onclick="equipWeapon(\'' + id + '\')">' + (S.eq.wpn === id ? '使用中' : '装备') + '</button>' : '') +
        (it.t === 'thr' ? '<span class="tag">战斗中投掷</span>' : '') +
        '<button class="btn xs ghost" onclick="deposit(\'' + id + '\')">存入</button>' +
        /* M38：丢东西不再"一点全没" —— 单件丢，整叠丢要明说 */
        '<button class="btn xs danger" onclick="dropItem(\'' + id + '\',1)" title="只丢 1 个">丢1</button>' +
        (n > 1 ? '<button class="btn xs danger" onclick="dropItem(\'' + id + '\')" title="丢掉全部 ' + n + ' 个">全丢×' + n + '</button>' : '') +
        '</div></div>';
    });
    h += '</div>';
  }
  h += '<div class="sect-title">基地储物箱 <span class="badge">' + Object.keys(S.store).reduce((a, k) => a + S.store[k], 0) + ' / ' + (S.base.storage * 12) + '</span></div>';
  const sids = Object.keys(S.store).filter(k => !!ITEMS[k]);   // 同上：未知 id 不进渲染
  if(!sids.length) h += '<p class="muted">储物箱' + (S.base.storage ? '是空的。' : '还没建（据点 → 建设）。') + '</p>';
  else {
    h += '<div class="grid g2">';
    sids.forEach(id => {
      h += '<div class="lrow"><div><div class="nm">' + itemName(id) + ' <span class="mono" style="color:var(--dim)">×' + S.store[id] + '</span></div>' +
        '<div class="ds">' + (ITEMS[id].desc || '') + '</div></div>' +
        '<div class="rt"><button class="btn xs" onclick="withdraw(\'' + id + '\')">取回</button></div></div>';
    });
    h += '</div>';
  }
  return h;
}

/* ───────────── 制作 ───────────── */
/* C21 支线面板（任务页） */
function renderSideQuests(){
  let h = '<div class="sect-title">同伴支线 <span class="badge">' + Object.keys(SIDE_QUESTS).length + ' 条</span></div>';
  let any = false;
  for(const c in SIDE_QUESTS){
    const q = SIDE_QUESTS[c], idx = S.side[c] || 0, done = idx >= q.steps.length;
    if(S.comp !== c && !done) continue;
    any = true;
    h += '<div class="card" style="margin-bottom:8px"><h3>' + q.n + ' <span class="sub">' +
      (done ? '✅ 已完成' : '第 ' + (idx + 1) + '/' + q.steps.length + ' 步') + '</span></h3><div class="hint">' + q.desc + '</div>';
    if(!done){
      const st = q.steps[idx];
      let progTxt;
      if(st.type === 'items') progTxt = Object.keys(st.need).map(k => itemName(k) + ' ' + itemCount(k) + '/' + st.need[k]).join(' · ');
      else { const base = S.sideBase[c + ':' + idx]; const cur = metricValue(st.metric);
        progTxt = Math.min(st.need, base === undefined ? 0 : Math.max(0, cur - base)) + ' / ' + st.need; }
      h += '<div class="row" style="margin-top:6px"><span class="nm">' + st.t + '</span><span class="spacer"></span>' +
        '<span class="hint mono">' + progTxt + '</span>' +
        (st.type === 'items' ? '<button class="btn xs ok" onclick="sideAdvance(\'' + c + '\')">交付</button>' : '') + '</div>';
    } else h += '<div class="hint" style="color:var(--med)">奖励已领取：' + (ITEMS[q.reward.item] ? ITEMS[q.reward.item].n : '—') + '</div>';
    h += '</div>';
  }
  if(!any) h += '<p class="muted">还没有同伴。在幸存者营地邀请一个人同行，就会开启他的支线。</p>';
  return h;
}
/* C22 改装面板（制作页） */
function renderMods(){
  const wid = (S.eq.wpn && ITEMS[S.eq.wpn]) ? S.eq.wpn : 'crowbar', w = ITEMS[wid];
  const cur = modsOf(wid);
  let h = '<div class="sect-title">武器改装 <span class="badge">工作台 Lv.' + S.base.bench + '（需 Lv.2）</span></div>';
  h += '<div class="card" style="margin-bottom:8px"><h3>' + w.n + ' <span class="sub">' +
    (cur.length ? cur.map(m => MODS[m].n).join(' + ') : '未改装（最多 2 件）') + '</span></h3>' +
    '<div class="hint">当前：伤害 ' + Math.round(effDmg(w, !!w.ammo).d) + ' · 暴击 ' + Math.round(effDmg(w, !!w.ammo).crit * 100) + '%' +
    (w.ammo ? ' · 每次消耗 ' + Math.max(1, w.ammo + modSum(wid, 'ammo')) + ' 发弹药' : ' · 体力 ' + Math.round((w.sta || 0) * modMul(wid, 'stamult'))) +
    '</div></div>';
  h += '<div class="grid g2">';
  for(const m in MODS){
    const d = MODS[m], has = cur.indexOf(m) >= 0;
    const canMat = Object.keys(d.cost).every(k => itemCount(k) >= d.cost[k]);
    const ok = S.base.bench >= 2 && !has && cur.length < 2 && canMat && S.ap >= 1;
    h += '<div class="lrow" style="flex-direction:column;align-items:stretch;gap:6px">' +
      '<div class="row"><span class="nm">' + d.n + '</span><span class="spacer"></span>' + (has ? '<span class="tag eq">已安装</span>' : '') + '</div>' +
      '<div class="ds">' + d.desc + '</div>' +
      '<div class="row">' + Object.keys(d.cost).map(k => '<span class="tag ' + (itemCount(k) >= d.cost[k] ? 'eq' : '') + '">' + itemName(k) + ' ' + itemCount(k) + '/' + d.cost[k] + '</span>').join('') + '</div>' +
      '<button class="btn sm ' + (ok ? 'ok' : '') + '" ' + (ok ? '' : 'disabled') + ' onclick="addMod(\'' + m + '\')">' +
      (has ? '已安装' : (S.base.bench < 2 ? '需要工作台 Lv.2' : (cur.length >= 2 ? '改装位已满' : '安装 (1 AP)'))) + '</button></div>';
  }
  h += '</div>';
  return h;
}
function renderCraft(){
  /* M25：制作页按"工作站"分区（藏身处那套）——工作台 / 弹药台 / 医疗台 / 灶台。
     每个站显示自己的等级与该站配方；没有的站直接告诉你它还没建。 */
  const STATIONS = [
    {k:'bench',   icon:'🛠️', n:'工作台', desc:'基础制作：绷带、胶水、燃烧瓶、手雷。'},
    {k:'loading', icon:'🔩', n:'弹药台', desc:'复装与改装弹药：普通弹 / 穿甲弹 / 独头弹，按口径分开。'},
    {k:'medlab',  icon:'⚗️', n:'医疗台', desc:'制药：急救包、解毒剂、碘片、抗辐射药。'},
    {k:'kitchen', icon:'🍳', n:'灶台',   desc:'把生食做熟、批量煮水、风干肉。'},
  ];
  const powered = (S.base.power || 0) > 0;               // M25：发电机（全局增益，不是配方站）
  let h = '<div class="sect-title">制作 <span class="badge">每件 1 行动力</span></div>';
  h += '<p class="muted" style="margin-bottom:10px">材料来自搜刮与击杀。四个站各管一摊：先在<b>据点 → 建设</b>里把它们建起来，等级越高配方越深。' +
    (powered ? '<b style="color:var(--green)">🔋 发电机在转</b>：医疗台 +1 产出、净水 +1、菜园保鲜 +1 天。'
      : '建了<b>发电机</b>还能给医疗台 +1 产出（净水 +1、菜园保鲜 +1 天）。') + '</p>';
  for(const st of STATIONS){
    const lv = S.base[st.k] || 0;
    const list = RECIPES.map((r, i) => ({r, i})).filter(x => (x.r.st || 'bench') === st.k);
    h += '<div class="sect-title" style="margin-top:12px">' + st.icon + ' ' + st.n +
      ' <span class="badge">' + (lv > 0 ? 'Lv.' + lv : '还没建') + '</span>' +
      '<span class="badge">' + list.filter(x => lv >= x.r.lv).length + ' / ' + list.length + ' 配方</span></div>';
    h += '<div class="hint" style="margin-bottom:6px">' + st.desc + (lv === 0 ? '　→ 在<b>据点 → 建设</b>里花材料建起来（' + buildCostText(st.k) + '）。' : '') + '</div>';
    h += '<div class="grid g2">';
    for(const {r, i} of list){
      const okSt = lv >= r.lv;
      const okMat = Object.keys(r.need).every(k => (S.inv[k] || 0) >= r.need[k]);
      const out = ITEMS[r.out] || { n: r.out };
      const need = Object.keys(r.need).map(k => '<span class="tag ' + (itemCount(k) >= r.need[k] ? 'eq' : '') + '">' + itemName(k) + ' ' + itemCount(k) + '/' + r.need[k] + '</span>').join(' ');
      const ammoTag = out.t === 'ammo' ? '<span class="tag ' + (out.pen >= 4 ? 'wpn' : '') + '">穿透 ' + out.pen + '</span>' : '';
      h += '<div class="lrow" style="flex-direction:column;align-items:stretch;gap:6px">' +
        '<div class="row"><span class="nm">' + out.n + ' ×' + r.n + '</span>' + ammoTag + '<span class="spacer"></span><span class="tag">' + st.n + ' Lv.' + r.lv + '</span></div>' +
        '<div class="ds">' + r.desc + '</div>' +
        '<div class="row">' + need + '</div>' +
        '<button class="btn sm ' + (okSt && okMat ? 'ok' : '') + '" ' + (okSt && okMat ? '' : 'disabled') + ' onclick="craft(' + i + ')">' +
          (okSt ? (okMat ? '制作 (1 AP)' : '材料不足') : (lv === 0 ? '需要先建' + st.n : '需要' + st.n + ' Lv.' + r.lv)) + '</button></div>';
    }
    h += '</div>';
  }
  h += '</div>';
  h += renderMods();          // C22：改装面板紧跟在制作配方后面
  return h;
}
function craft(i){
  const r = RECIPES[i];
  const st = r.st || 'bench';
  const stName = (BASE_UP[st] && BASE_UP[st].n) || '工作台';
  if((S.base[st] || 0) < r.lv){ log('❌ ' + stName + '等级不够（需要 Lv.' + r.lv + '）。','dim'); return; }
  if(!Object.keys(r.need).every(k => (S.inv[k] || 0) >= r.need[k])){ log('❌ 材料不足。','dim'); return; }
  if(!spendAP(1)) return;
  Object.keys(r.need).forEach(k => takeItem(k, r.need[k]));
  /* M24 技能：厨艺（煮水/做饭多出 1 份）、制作（按等级概率返还材料） */
  const isCook = r.out === 'water' || (ITEMS[r.out] && ITEMS[r.out].t === 'food');
  /* M25 发电机：医疗台通电后每件多出 1 份（跟厨艺一样是"站台增益"，不叠加到别的站上） */
  const poweredBonus = st === 'medlab' && (S.base.power || 0) > 0 ? 1 : 0;
  let outN = r.n + (isCook && hasPerk('cook', 3) ? 1 : 0) + poweredBonus;
  if(isCook && S.skills.cook >= 2 && !hasPerk('cook', 3)) outN += Math.floor(S.skills.cook / 2);
  grant(r.out, outN);
  const refundP = (S.skills.craft || 0) * (hasPerk('craft', 3) ? .20 : .10);
  let refunded = '';
  if(refundP > 0){
    for(const k in r.need){ if(S.inv[k] !== undefined && Math.random() < refundP){ grant(k, 1); refunded = itemName(k); break; } }
  }
  S.stats.crafted++;
  addXP('craft', 4);                       // M24：制作自己一条技能线
  if(isCook) addXP('cook', 3);             // 煮水/做饭涨厨艺
  sfx('ok');
  log('🛠️ 制作完成：' + (ITEMS[r.out] ? ITEMS[r.out].n : '弹药') + ' ×' + outN +
    (isCook && outN > r.n ? '（厨艺 +' + (outN - r.n) + '）' : '') +
    (poweredBonus ? '（🔋 发电机 +' + poweredBonus + '）' : '') +
    (refunded ? '　♻️ 制作技能返还了 ' + refunded : ''), 'success');
  bountyTick(); sideTick();
  checkAch(); render(); autosave();
}

/* ───────────── 据点 ───────────── */
/* M54：据点页**全面革新**（用户：「全面革新据点系统，现在还是太何意味了」）。
   以前是 15 张一模一样、大半灰着的卡：看不出"建了有什么用"、看不出"今晚守不守得住"、
   也看不出"现在到底该建什么"。现在这一页是一间**作战室**：
     ① 安全屋：睡觉/休整/商人 + 今晚尸潮概率；
     ② 🌙 今夜守夜：判词（稳/悬/危险）+ 防线血条 + 抢修 + 陷阱 + 弃守代价预告；
     ③ 🌾 明天的收成：净水/蔬菜/鱼各多少、为什么是这个数（发电机/断水/季节都在这一行说清）；
     ④ 🧭 该建什么：按局势与手上材料排前三，每条带理由（可解释，不是玄学推荐）；
     ⑤ 🛠️ 设施：守夜/产线/工坊/基建 四个分区，每张卡写清"升级后会多出什么"与"还差什么材料"。
   算式全部来自 v4/base-core（可单测的唯一真值），这一页只负责摆出来、点下去。 */
function renderBase(){
  const stk = (cost) => { const out = {}; for(const m in cost) out[m] = itemCount(m); return out; };
  const costOf = (k) => coreScaledCost(BASE_UP[k].cost, S.base[k] || 0);
  const afford = (k) => { const c = costOf(k); return Object.keys(c).every(m => itemCount(m) >= c[m]); };
  const dm = defMax();
  const tonight = raidGuaranteed(S.day, S.horde.eta);
  const chancePct = Math.round(raidChance(S.day, S.noise) * 100);
  const drag = abandonCost({ day: S.day, doorLv: S.base.door || 0, wallLv: S.base.wall || 0, blood: S.cal.bloodMoon, mat: S.mat });
  const verdict = verdictOf({ doorHp: S.def.doorHp, wallHp: S.def.wallHp, doorMax: dm.door, wallMax: dm.wall,
    traps: S.def.traps, tonightRaid: tonight, bloodMoon: S.cal.bloodMoon, hordeEta: S.horde.eta });
  const season = seasonOf(S.day), weather = (S.env && S.env.weather) || 'clear';
  const pondFed = POND_FEED_ITEMS.some(id => itemCount(id) > 0);
  const yield_ = nightlyYield({ base: S.base, gridOff: powerOff(), hasFuel: has('fuel'), season, weather, pondFed, vegFreshBase: (ITEMS.veg && ITEMS.veg.fresh) || 3 });

  /* ── ① 安全屋 ── */
  let h = '<div class="sect-title">安全屋 <span class="badge">第 ' + S.day + ' 天</span>' +
    '<span class="badge">设施等级合计 ' + baseLevel() + '</span>' +
    '<span class="badge ' + (tonight ? 'heavy warnpulse' : '') + '">' + (tonight ? '今晚必打' : '今晚尸潮 ' + chancePct + '%') + '</span></div>';
  h += '<div class="card" style="margin-bottom:12px"><div class="row">' +
    '<button class="btn warn" onclick="sleepNight()">🌙 睡觉（进入第 ' + (S.day + 1) + ' 天）</button>' +
    '<button class="btn ok" onclick="restHere()">☕ 休整 (1 AP)</button>' +
    '<button class="btn" onclick="openMerchant()">🏪 呼叫商人（' + (S.base.radio ? '无线电常驻' : '需要无线电') + '）</button>' +
    '<span class="spacer"></span><span class="hint">建造消耗 <b>1 行动力</b> + 材料；尸潮判定：基础 16% + 天数 + 噪音每点 3%</span></div>' +
    '<div class="hint" style="margin-top:8px">今晚怎么过，全看下面这张「今夜守夜」：防线还在，它们就进不来。</div></div>';

  /* ── ② 今夜守夜 ── */
  h += '<div class="sect-title">🌙 今夜守夜 <span class="badge ' + (verdict.tier === 'danger' ? 'heavy warnpulse' : verdict.tier === 'risky' ? 'warnpulse' : '') + '">判词：' + verdict.label + '</span>' +
    '<span class="badge">' + (S.cal.bloodMoon ? '🩸 血月' : '血月 ' + daysToHorde() + ' 天后') + '</span>' +
    (S.horde.eta > 0 ? '<span class="badge heavy">🧟 尸群 ' + S.horde.eta + ' 天后</span>' : '') + '</div>';
  h += '<div class="card" style="margin-bottom:12px">' +
    '<div class="hint" style="margin-bottom:8px">' + verdict.hint + '</div>' +
    '<div class="hbar"><div class="top"><span>🚪 门窗</span><b>' + Math.round(S.def.doorHp) + ' / ' + dm.door + '</b></div><div class="bar"><i class="sta" style="width:' + clamp(S.def.doorHp / Math.max(1, dm.door) * 100, 0, 100) + '%"></i></div></div>' +
    '<div class="hbar" style="margin-top:6px"><div class="top"><span>🧱 围墙</span><b>' + Math.round(S.def.wallHp) + ' / ' + dm.wall + (dm.wall ? '' : '（还没围墙）') + '</b></div><div class="bar"><i class="sta" style="width:' + clamp(S.def.wallHp / Math.max(1, dm.wall) * 100, 0, 100) + '%"></i></div></div>';
  const fixCost = { metal: 2, wood: 2 };
  const fixMiss = missingFor(fixCost, stk(fixCost));
  const needFix = S.def.doorHp < dm.door || S.def.wallHp < dm.wall;
  const canFix = !fixMiss.length && S.ap >= 1 && needFix;
  h += '<div class="row" style="margin-top:8px"><button class="btn sm ok" ' + (canFix ? '' : 'disabled') + ' onclick="repairDefense()">🔨 抢修防线 (1 AP + 铁片2/木料2)</button>' +
    '<span class="hint">' + (!needFix ? '防线是满的，不用修。' : S.ap < 1 ? '没有行动力了。' : fixMiss.length ? '还差 ' + fixMiss.map(m => itemName(m.mat) + '×' + m.short).join('、') : '尸潮期间也能在战斗里抢修（更贵，但救命）。') + '</span></div>';
  h += '<div class="grid g3" style="margin-top:10px">' + Object.keys(TRAPS).map(k => {
    const t = TRAPS[k], n = S.def.traps[k], cap = trapCap(k);
    const cost = stk(t.cost), miss = missingFor(t.cost, cost);
    const can = !miss.length && S.ap >= 1 && n < cap;
    return '<div class="card" style="padding:10px"><h3 style="font-size:12px">' + t.icon + ' ' + t.n + ' <span class="sub">×' + n + (cap > 1 ? '/' + cap : '') + '</span></h3>' +
      '<div class="hint" style="min-height:34px">' + t.desc + '</div>' +
      '<div class="row" style="margin:6px 0">' + Object.keys(t.cost).map(m => '<span class="tag ' + (itemCount(m) >= t.cost[m] ? 'eq' : '') + '">' + itemName(m) + ' ' + itemCount(m) + '/' + t.cost[m] + '</span>').join('') + '</div>' +
      '<button class="btn sm block ' + (can ? 'warn' : '') + '" ' + (can ? '' : 'disabled') + ' onclick="buildTrap(\'' + k + '\')">' + (n >= cap ? '已布满' : miss.length ? '还差 ' + miss.map(m => itemName(m.mat)).join('、') : '布置 (1 AP)') + '</button></div>';
  }).join('') + '</div>';
  h += '<div class="hint" style="margin-top:8px">守不住就得弃守：今晚弃守大约 <b>掉 ' + drag.hpLoss + ' 点生命 + 丢 ' + drag.matLoss + ' 材料</b>（门窗/围墙等级越高越轻；有围墙再减半）。' +
    '陷阱是"提前准备的回报"：开场就结算，不占回合。</div></div>';

  /* ── ③ 明天的收成 ── */
  const yBadge = (yield_.water ? '💧 +' + yield_.water : '') + (yield_.veg ? ' · 🥬 +' + yield_.veg : '') + (yield_.fish ? ' · 🐟 +' + yield_.fish : '');
  h += '<div class="sect-title">🌾 明天的收成 <span class="badge">' + (yBadge.replace(/^ · /, '') || '还没有产线设施') + '</span>' +
    '<span class="badge">' + (powerOff() ? '🔌 电网已断' : '🔌 电网正常') + '</span>' +
    ((S.base.power || 0) > 0 ? '<span class="badge">🔋 发电机在转</span>' : '') + '</div>';
  h += '<div class="card" style="margin-bottom:12px"><div class="grid g3">' +
    '<div><div class="hint">💧 净水</div><b>' + (yield_.water ? '+' + yield_.water + ' / 天' : '0') + '</b><div class="hint">' + (yield_.waterNote || '净水装置 Lv.' + (S.base.filter || 0)) + '</div></div>' +
    '<div><div class="hint">🥬 新鲜蔬菜</div><b>' + (yield_.veg ? '+' + yield_.veg + ' / 天' : '0') + '</b><div class="hint">' + (yield_.veg ? yield_.vegSpoilDays + ' 天内要吃掉或炖了' : '还没有菜园') + '</div></div>' +
    '<div><div class="hint">🐟 鱼</div><b>' + (yield_.fish ? '+' + yield_.fish + ' / 天' : '0') + '</b><div class="hint">' + yield_.fishNote + '</div></div>' +
    '</div><div class="hint" style="margin-top:8px">另外：医疗台每晚 +' + ((S.base.power || 0) > 0 ? 1 : 0) + ' 份药（需发电机）· 储物箱 ' + (S.base.storage * 12) + ' 格 · 熟食与净水都能靠工坊自己做。</div></div>';

  /* ── ④ 该建什么 ── */
  const adv = adviseBuilds({ base: S.base, stock: stk({}), table: BASE_UP, day: S.day, ap: S.ap, hordeEta: S.horde.eta, bloodMoonToday: S.cal.bloodMoon, buildable: afford });
  h += '<div class="sect-title">🧭 该建什么 <span class="badge">按当下局势排的</span></div><div class="card" style="margin-bottom:12px">';
  h += adv.map((a, i) => {
    if (!a.key) return '<div class="hint">' + a.why + '</div>';
    const u = BASE_UP[a.key], lv = S.base[a.key] || 0, cost = costOf(a.key), miss = missingFor(cost, stk(cost));
    const can = !miss.length && S.ap >= 1;
    return '<div class="row" style="margin:' + (i ? '10px' : '0') + ' 0 0;align-items:flex-start">' +
      '<span class="badge ' + (a.urgent ? 'heavy warnpulse' : '') + '">' + (i + 1) + '</span>' +
      '<div style="flex:1;min-width:0"><div><b>' + u.icon + ' ' + u.n + '</b> <span class="sub">Lv.' + lv + '/' + u.max + ' → Lv.' + (lv + 1) + '：' + facilityDelta(a.key, lv + 1, { powerLv: S.base.power || 0 }) + '</span></div>' +
      '<div class="hint">' + a.why + '</div>' +
      '<div class="hint">' + (miss.length ? '还差 ' + miss.map(m => itemName(m.mat) + '×' + m.short).join('、') : '材料够' + (S.ap < 1 ? '，但没有行动力' : '')) + '</div></div>' +
      '<button class="btn sm ' + (can ? 'ok' : '') + '" ' + (can ? '' : 'disabled') + ' onclick="build(\'' + a.key + '\')">建造 (1 AP)</button></div>';
  }).join('');
  h += '</div>';

  /* ── ⑤ 设施（四个分区） ── */
  for(const sec of BASE_SECTIONS){
    const keys = sec.keys.filter(k => BASE_UP[k]);
    if(!keys.length) continue;
    const lvSum = keys.reduce((a, k) => a + (S.base[k] || 0), 0), lvMax = keys.reduce((a, k) => a + BASE_UP[k].max, 0);
    h += '<div class="sect-title">' + sec.icon + ' ' + sec.name + ' <span class="badge">Lv.' + lvSum + ' / ' + lvMax + '</span></div><div class="grid g2">';
    for(const k of keys){
      const u = BASE_UP[k], lv = S.base[k] || 0, maxed = lv >= u.max;
      const cost = maxed ? null : costOf(k);
      const miss = cost ? missingFor(cost, stk(cost)) : [];
      const costTxt = cost ? Object.keys(cost).map(c => '<span class="tag ' + (itemCount(c) >= cost[c] ? 'eq' : '') + '">' + itemName(c) + ' ' + itemCount(c) + '/' + cost[c] + '</span>').join(' ') : '';
      const can = cost && !miss.length && S.ap >= 1;
      h += '<div class="card"><h3>' + u.icon + ' ' + u.n + ' <span class="sub">Lv.' + lv + '/' + u.max + '</span></h3>' +
        '<div class="ds hint" style="min-height:32px">' + u.desc + '</div>' +
        (maxed ? '' : '<div class="hint" style="margin-top:2px;color:#cfd2d6">升级后：<b>' + facilityDelta(k, lv + 1, { powerLv: S.base.power || 0 }) + '</b></div>') +
        '<div class="row" style="margin:8px 0 6px">' + (maxed ? '<span class="tag eq">已满级</span>' : costTxt) + '</div>' +
        '<button class="btn sm block ' + (can ? 'ok' : '') + '" ' + (can ? '' : 'disabled') + ' onclick="build(\'' + k + '\')">' +
        (maxed ? '已完工' : S.ap < 1 ? '没有行动力' : miss.length ? '还差 ' + miss.map(m => itemName(m.mat) + '×' + m.short).join('、') : '建造 / 升级 (1 AP)') + '</button></div>';
    }
    h += '</div>';
  }
  const canAny = Object.keys(BASE_UP).some(k => (S.base[k] || 0) < BASE_UP[k].max && afford(k));
  if(canAny) firstTip('build', '材料够了：据点设施能永久改善生存（净水器/菜园每天产物资，工作台解锁制作）。');
  return h;
}
function scaledCost(k, lv){ return coreScaledCost(BASE_UP[k].cost, lv); }
/** M25：建设价目的一行文字（制作页里告诉玩家"这个站要多少材料才建得起来"） */
function buildCostText(k){
  const u = BASE_UP[k];
  if(!u) return '';
  return Object.keys(u.cost).map(c => itemName(c) + '×' + u.cost[c]).join('、');
}
function build(k){
  const u = BASE_UP[k], lv = S.base[k];
  if(lv >= u.max){ log('❌ 已经满级了。','dim'); return; }
  const cost = scaledCost(k, lv);
  if(!Object.keys(cost).every(c => itemCount(c) >= cost[c])){ log('❌ 材料不足：' + Object.keys(cost).map(c => itemName(c) + '×' + cost[c]).join('、'), 'dim'); return; }
  if(!spendAP(1)) return;
  Object.keys(cost).forEach(c => takeItem(c, cost[c]));
  S.base[k] = lv + 1;
  sfx('ok');
  log('🏠 ' + u.n + ' 升级到 Lv.' + S.base[k] + '。', 'success');
  if(k === 'door' || k === 'wall'){ const before = S.def.doorHp + S.def.wallHp; defInit(); S.def.doorHp = defMax().door; S.def.wallHp = defMax().wall; log('🧱 防线上限与血量随设施一起提升（' + Math.round(before) + ' → ' + (S.def.doorHp + S.def.wallHp) + '）。', 'info'); }
  if(S.base[k] >= u.max) award('a_base');
  if(k === 'radio'){ S.flags.labOpen = true; toast('无线电架设完成','方舟实验室的坐标已标记在探索页。','ok'); log('📻 你截获了一段循环播放的加密通话——方舟实验室，就在市中心地下。','lore'); discoverLore('l_ark'); }
  checkQuest(); checkAch(); render(); autosave();
}

/* ───────────── 技能 ───────────── */
function renderSkills(){
  let h = '<div class="sect-title">生存技能 <span class="badge">行为升级，不用点数</span>' +
    '<span class="badge">' + Object.keys(SKILLS).filter(k => S.skills[k] >= 10).length + ' / ' + Object.keys(SKILLS).length + ' 满级</span></div>' +
    '<div class="hint">用着就涨：搜刮涨生存、开枪涨射击、走路涨体能、进新地方涨侦查……到级自动解锁硬效果（下面列着）。</div>' +
    '<div class="grid g2" style="margin-top:8px">';
  for(const k in SKILLS){
    const s = SKILLS[k], lv = S.skills[k], need = 20 + lv * 26;
    const pct = lv >= 10 ? 100 : clamp(S.xp[k] / need * 100, 0, 100);
    const perks = (s.perks || []).map(p => {
      const ok = lv >= p[0];
      return '<div class="hint" style="color:' + (ok ? '#7fd6a5' : '#767b85') + '">' +
        (ok ? '✅ ' : '🔒 ') + 'Lv.' + p[0] + ' · ' + p[1] + '</div>';
    }).join('');
    h += '<div class="card"><h3>' + s.icon + ' ' + s.n + ' <span class="sub">Lv.' + lv + ' / 10</span></h3>' +
      '<div class="hint" style="min-height:16px">' + s.desc + '</div>' +
      '<div class="hint" style="margin-top:2px;color:#cfd2d6">现在：<b>' + skillNow(k) + '</b></div>' +
      '<div class="bar" style="margin-top:8px"><i class="sta" style="width:' + pct + '%"></i></div>' +
      '<div class="hint" style="margin-top:4px">' + (lv >= 10 ? '已满级' : '经验 ' + S.xp[k] + ' / ' + need + '　·　' + s.src) + '</div>' +
      perks + '</div>';
  }
  h += '</div>';
  return h;
}

/* ───────────── 主线 ───────────── */
const QUEST_STAGES = [
  {n:'在废墟中醒来', d:'去圣玛丽医院看看。那里可能有你需要的药和答案。', hint:'探索 → 圣玛丽医院'},
  {n:'弄到一把枪', d:'第 9 分局的枪柜里也许还有漏网的东西。', hint:'探索 → 第 9 分局'},
  {n:'门禁卡碎片 ×3', d:'方舟实验室的每层门都要生物识别。碎片通常挂在装甲丧尸身上，或压在军方检查站的沙袋下。', hint:'击杀装甲丧尸 / 探索军方检查站'},
  {n:'准备防护装备', d:'实验室里是毒气。你需要防毒面具与防化服，缺一样都可能死在里面。', hint:'地铁三号线（防毒面具）· 军方检查站（防化服）'},
  {n:'架设无线电', d:'定位方舟实验室的入口坐标，需要一台能用的无线电。', hint:'据点 → 无线电（电子元件 ×4）'},
  {n:'深入方舟', d:'坐标已确认。带足弹药和药，下到第 6 层。', hint:'任务页 → 最终决战'},
  {n:'取得解药', d:'你活下来了，而且带回了淡蓝色的那一管东西。', hint:'—'},
];
function questProgress(){
  const q = S.quest;
  if(q.stage === 0) return S.seen.hospital ? '已抵达医院' : '尚未抵达医院';
  if(q.stage === 1) return S.flags.gotGun ? '已取得枪械' : '还没有枪';
  if(q.stage === 2) return '门禁卡碎片 ' + q.keycards + '/3';
  if(q.stage === 3) return '防毒面具 ' + (itemCount('gasmask') || S.eq.mask === 'gasmask' ? '✅' : '❌') + ' · 防化服 ' + (itemCount('hazmat') || S.eq.body === 'hazmat' ? '✅' : '❌');
  if(q.stage === 4) return '无线电 ' + (S.base.radio ? '✅ 已架设' : '❌ 未架设');
  if(q.stage === 5) return '⚔️ 随时可以下实验室';
  return '🏆 已完成';
}
function checkQuest(){
  const q = S.quest;
  let guard = 0;
  while(guard++ < 8){
    let adv = false;
    if(q.stage === 0 && S.seen.hospital) adv = true;
    else if(q.stage === 1 && S.flags.gotGun) adv = true;
    else if(q.stage === 2 && q.keycards >= 3) adv = true;
    else if(q.stage === 3 && (itemCount('gasmask') > 0 || S.eq.mask === 'gasmask') && (itemCount('hazmat') > 0 || S.eq.body === 'hazmat')) adv = true;
    else if(q.stage === 4 && S.base.radio >= 1) adv = true;
    if(!adv) break;
    q.stage++;
    hr();
    log('📋 主线推进：' + QUEST_STAGES[Math.min(q.stage, 6)].n, 'info');
    log('　 ' + QUEST_STAGES[Math.min(q.stage, 6)].d, 'dim');
    toast('📋 主线推进', QUEST_STAGES[Math.min(q.stage, 6)].n, 'ok');
    if(q.stage === 5) log('☣️ 方舟实验室入口就在市中心地铁枢纽下方。带够弹药。', 'danger');
    sfx('ok');
  }
}
function renderQuest(){
  const stage = Math.min(S.quest.stage, 6), s = QUEST_STAGES[stage];
  /* M13：任务页 = 大故事（章节）+ 委托（接单板）+ 支线 + 秘闻。
     前两块由 v4 渲染（src/v4/quests.ts），legacy 只负责把它们插进来。 */
  let h = window.__v4StoryHtml ? window.__v4StoryHtml() : '';
  h += window.__v4ContractsHtml ? window.__v4ContractsHtml() : '';
  h += window.__v4EndingsHtml ? window.__v4EndingsHtml() : '';
  h += '<div class="sect-title">主线 · 寻找解药</div>';
  h += '<div class="card"><h3>' + s.n + ' <span class="sub">阶段 ' + (stage + 1) + '/7</span></h3>' +
    '<p style="font-size:13px;line-height:1.7">' + s.d + '</p>' +
    '<div class="hint" style="margin-top:6px">📍 ' + s.hint + '</div>' +
    '<div class="row" style="margin-top:10px">' + QUEST_STAGES.map((x, i) =>
      '<span class="tag ' + (i <= stage ? 'eq' : '') + '">' + (i < stage ? '✓ ' : '') + (i + 1) + '</span>').join('') + '</div>' +
    '<div class="hint" style="margin-top:8px">进度：' + questProgress() + '</div>' +
    (stage === 5 ? '<div class="row" style="margin-top:12px"><button class="btn primary" onclick="startFinalBattle()">⚔️ 下到第 6 层（最终决战）</button></div>' : '') +
    (S.flags.won ? '<div class="row" style="margin-top:12px"><span class="tag eq">✅ 已通关 · 解药在手</span><span class="tag eq">无尽模式进行中（第 ' + S.day + ' 天）</span></div>' : '') +
    '</div>';
  const done = S.lore.length;
  h += renderSideQuests();
  h += '<div class="sect-title">已收集秘闻 <span class="badge">' + done + ' / ' + LORE.length + '</span></div>';
  h += '<div class="row">' + LORE.map(l => '<span class="tag ' + (S.lore.includes(l.id) ? 'key' : '') + '">' + (S.lore.includes(l.id) ? l.n : '???') + '</span>').join('') + '</div>';
  return h;
}
/* ═══════════════════════════════════════════════════════════════
   v3.0 世界层：地图与路程 / 100 天日历 / 基地防线 / 伤口 / 腐坏 / 尸群迁徙
   设计目标：把"点菜单搜刮"变成"要不要出门、天黑前回不回得来、七天后拿什么挡血月"
   ═══════════════════════════════════════════════════════════════ */
const GOAL_DAY = 100;                       // 活到第 100 天 = 救援结局（实验室主线仍可提前通关）
const MAP = {                               // x/y 为百分比坐标，d 为路程等级
  base:     { n:'安全屋',      x:48, y:70, d:0, icon:'🏠' },
  market:   { n:'惠民超市',    x:38, y:52, d:1, icon:'🛒' },
  oldtown:  { n:'老城区',      x:24, y:60, d:2, icon:'🏚️' },
  hospital: { n:'圣玛丽医院',  x:32, y:26, d:2, icon:'🏥' },
  police:   { n:'第 9 分局',   x:62, y:22, d:3, icon:'🚓' },
  gas:      { n:'城西加油站',  x:74, y:56, d:3, icon:'⛽' },
  subway:   { n:'地铁三号线',  x:54, y:42, d:3, icon:'🚇' },
  military: { n:'军方检查站',  x:82, y:14, d:5, icon:'🪖' },
  lab:      { n:'方舟实验室',  x:50, y:6,  d:6, icon:'☣️' },
};
// 生鲜与医疗用品（v3.0 腐坏/伤口系统的载体）
Object.assign(ITEMS, {
  veg:   {n:'新鲜蔬菜', t:'food',  w:0.4, hun:18, fresh:4, desc:'菜园刚摘的。四天内不吃就会烂。'},
  stew:  {n:'炖菜',     t:'food',  w:0.8, hun:46, heal:6, desc:'蔬菜加水炖一锅——末日里最像"家"的东西。'},
  rot:   {n:'腐坏食物', t:'food',  w:0.4, hun:8, sick:.35, desc:'饿极了也能吃，只是大概会吐一整晚。'},
  splint:{n:'夹板',     t:'med',   w:0.6, heal:5, cureWound:'fracture', desc:'两块木板加布条：骨折急救用——能走但走不快，要复位还得动手术（M31 人体页）。'},
  // M6：农业 / 采集 / 加工的新物品
  seed_veg:  {n:'蔬菜种子', t:'mat',  w:0.05, desc:'播在菜园地块上：快熟低产（5 天 / 每块 2 份）。'},
  seed_grain:{n:'麦种',     t:'mat',  w:0.05, desc:'慢熟高产：9 天 / 每块 5 份，冬天存粮靠它。'},
  berry:     {n:'野果',     t:'food', w:0.1, hun:12, fresh:3, desc:'林子里摘的，酸甜，放不久。'},
  /* M25：生肉/熟肉（灶台那一站的原料与成品） */
  meat:      {n:'生肉',     t:'food', w:0.6, hun:16, sick:.22, fresh:2, desc:'变异猎犬身上割下来的。生吃会出事，架火烤过就是好东西。'},
  cooked:    {n:'烤肉',     t:'food', w:0.5, hun:38, heal:3, desc:'灶台出品。焦香味能把整栋楼的死人都叫醒。'},
  mushroom:  {n:'蘑菇',     t:'food', w:0.1, hun:10, sick:.08, desc:'认不准就别生吃。'},
  grain:     {n:'麦子',     t:'food', w:0.3, hun:8, desc:'生麦子难啃，磨成粉才好用。'},
  dried:     {n:'果干',     t:'food', w:0.1, hun:20, sta:4, desc:'烤干之后能放很久的甜味。'},
  pickle:    {n:'腌菜',     t:'food', w:0.3, hun:24, desc:'盐和醋救回来的蔬菜，冬天最耐放。'},
  // M7：水体互动（钓鱼 / 下水 / 水下探索 / 鱼塘）
  fish:      {n:'鱼',       t:'food', w:0.5, hun:25, fresh:2, desc:'刚从水里捞上来的，两天内得处理掉。'},
  fish_cooked:{n:'烤鱼',    t:'food', w:0.4, hun:42, heal:4, desc:'火上一烤，腥味变成了香味。'},
  rod:       {n:'鱼竿',     t:'mat',  w:1.0, desc:'自制竿子：钓鱼命中 +25%，上钩还能多钓一条。'},
  bait:      {n:'鱼饵',     t:'mat',  w:0.1, desc:'钓鱼命中 +20%，每次消耗一份；也能投喂鱼塘。'},
  wetsuit:   {n:'潜水服',   t:'gear', w:2.0, slot:'body', armor:1, radProt:.1, desc:'又湿又冷但保暖：下水不抽筋，水下搜索的保命装备。'},
  o2:        {n:'氧气瓶',   t:'mat',  w:1.2, desc:'一瓶能支撑 3 次水下搜索；没有它只能憋一口气。'},
  purify:    {n:'净化片',   t:'med',  w:0.05, desc:'一片能净一升水：丢进污水里等一会儿就能喝，不用生火。'},   // M7.1：取水闭环
});
RECIPES.push(
  {out:'splint', n:1, need:{wood:2, cloth:1},         bench:0, desc:'固定骨折用的简易夹板。'},
  {out:'stew',   n:1, need:{veg:2, water:1, wood:1},  bench:0, desc:'把蔬菜炖熟：更顶饱，也不会吃坏肚子。'},
  // M6/F04：加工延长保质期（果干与腌菜不会烂）
  {out:'dried',  n:2, need:{berry:3, wood:1},         bench:0, desc:'把野果摊在火边烤干：能放很久。'},
  {out:'pickle', n:2, need:{veg:2, chem:1},           bench:0, desc:'腌起来的菜不会烂，冬天救命。'},
  // M7：水体系（鱼竿 / 鱼饵 / 烤鱼）
  {out:'rod',        n:1, need:{wood:2, cloth:1, tape:1}, bench:0, desc:'削一根竿，绑上布条当线。'},
  {out:'bait',       n:2, need:{rot:1, cloth:1},          bench:0, desc:'拿腐坏的东西搓成饵——鱼不挑。'},
  {out:'fish_cooked',n:1, need:{fish:1, wood:1},          bench:0, desc:'把鱼串起来烤，腥味变香味。'},
  // M7.1：水（净化片法不用生火；煮沸法保留，耗燃料但不要药片）
  {out:'water',      n:1, need:{dirty:1, purify:1},        bench:0, desc:'净化片丢进污水，半小时后就能喝。'},
  {out:'purify',     n:2, need:{chem:1, cloth:1},          bench:1, desc:'化工原料压成的净水片，一片一升。'},
);
/* M25：M24 及更早的配方写在**两处**（顶部字面量 + 这里的 push），字段名还是老的 `bench`
   （工作台等级），既没有 st 也没有 lv —— 漏掉归一化的话 `lv >= undefined` 恒为 false，
   那些配方会变成"永远做不了"，界面上还会显示 Lv.undefined（实测就是这样）。
   所以必须**两处都归一遍**，不能只写在顶部那个字面量后面。 */
function normalizeRecipes(){
  for(const r of RECIPES){
    if(typeof r.lv !== 'number') r.lv = typeof r.bench === 'number' ? r.bench : 0;
    if(!r.st) r.st = 'bench';
    if(r.desc === undefined) r.desc = '';
  }
}
normalizeRecipes();
const WOUND_DEF = {
  bleed:    { n:'流血',  icon:'🩸', cure:'bandage' },
  fracture: { n:'骨折',  icon:'🦴', cure:'splint'  },
  sick:     { n:'发烧',  icon:'🤒', cure:'anti'    },
};
/* ── 日历：每 7 天一次血月，第 14 天断水断电，第 100 天救援 ── */
function daysToHorde(){ const m = S.day % 7; return m === 0 ? 0 : 7 - m; }
function nextEventText(){
  /* M51：删掉了「通关就返回『本局已通关』」那条旧分支 —— 那是旧版的一件残留：
     通关后 HUD/旧地图卡上会挂一条「📅 本局已通关」。现在通关直接进无尽，这里按血月/断电/尸群照常报。 */
  const dh = daysToHorde();
  if(dh === 0) return '今晚血月';
  if(S.cal.powerOff === false && S.day < 14 && 14 - S.day <= 2) return (14 - S.day) + ' 天后断水断电';
  if(S.horde.eta > 0) return '尸群 ' + S.horde.eta + ' 天后抵达';
  if(dh <= 2) return '血月还有 ' + dh + ' 天';
  return '血月还有 ' + dh + ' 天';
}
function threatLevel(){                     // HUD 用：当前压力等级
  if(S.horde.eta === 1 || daysToHorde() === 0) return 3;
  if(S.horde.eta > 0 || daysToHorde() <= 2 || S.wounds.length) return 2;
  return 1;
}
/* ── 位置与路程：出门要花行动力，夜里在外更危险 ── */
function travelCost(id){
  const A = MAP[S.loc] || MAP.base, B = MAP[id];
  if(!B || S.loc === id) return 0;
  // 对称路程：两头等级取平均 —— 出门和回家一样贵（PZ 式的取舍：今天还回不回得去）
  let c = Math.max(1, Math.round(((A.d || 0) + (B.d || 0)) / 2));
  if(hasWound('fracture')) c += 1;           // 骨折：走不快
  /* M31：腿伤/骨折（人体系统）也要让路变长 —— 与上面那条老伤口并存，取更大者不叠加 */
  const bm = (typeof window.V4Medical === 'object' && window.V4Medical) ? window.V4Medical : null;
  if(bm) c += bm.travelExtra();
  return c;
}
function travelTo(id, silent){
  if(S.over || !MAP[id]) return false;
  if(S.loc === id) return true;
  const cost = travelCost(id);
  if(cost > 0 && !spendAP(cost)){ log('❌ 行动力不够走过去（需要 ' + cost + ' 点）。', 'dim'); return false; }
  tickVitals(.6 * Math.max(1, cost));
  S.loc = id;
  if(!silent) log('🚶 你穿过废墟抵达 ' + MAP[id].n + '（' + cost + ' 行动力，' + (phaseName()[1] === 'night' ? '夜色里每一步都可能踩到东西' : '路上还算安静') + '）。', 'narrative');
  // 路上遭遇：路程越远、天越黑，撞上的概率越高（这是"出门"的真实代价）
  const night = phaseName()[1] === 'night';
  const p = .12 + (MAP[id].d || 0) * .045 + (night ? .16 : 0);
  if(id !== 'base' && chance(p)){
    log('💀 路上撞上了游荡的尸群！', 'danger');
    encounterRoll(id, false, true);
  }
  autosave();
  return true;
}
/* M51：goHome() 随旧版「城市地图」卡一起删除（它只服务于那张卡上的「🏠 返回安全屋」按钮）。 */
/* ── 基地防线：门与围墙都有血，尸潮靠打穿它们进来 ── */
function defMax(){ return defMaxOf(S.base.door || 0, S.base.wall || 0); }   // M54：算式搬到 v4/base-core（唯一真值）
function defInit(){ const m = defMax(); if(!S.def.doorHp || S.def.doorHp > m.door) S.def.doorHp = m.door; if(S.def.wallHp > m.wall) S.def.wallHp = m.wall; }
function repairDefense(){
  const m = defMax();
  if(S.def.doorHp >= m.door && S.def.wallHp >= m.wall){ log('防线是完好的。', 'dim'); return; }
  if(!has('metal', 2) || !has('wood', 2)){ log('❌ 抢修需要铁片 ×2 与木料 ×2。', 'dim'); return; }
  if(!spendAP(1)) return;
  takeItem('metal', 2); takeItem('wood', 2);
  S.def.doorHp = m.door; S.def.wallHp = Math.min(m.wall, S.def.wallHp + 30);
  sfx('ok'); log('🔨 你把门窗钉回去、围墙补上（门 ' + S.def.doorHp + ' / 墙 ' + S.def.wallHp + '）。', 'success');
  render(); autosave();
}
const TRAPS = {
  spike: { n:'钉刺陷阱', icon:'🔺', cost:{metal:3, wood:2},        desc:'每一波开始撕咬最近的一只（-22 生命），一次性。'},
  fire:  { n:'燃烧陷阱', icon:'🔥', cost:{fuel:2, cloth:2, wood:1}, desc:'尸潮进门时全體 -26 生命，一次性。'},
  alarm: { n:'警报器',   icon:'📡', cost:{chip:2, metal:1},        desc:'尸潮提前暴露：开场所有敌人 -20% 生命。'},
};
function buildTrap(id){
  const t = TRAPS[id]; if(!t) return;
  if(S.def.traps[id] >= (id === 'alarm' ? 1 : 9)){ log('❌ ' + t.n + ' 已经够了。', 'dim'); return; }
  if(!Object.keys(t.cost).every(k => itemCount(k) >= t.cost[k])){
    log('❌ 材料不足：' + Object.keys(t.cost).map(k => itemName(k) + '×' + t.cost[k]).join('、'), 'dim'); return;
  }
  if(!spendAP(1)) return;
  Object.keys(t.cost).forEach(k => takeItem(k, t.cost[k]));
  S.def.traps[id]++;
  sfx('ok'); log('🧱 布置了 ' + t.n + '（现有 ' + S.def.traps[id] + '）。', 'success');
  render(); autosave();
}
/* ── 伤口：持续掉血 / 走不快 / 体力上限被压 ── */
function hasWound(t){ return (S.wounds || []).some(w => w.t === t); }
function addWound(t, sev){
  if(!WOUND_DEF[t] || hasWound(t)) return false;
  if(S.wounds.length >= 4) return false;
  S.wounds.push({ t:t, sev: sev || 1, left: t === 'fracture' ? 6 : (t === 'sick' ? 3 : 99) });
  log(WOUND_DEF[t].icon + ' 你受了伤：' + WOUND_DEF[t].n + '（' + (t === 'bleed' ? '不止血会一直掉血，用绷带' : (t === 'fracture' ? '走路变慢、逃跑变难，用夹板' : '体力上限下降，用抗生素或好好休息')) + '）', 'danger');
  toast(WOUND_DEF[t].icon + ' ' + WOUND_DEF[t].n, '记得处理：' + (t === 'bleed' ? '绷带' : (t === 'fracture' ? '夹板' : '抗生素')), 'bad');
  return true;
}
function cureWound(t){
  const i = (S.wounds || []).findIndex(w => w.t === t);
  if(i < 0) return false;
  S.wounds.splice(i, 1);
  log(WOUND_DEF[t].icon + ' ' + WOUND_DEF[t].n + ' 处理好了。', 'success');
  return true;
}
function woundTick(){                        // 每次睡眠结算：掉血 / 自愈 / 恶化
  if(!S.wounds.length) return;
  S.wounds.slice().forEach(w => {
    if(w.t === 'bleed'){
      const d = 4 + w.sev * 3;
      S.hp -= d;
      log('🩸 伤口一夜没止住，失血 ' + d + ' 点。', 'danger');
    } else if(w.left > 0){
      w.left--;
      if(w.left === 0 && (S.hun > 40 && S.thi > 40 || w.t === 'sick' && S.skills.medic >= 4)){
        cureWound(w.t);
      } else if(w.left === 0){
        w.left = 2; log(WOUND_DEF[w.t].icon + ' ' + WOUND_DEF[w.t].n + ' 还没好——你需要吃饱、喝够、或者用药。', 'dim');
      }
    }
  });
}
/* ── 食物腐坏 / 断水断电 ── */
function spoilTick(){
  const keys = Object.keys(S.spoil);
  keys.forEach(id => {
    S.spoil[id]--;
    if(S.spoil[id] <= 0){
      const n = itemCount(id);
      delete S.spoil[id];
      if(n > 0){ takeItem(id, n); addItem('rot', n, true); log('🦠 ' + itemName(id) + ' ×' + n + ' 烂了，变成腐坏食物。', 'danger'); }
    }
  });
  ['veg'].forEach(id => { if(itemCount(id) > 0 && S.spoil[id] === undefined) S.spoil[id] = ITEMS[id].fresh || 4; });
}
function powerOff(){ return S.cal.powerOff; }
/* ── 尸群迁徙：噪音与枪声会把一群东西引过来（3 天后到） ── */
function raiseHorde(size, why){
  if(S.horde.eta > 0) return;
  S.horde = { eta: 3, size: Math.max(3, size || (4 + Math.floor(S.day / 5))) };
  log('📡 ' + why + '——有东西成群结队地朝这边来了。预计 ' + S.horde.eta + ' 天后抵达。', 'danger');
  toast('⚠️ 尸群迁徙', '约 ' + S.horde.eta + ' 天后抵达基地（规模 ' + S.horde.size + '）', 'bad');
}
/* ── 日历面板 ── */
/* M51：旧版「城市地图」整块删除（renderMap / mapClick / goHome 一起走）。
   它在 M17 就被 v4 的大世界地图取代了，唯一还能露脸的机会是"本局已结束"时的旧版回退窗口 ——
   而那正是用户报障的那一屏（旧地图卡 +「📅 本局已通关」图例 + 「已在安全屋」）。 */
function renderCalendar(){
  let h = '<div class="sect-title">日历 · 第 ' + S.day + ' / ' + GOAL_DAY + ' 天</div><div class="card" style="margin-bottom:12px">';
  h += '<div class="row">' +
    '<span class="chip ' + (daysToHorde() === 0 ? 'heavy warnpulse' : '') + '">🩸 血月 <b>' + (daysToHorde() === 0 ? '今晚' : daysToHorde() + ' 天后') + '</b></span>' +
    '<span class="chip ' + (S.cal.powerOff ? 'heavy' : '') + '">🔌 电网 <b>' + (S.cal.powerOff ? '已断' : '第 14 天断') + '</b></span>' +
    (S.horde.eta > 0 ? '<span class="chip heavy warnpulse">🧟 尸群 <b>' + S.horde.eta + ' 天后抵达</b></span>' : '<span class="chip">🧟 尸群 <b>暂无</b></span>') +
    (S.flags.endless ? '<span class="chip gold">' + endGoalChip(true, GOAL_DAY) + '</span>' : '<span class="chip gold">' + endGoalChip(false, GOAL_DAY) + '</span>') +
  '</div>';
  h += '<div class="hint" style="margin-top:6px">每 7 天一次<b>血月</b>（规模 ×1.9，提前两天预告）；第 14 天<b>断水断电</b>（净水器要烧汽油、蔬菜会烂）；第 100 天救援。<br>开枪、深度搜索与尸潮都会累积<b>噪音</b>——噪音高了会把<b>迁徙尸群</b>引来（3 天后抵达基地）。</div></div>';
  return h;
}
/* 噪音的世界级后果：不是只影响今晚的概率，而是会招来一支会走路的尸群 */
function noiseCheck(){
  if(S.noise >= 6 && S.horde.eta === 0 && chance(.4)) raiseHorde(0, '枪声与骚动在废墟里传出去很远');
}
function runScore(){
  const days = S.day, kills = S.stats.kills, zones = Object.keys(S.seen).length;
  const raw = days * 10 + kills * 2 + zones * 15 + baseLevel() * 4 + S.lore.length * 6 + (S.flags.won ? 300 : 0);
  const rank = raw >= 1400 ? 'S · 传说' : raw >= 1000 ? 'A · 老手' : raw >= 700 ? 'B · 幸存者' : raw >= 400 ? 'C · 勉强活着' : 'D · 新肉';
  return { raw: raw, rank: rank, days: days, kills: kills, zones: zones };
}

/* ═══════════════════════════════════════════════
   v2.2 系统：C17 悬赏板 / C16 精英词条 / C21 支线 / C22 改装与限购
   ═══════════════════════════════════════════════ */
/* ── C17 → M13：委托板改成「接单制」，逻辑搬去了 src/v4/contracts-core.ts + quests.ts
   旧版（C17）：每晚刷 3 张、做完自动"点一下领奖"、没有接单概念、赏金受当日预算封顶。
   新版（M13）：接单（最多 3 张同时挂）+ 期限（过期作废）+ 进度从接单那刻起算（防"早就搜过所以秒完成"）
              + 跨区委托（目标在别的区域 → 没车就只能看着，接上 M12 的区域门槛）
              + 大故事（6 章，从余烬推到江北/滨海/南港）。
   下面这几个 legacy 函数只留**桥**：老调用点（睡觉换日 / 击杀 / 搜刮 / 探索页渲染）一行都不用改。 */
function bountyBudget(){ return 9 + Math.floor(S.day / 2); }   // 旧算式：新系统见 contracts-core.bountyBudget（20 + 2·day）
function bountyDef(id){
  if(id.indexOf('q_') === 0){ const st = +id.slice(2); return QUEST_BOUNTIES[Math.min(st, QUEST_BOUNTIES.length - 1)]; }
  return BOUNTY_POOL.find(p => p.id === id);
}
function metricValue(metric){
  const st = S.stats || {};   // 保险：残缺 stats（外部导入/旧档）只让这一条读不到，不该让整屏渲染崩掉
  if(!metric) return 0;
  if(metric.indexOf('zone:') === 0) return (st.zoneCnt || {})[metric.slice(5)] || 0;
  if(metric.indexOf('killBy:') === 0) return (st.killBy || {})[metric.slice(7)] || 0;
  return st[metric] || 0;
}
function rollBounties(){ if(window.__v4QuestNewDay) window.__v4QuestNewDay(); }
function bountyTick(){ if(window.__v4QuestTick) window.__v4QuestTick(); }
function claimBounty(){ /* M13：旧的"点一下领奖"没了，改成接单 → 自动结算（见 src/v4/quests.ts） */ }
function renderBounties(){ return window.__v4QuestTeaser ? window.__v4QuestTeaser() : ''; }
/* ── C16 精英词条（封顶：单只 ≤1.5x 生命；每日 ≤1 只；不碰原始伤害） ── */
function affixRoll(){
  if(S.day < 3) return null;
  if(S.eliteToday >= 1) return null;
  if(!chance(0.05 + Math.min(0.10, S.day * 0.004))) return null;
  return wpick({ corrupt:3, swift:2, burst:2, armored:3, parasitic:2 });
}
function applyAffix(foe, id){
  const a = AFFIX[id]; if(!a) return foe;
  foe.affix = id; foe.elite = true;
  foe.n = a.n + '·' + foe.n;
  if(a.hp){ foe.hpMax = Math.round(foe.hpMax * Math.min(1.5, 1 + a.hp)); foe.hp = foe.hpMax; }
  if(a.spd) foe.spd = Math.max(foe.spd, a.spd);
  if(a.armGun) foe.t = Object.assign({}, foe.t, { armGun:a.armGun, armMelee:a.armMelee || foe.t.armMelee });
  if(a.bite) foe.t = Object.assign({}, foe.t, { bite:a.bite });
  if(a.burst) foe.t = Object.assign({}, foe.t, { burst:true });
  foe.xp = Math.round((foe.xp || 5) * 2);
  S.eliteToday++;
  return foe;
}
/* ── C21 同伴支线 ── */
function sideActive(c){ return S.comp === c && (S.side[c] || 0) < SIDE_QUESTS[c].steps.length; }
function sideTick(){
  for(const c in SIDE_QUESTS){
    if(!sideActive(c)) continue;
    const q = SIDE_QUESTS[c], idx = S.side[c], st = q.steps[idx];
    if(st.type === 'items') continue;                      // 交物资的步骤由玩家在任务页点交付
    if(st.cond === 'infect40') continue;                   // 条件步在 sleepNight 里判定
    const key = c + ':' + idx;
    if(S.sideBase[key] === undefined) S.sideBase[key] = metricValue(st.metric);
    if(metricValue(st.metric) - S.sideBase[key] >= st.need) sideAdvance(c);
  }
}
function sideAdvance(c){
  const q = SIDE_QUESTS[c], idx = S.side[c], st = q.steps[idx];
  if(!st) return false;
  if(st.type === 'items'){
    if(!Object.keys(st.need).every(k => itemCount(k) >= st.need[k])){ log('❌ 还差材料：' + Object.keys(st.need).map(k => itemName(k) + '×' + st.need[k]).join('、'), 'dim'); return false; }
    Object.keys(st.need).forEach(k => takeItem(k, st.need[k]));
  }
  delete S.sideBase[c + ':' + idx];
  S.side[c] = idx + 1;
  log('📜 支线推进：' + q.n + ' —— ' + st.t + '（已完成）', 'info');
  sfx('ok');
  if(S.side[c] >= q.steps.length){
    const r = q.reward;
    if(r.item) grant(r.item, r.n || 1);
    if(r.lore) discoverLore(r.lore);
    for(const k in (r.xp || {})) addXP(k, r.xp[k]);
    award('a_side');
    log('🏅 支线完成：' + q.n + '。你得到了 ' + (ITEMS[r.item] ? ITEMS[r.item].n : '一份回报') + '。', 'success');
    toast('🏅 支线完成', q.n, 'ok');
  }
  checkAch(); render(); autosave();
  return true;
}
function sideNightCheck(){
  for(const c in SIDE_QUESTS){
    if(!sideActive(c)) continue;
    const q = SIDE_QUESTS[c], idx = S.side[c], st = q.steps[idx];
    if(st.cond === 'infect40' && S.infect >= 40) sideAdvance(c);
  }
}
/* ── C22 武器改装 + 商人每日限购 ── */
function modsOf(w){ return (S.mods && S.mods[w]) || []; }
function modSum(w, field){
  let v = 0; modsOf(w).forEach(m => { if(MODS[m] && MODS[m][field]) v += MODS[m][field]; }); return v;
}
function modMul(w, field){
  let v = 1; modsOf(w).forEach(m => { if(MODS[m] && MODS[m][field]) v *= MODS[m][field]; }); return v;
}
function addMod(m){
  const w = S.eq.wpn, def = MODS[m];
  if(!w || !def) return;
  if(S.base.bench < 2){ log('❌ 需要工作台 Lv.2 才能改装。', 'dim'); return; }
  if(modsOf(w).indexOf(m) >= 0){ log('❌ 这把武器已经装了' + def.n + '。', 'dim'); return; }
  if(modsOf(w).length >= 2){ log('❌ 一把武器最多装 2 个改装件。', 'dim'); return; }
  if(!Object.keys(def.cost).every(k => itemCount(k) >= def.cost[k])){
    log('❌ 材料不足：' + Object.keys(def.cost).map(k => itemName(k) + '×' + def.cost[k]).join('、'), 'dim'); return;
  }
  if(!spendAP(1)) return;
  Object.keys(def.cost).forEach(k => takeItem(k, def.cost[k]));
  S.mods[w] = modsOf(w).concat([m]);
  sfx('ok');
  log('🔧 给 ' + ITEMS[w].n + ' 装上 ' + def.n + '（' + def.desc + '）', 'success');
  if(modsOf(w).length >= 2) award('a_mod');
  render(); autosave();
}
function shopLeft(m){ return Math.max(0, (m.stock || 99) - ((S.shop.bought || {})[m.id] || 0)); }
function shopDayCheck(){ if(S.shop.day !== S.day) S.shop = { day:S.day, bought:{} }; }

/* ───────────── 最终决战 ───────────── */

function startFinalBattle(){
  if(S.quest.stage < 5){ log('❌ 你还没有实验室的坐标。','dim'); return; }
  closeAllModals();
  S.flags.usedGunFinal = false;
  S.flags.finalTried = true;      // M15：进过实验室 → 死在这儿算「第六层以下」那个结局
  hr();
  log('☣️ 你撬开地下三层的气密门。方舟实验室的应急灯还亮着，像一口没闭上的眼睛。','danger');
  log('走廊尽头有东西在呼吸——不像人，也不像丧尸。','narrative');
  if(S.eq.mask !== 'gasmask' && !has('gasmask')) log('⚠️ 你没有防毒面具，空气里有股甜腻的味道。','danger');
  startCombat([{ id:'boss_a', n:'实验体 A · 缝合者', hp:150, dmg:22, spd:1.2, xp:60, boss:true,
      t:{ desc:'被拼接过的人形，皮肤下埋着金属支架。', loot:{ chem:.6, serum:.5 }, armGun:.8, loot2:true } }],
    { title:'最终决战 · 第 6 层', sub:'阶段 1 / 2', noFlee:true, final:true, onWin:bossPhase2,
      hint:'它是活的装甲——用消防斧或爆炸物破开它。' });
}
function bossPhase2(){
  log('💀 缝合者跪了下去。可它的胸腔里爬出第二样东西——那东西在“叫”。','danger');
  log('实验体 B · 蜂巢：它不是在攻击你，它在指挥所有还在动的尸体。','combat');
  startCombat([{ id:'boss_b', n:'实验体 B · 蜂巢', hp:190, dmg:26, spd:2, xp:90, boss:true,
      t:{ desc:'它保留着某种程度的智能，靠尖叫支配周围的感染者。', poison:true, summon:.35, loot:{ serum:.8, cure:0 } } }],
    { title:'最终决战 · 第 7 层', sub:'阶段 2 / 2', noFlee:true, final:true, onWin:finalVictory,
      hint:'它一叫，就会有东西从走廊深处走过来——先解决它。' });
}
function finalVictory(){
  S.quest.stage = 6;
  S.flags.won = true; S.flags.cured = true;
  winContinue();                       // M51：通关 = 转入无尽延续（不置 over，界面不回退旧版）
  grant('cure', 1, true); grant('data', 1, true);
  LORE.forEach(l => discoverLore(l.id, true));
  award('a_cure');
  if(!S.flags.usedGunFinal) award('a_naked');
  sfx('win');
  musicSting('win');
  /* M15：多结局——取回解药是"通关"，但具体是哪一个结局由抉择决定（v4 endings） */
  if(window.__v4Ending) window.__v4Ending('won');
  hr();
  log('🏆🏆🏆 解药到手 🏆🏆🏆', 'success');
  log('第 7 层的冷柜里整整齐齐码着四十支淡蓝色的液体。标签上写着一行小字：', 'narrative');
  log('「G.A.M.O.T. 抗病毒血清 · 剂量 1」', 'narrative');
  log('你只拿了一支，把剩下的锁回冷柜——它们不属于你一个人。', 'narrative');
  log('', 'narrative');
  log('走出实验室时，天正在亮。远处有直升机的桨声，也可能是风。', 'narrative');
  log('你把解药举到光里看了看。它像活的一样。', 'narrative');
  log('末日没有结束。但今天，你赢了一次。', 'success');
  log('📊 生存 ' + S.day + ' 天 · 击杀 ' + S.stats.kills + ' · 搜刮 ' + S.stats.scav + ' 次 · 据点 Lv.' + baseLevel(), 'info');
  toast('🏆 通关','你取回了「芥末」病毒的解药。','ok');
  modal({ title:'🏆 通关 · 余烬', sticky:true,
    body:'<p class="muted">你用 <b class="mono">' + S.day + '</b> 天走完了这条线：击杀 <b class="mono">' + S.stats.kills + '</b>，秘闻 <b class="mono">' + S.lore.length + '/' + LORE.length + '</b>，成就 <b class="mono">' + S.ach.length + '/' + ACHIEVEMENTS.length + '</b>。</p>' +
      '<p class="muted" style="margin-top:10px">游戏没有结束：你已经在<b>无尽模式</b>里了——丧尸仍会按天数进化，夜晚尸潮会越来越重，你可以继续把据点建满、把图鉴收全。</p>',
    footer:'<button class="btn warn" data-close>♾️ 继续活下去（无尽）</button>' });
  render();
  autosave();
}
/** M51：通关（取回解药 / 第 100 天救援）= 这一局继续往下走，不是"本局已结束"。
 *  根因见 v4/endless-core.winContinuePatch：以前通关置 S.over=true，而 v4 世界面板/区域移动/
 *  夜间结算全以 over 为总闸 —— 关掉结局弹窗后整屏退化成旧版探索页（旧版「城市地图」+
 *  「本局已通关」图例），要再点一次按钮才回得来。这里当场清 over + 开无尽，界面全程是 v4。 */
function winContinue(){
  const p = winContinuePatch({ over: !!S.over, hp: S.hp, hpMax: S.hpMax, ap: S.ap, apMax: S.apMax, endless: !!S.flags.endless });
  S.over = p.over; S.hp = p.hp; S.ap = p.ap; S.flags.endless = p.endless;
}
function enterEndless(){
  closeAllModals();
  /* M37 的老根因：rescueEnding()/gameOver() 会把 S.over 置 true（那一局"已结束"），
     而 v4 世界面板整块以 over 为总闸（world-ui 的 `if(!S || S.over)`），不清它就会
     "进无尽直接死 + 地图变旧版"。M51 起通关已经改为当场 winContinue()（不再有那个中间态），
     这个函数只剩两个用途：老档救援 + 探针/回归脚本的入口。 */
  const back = resumeFromOver(S);
  if(back.revived) log('💗 你在废墟里又睁开眼——无尽模式不打算这么早收走你（生命恢复到 ' + back.hp + '）。','success');
  S.flags.endless = true;
  award('a_endless');
  log('♾️ 无尽模式开启：它们会一直进化下去。活得越久，越不像人。','system');
  toast('无尽模式','难度随天数继续上升。','bad');
  /* M15：无尽结局（活过第 150 天会换成「活得比城市久」） */
  if(window.__v4Ending) window.__v4Ending('endless');
  S.tab = 'explore'; render(); autosave();
}

/* ═══════════ legacy/40-ui.js ═══════════ */
/* ───────────── 图鉴 ───────────── */
let codexCat = 'zombie';
function renderCodex(){
  /* M50：第 4 类「治疗指南」——原来贴在人体页右下角（用户：「把治疗指南移动到图鉴内」）。
     内容由 v4 渲染（medical-core 的伤情表 + survival-core 的病症表），这里只留一个调用点。 */
  const cats = [['zombie','🧟 丧尸'],['item','📦 物品'],['lore','📜 秘闻'],['guide','📘 治疗指南']];
  let h = '<div class="row" style="margin-bottom:10px">' + cats.map(c =>
    '<button class="btn sm ' + (codexCat === c[0] ? 'warn' : '') + '" onclick="codexCat=\'' + c[0] + '\';render()">' + c[1] + '</button>').join('') + '</div>';
  if(codexCat === 'guide'){
    h += window.__v4GuideHtml ? window.__v4GuideHtml() : '<p class="muted">治疗指南还没装载。</p>';
    return h;
  }
  if(codexCat === 'zombie'){
    h += '<div class="grid g2">';
    for(const k in ZOMBIES){
      const z = ZOMBIES[k], step = Math.floor((S.day - 1) / 5);
      h += '<div class="card"><h3>' + z.n + ' <span class="sub">HP ' + Math.round(z.hp * (1 + step * .22)) + ' · 伤害 ' + Math.round(z.dmg * (1 + step * .14)) + ' · 速度 ' + z.spd + '</span></h3>' +
        '<div class="hint">' + z.desc + '</div>' +
        '<div class="row" style="margin-top:8px">' +
        (z.armGun ? '<span class="tag">抗弹 ' + Math.round((1 - z.armGun) * 100) + '%</span>' : '') +
        (z.poison ? '<span class="tag">毒雾（需面具）</span>' : '') +
        (z.bleed ? '<span class="tag">撕裂缝流血</span>' : '') +
        (z.summon ? '<span class="tag">尖叫召唤</span>' : '') +
        (z.keycard ? '<span class="tag key">掉落门禁卡碎片</span>' : '') +
        '<span class="tag mat">经验 ' + z.xp + '</span></div></div>';
    }
    h += '</div>';
  } else if(codexCat === 'item'){
    h += '<div class="grid g2">';
    for(const k in ITEMS){
      const it = ITEMS[k];
      const known = itemCount(k) > 0 || S.store[k] || S.eq.wpn === k || Object.keys(S.eq).some(s => S.eq[s] === k) || S.seen[k];
      h += '<div class="card"><h3>' + it.n + ' <span class="sub">' + TYPE_LABEL[it.t] + ' · ' + it.w + 'kg</span></h3>' +
        '<div class="hint">' + (known ? it.desc : '尚未见过这件物品。') + '</div>' +
        '<div class="row" style="margin-top:8px">' +
        (it.dmg ? '<span class="tag wpn">伤害 ' + it.dmg + '</span>' : '') +
        (it.ammo ? '<span class="tag">弹药 ' + it.ammo + '/次</span>' : '') +
        (it.sta && !it.ammo ? '<span class="tag">体力 ' + it.sta + '/次</span>' : '') +
        (it.armor ? '<span class="tag gear">护甲 +' + it.armor + '</span>' : '') +
        (it.heal ? '<span class="tag med">治疗 ' + it.heal + '</span>' : '') +
        (it.hun ? '<span class="tag med">饱食 +' + it.hun + '</span>' : '') +
        (it.thi ? '<span class="tag mat">水分 +' + it.thi + '</span>' : '') +
        (it.infect ? '<span class="tag ' + (it.infect < 0 ? 'eq' : '') + '">感染 ' + it.infect + '</span>' : '') +
        '</div></div>';
    }
    h += '</div>';
  } else {
    const got = S.lore.length;
    h += '<p class="muted" style="margin-bottom:10px">已收录 <b class="mono">' + got + '/' + LORE.length + '</b> 条。秘闻来自搜刮、击杀、区域首访与主线推进。</p><div class="grid g2">';
    LORE.forEach(l => {
      const un = S.lore.indexOf(l.id) >= 0;
      h += '<div class="card"><h3>' + (un ? '📜 ' + l.n : '❓ 未解锁') + '</h3>' +
        '<div class="hint" style="white-space:pre-wrap;font-size:12px;max-height:220px;overflow:auto">' +
        (un ? esc(l.story).replace(/\n/g, '<br>') : '继续探索末日世界，这条记录还没有被找到。') + '</div></div>';
    });
    h += '</div>';
  }
  return h;
}
function discoverLore(id, silent){
  if(!LORE.some(l => l.id === id)) return false;
  if(S.lore.indexOf(id) >= 0) return false;
  S.lore.push(id);
  if(!silent){
    const l = LORE.find(x => x.id === id);
    log('📖 秘闻收录：' + l.n, 'lore');
    toast('📖 秘闻 · ' + l.n, '已收录到图鉴。', 'lore');
  }
  if(S.lore.length >= 8) award('a_lore');
  return true;
}

/* ───────────── 统计 / 成就 ───────────── */
function renderStats(){
  const st = S.stats;
  let h = '<div class="sect-title">生存记录</div><div class="grid g3">';
  const rows = [['生存天数', S.day], ['击杀总数', st.kills], ['近战击杀', st.meleeKills], ['搜刮次数', st.scav],
    ['制作次数', st.crafted], ['撑过尸潮', st.hordes], ['过夜次数', st.nights], ['累计输出伤害', st.dmgDealt],
    ['累计承受伤害', st.dmgTaken], ['秘闻收集', S.lore.length + '/' + LORE.length], ['据点等级', baseLevel()],
    ['濒死救援', S.flags.rescueUsed ? '已用' : '未用'], ['当前噪音', S.noise],
    ['活到第几天', S.day + ' / ' + GOAL_DAY], ['评分', runScore().raw + ' · ' + runScore().rank],
    ['身上伤口', S.wounds.length ? S.wounds.map(w => WOUND_DEF[w.t].n).join('、') : '无'],
    ['当前位置', (MAP[S.loc] || MAP.base).n]];
  rows.forEach(r => { h += '<div class="card" style="padding:10px"><div class="hint">' + r[0] + '</div><div class="mono" style="font-size:20px;color:var(--bone)">' + r[1] + '</div></div>'; });
  h += '</div>';
  h += '<div class="sect-title">成就 <span class="badge">' + S.ach.length + '/' + ACHIEVEMENTS.length + '</span></div><div class="grid g2">';
  ACHIEVEMENTS.forEach(a => {
    const un = S.ach.indexOf(a.id) >= 0;
    h += '<div class="card" style="padding:10px;' + (un ? 'border-color:#3a5c48' : 'opacity:.55') + '">' +
      '<div class="row"><span class="nm">' + (un ? '🏆 ' : '🔒 ') + a.n + '</span></div><div class="hint" style="margin-top:4px">' + a.d + '</div></div>';
  });
  h += '</div>';
  h += '<div class="sect-title">存档</div><div class="row">' +
    '<button class="btn" onclick="saveGame()">💾 保存</button>' +
    '<button class="btn" onclick="loadGame()">📂 读取</button>' +
    '<button class="btn" onclick="restoreBackup()">🛟 回滚到上次备份</button>' +
    '<button class="btn danger" onclick="restart()">🔄 新游戏（清空进度）</button></div>' +
    '<div class="hint" style="margin-top:6px">M29 起存档<b>全部加密落在本机</b>（AES-GCM-256，密钥只存在 worker 里、不可导出），' +
    '不再提供"导出明文存档"；换设备或想多端同步请用 <b>☰ 菜单 → 世界与账号 → 云存档</b>（上传的也是密文）。</div>';
  return h;
}
function checkAch(){
  const st = S.stats;
  if(st.scav >= 1) award('a_first');
  if(st.kills >= 25) award('a_hunter');
  if(st.kills >= 100) award('a_slayer');
  if(st.meleeKills >= 20) award('a_quiet');
  if(st.crafted >= 10) award('a_craft');
  if(st.scav >= 40) award('a_scav');
}

/* ───────────── 商人 ───────────── */
function merchantRate(){
  /* C09 浮动汇率：活得越久物价越高，堵住后期材料单调爆炸。
     M24：交易技能把它压下来（Lv3 起再 -10%） */
  const trade = Math.min(.45, (S.skills.trade || 0) * .04 + (hasPerk('trade', 3) ? .10 : 0));
  return (1 + S.day * .02) * (1 - trade);
}
/* ── M44：收购（用户：「可以让用户将自己的多余物品出售给商人（收购价格比购买价格更低）」）──
   买卖做成同一个弹窗的两个页签。回收价、能卖什么、批量怎么算全在 shop-core（纯逻辑、有单测），
   这里只负责画出来 + 成交后刷新。三条已确认口径：回收价 = 买价 45% ／ 除剧情与身上装备外什么都能卖 ／
   批量出售必须二次确认（材料不可逆）。 */
let merchantTab = 'buy';
function setMerchantTab(t){
  const next = t === 'sell' ? 'sell' : 'buy';
  if(next === merchantTab) return;
  merchantTab = next;
  closeAllModals(); openMerchant();      // 换页签 = 换页：回顶部（和主区域一个口径）
}
/** 身上穿的、手里拿的一律不卖（卖掉武器再打起来会很难看）——判据与营地那套一致 */
function merchantEquipped(){ return Object.keys(S.eq).map(k => S.eq[k]).filter(Boolean); }
/** 当前"卖"页签下能看到的物品（跟随背包那一套筛选条，和批量存入同一个口径） */
function sellPool(){
  const equipped = merchantEquipped();
  const all = Object.keys(S.inv).filter(k => S.inv[k] > 0 && !!ITEMS[k] && canSell(k, ITEMS, equipped));
  all.sort((a, b) => (ITEMS[a].t + a).localeCompare(ITEMS[b].t + b));
  return filterInv(all, ITEMS, bagFilter);
}
/** 成交后重开弹窗：记住弹窗自己的滚动位置（.modal 就是滚动容器），别把玩家甩回顶部 */
function refreshMerchant(){
  const box = () => document.querySelector('#overlay-root .modal');
  const top = (box() || {}).scrollTop || 0;
  closeAllModals(); openMerchant(); render();
  const back = () => { const m = box(); if(m) m.scrollTop = top; };
  back(); try{ requestAnimationFrame(back); }catch(_){}
}
/** 一单成交的**唯一**入口：校验全过 sellPlan，UI 与批量都走它。
 *  rate 由调用方给（批量出售要**锁定确认框上的那个汇率**），缺省才是"当下汇率"。 */
function sellItemCore(id, times, rate){
  const r = rate > 0 ? rate : merchantRate();
  const p = sellPlan(id, times, { have: itemCount(id), rate: r, items: ITEMS, equipped: merchantEquipped() });
  if(!p.times) return null;
  if(!takeItem(id, p.times)) return null;        // 兜底：背包对不上账就整笔不成交，别白给材料
  S.mat += p.total;
  addXP('trade', 2 * p.times);                   // M24 承诺的"和商人买卖涨交易技能"：买的那一半在 M32b 补了，这是卖的一半
  return p;
}
function sellMerchant(id, times){
  const p = sellItemCore(id, times);
  if(!p){ log('❌ ' + (sellBlockReason(id, ITEMS, merchantEquipped()) || '背包里没有这件东西。'), 'dim'); return; }
  sfx('ui');
  log('💰 卖掉 ' + itemName(id) + ' ×' + p.times + '，换回 ' + p.total + ' 材料。', 'loot');
  autosave(); refreshMerchant();
}
/** 批量出售：先弹确认框（这一批是什么、几件、换多少），确认了才真卖。
 *  确认框上的报价（含汇率）**存进 pendingSell**：结算时照单执行，绝不按"结算途中的汇率"重算 —— 
 *  批量里每样都会涨交易技能，重算会让"说好 +43、到手 +42"（本地探针当场抓到过一次）。 */
let pendingSell = null;
function sellMerchantCat(){
  const rate = merchantRate();
  const plan = sellBatchPlan(sellPool(), S.inv, { rate, items: ITEMS, equipped: merchantEquipped() });
  if(!plan.items){ log('❌ 这一类里没有能卖的东西。', 'dim'); return; }
  pendingSell = { plan, rate };
  const label = bagFilter === 'all' ? '全部能卖的' : '「' + ((BAG_FILTERS.find(f => f.id === bagFilter) || {}).label || bagFilter) + '」这一类';
  const list = plan.ids.slice(0, 8).map(id => itemName(id) + '×' + (S.inv[id] || 0)).join('、') + (plan.ids.length > 8 ? ' 等' : '');
  modal({ title:'💰 确认出售', sticky:true,
    body:'<p class="muted">这一批是 ' + label + '：<b>' + plan.ids.length + ' 种 · ' + plan.items + ' 件</b>，回收 <b class="mono">+' + plan.total + ' 材料</b>。</p>' +
      '<div class="hint">' + esc(list) + '</div>' +
      '<div class="hint" style="margin-top:8px">卖出去就拿不回来了，回收价只有他卖价的 ' + Math.round(SELL_RATE * 100) + '%。确认要卖吗？</div>',
    footer:'<button class="btn danger" onclick="sellMerchantCatGo()">确认全卖（+' + plan.total + ' 材料）</button>' +
      '<button class="btn" data-close>再想想</button>' });
}
function sellMerchantCatGo(){
  /* 照确认框上的报价单结算（没有单子就临场算一份，等价于"直接用当下汇率"） */
  const quote = pendingSell || { plan: sellBatchPlan(sellPool(), S.inv, { rate: merchantRate(), items: ITEMS, equipped: merchantEquipped() }), rate: merchantRate() };
  pendingSell = null;
  const lines = sellBatchQuote(quote.plan, S.inv);
  if(!lines.length){ closeAllModals(); openMerchant(); return; }
  let gain = 0, kinds = 0, cnt = 0;
  lines.forEach(l => {
    const p = sellItemCore(l.id, l.times, quote.rate);
    if(!p) return;
    gain += p.total; cnt += p.times; kinds++;
  });
  sfx('loot');
  log('💰 一次卖掉 ' + kinds + ' 种 · ' + cnt + ' 件，换回 ' + gain + ' 材料。', 'loot');
  autosave(); refreshMerchant();
}
/** 卖东西那半页：只列"能卖的"，每个物品「卖1」+「全卖×N」，底部是带二次确认的批量出售 */
function sellPanelHtml(rate){
  const all = Object.keys(S.inv).filter(k => S.inv[k] > 0 && !!ITEMS[k]);
  const tabs = filterTabs(all.filter(k => canSell(k, ITEMS, merchantEquipped())), ITEMS);   // 筛选条只按"真的能卖的"计数（剧情 / 身上穿的类不该出现在这里）
  const ids = sellPool();
  const plan = sellBatchPlan(ids, S.inv, { rate, items: ITEMS, equipped: merchantEquipped() });
  let h = '<p class="muted" style="margin-bottom:10px">"多出来的东西我也收——按行价给你，别指望我按卖价收。"</p>';
  h += '<div class="row" style="margin-bottom:8px;flex-wrap:wrap;gap:4px">' +
    tabs.map(t => '<button class="btn xs ' + (bagFilter === t.id ? 'warn' : 'ghost') + '" onclick="setBagFilter(\'' + t.id + '\')">' +
      t.label + (t.id === 'all' ? '' : ' ' + t.n) + '</button>').join('') +
    '<span class="spacer"></span>' +
    (plan.items ? '<button class="btn xs warn" onclick="sellMerchantCat()">💰 ' + (bagFilter === 'all' ? '卖掉所有能卖的' : '把这一类全卖') + '（+' + plan.total + ' 材料）</button>' : '') +
    '</div>';
  if(!ids.length) h += '<p class="muted">背包里没有能卖的东西。<br><span class="hint">剧情道具、独一份的东西、身上穿的／手里拿的他都不收；换成营地或储物箱吧。</span></p>';
  else h += '<div class="grid g2">' + ids.map(id => {
    const it = ITEMS[id], n = itemCount(id);
    const one = sellValue(id, 1, rate, ITEMS), allV = sellValue(id, n, rate, ITEMS);
    return '<div class="lrow"><div><div class="nm">' + it.n + ' <span class="mono" style="color:var(--dim)">×' + n + '</span></div>' +
      '<div class="ds">' + (it.desc || '') + '</div></div><div class="rt">' +
      '<span class="tag ' + TYPE_TAG[it.t] + '">' + TYPE_LABEL[it.t] + '</span>' +
      '<button class="btn xs ok" onclick="sellMerchant(\'' + id + '\',1)">卖1（+' + one + '）</button>' +
      (n > 1 ? '<button class="btn xs danger" onclick="sellMerchant(\'' + id + '\',\'max\')">全卖×' + n + '（+' + allV + '）</button>' : '') +
      '</div></div>';
  }).join('') + '</div>';
  h += '<div class="hint" style="margin-top:10px">回收价 = 他卖价的 <b class="mono">' + Math.round(SELL_RATE * 100) + '%</b>（汇率一涨一跌都跟着走，所以卖回去永远比买进来亏）。' +
    '批量出售会先给你看清单再成交；「全卖×N」是这一种全清。<br>当前材料：<b class="mono">' + S.mat + '</b></div>';
  return h;
}
function openMerchant(){
  if(S.over) return;
  const rate = merchantRate();
  const row = (m, i) => {
    const it = ITEMS[m.id] || { n: m.id, desc: '' };
    const n = m.n || 1;
    const cost = shopPrice(m, rate);
    const left = shopLeft(m);
    const can = S.mat >= cost && left > 0;
    /* M39：批量购买 —— 份数按"材料 + 今日库存"实时算，不写死 ×5。
       总是有一个「买满×N」（N 就是现在能买到的最大份数）；能买超过 5 份时再给一个「×5」。 */
    const maxPlan = buyPlan(m, rate, S.mat, left, 'max');
    const batch = (k, label) => k >= 2
      ? '<button class="btn xs" onclick="buyMerchant(' + i + ',' + k + ')">' + label + '</button>' : '';
    return '<div class="lrow"><div><div class="nm">' + it.n + ' ×' + n + ' <span class="tag ' + (left > 0 ? '' : 'wpn') + '">剩余 ' + left + '/' + (m.stock || 99) + '</span></div><div class="ds">' + (it.desc || '') + '</div></div>' +
      '<div class="rt"><span class="tag ' + (can ? 'key' : '') + '">🔩 ' + cost + '</span>' +
      '<button class="btn xs ' + (can ? 'ok' : '') + '" ' + (can ? '' : 'disabled') + ' onclick="buyMerchant(' + i + ')">' + (left <= 0 ? '今日售罄' : (can ? '购买' : '材料不足')) + '</button>' +
      batch(maxPlan.max > 5 ? 5 : 0, '×5') +
      batch(maxPlan.max, '买满×' + maxPlan.max) +
      '</div></div>';
  };
  /* M32b：弹药单独一段（用户："没有各种不同的子弹卖"）——索引仍按 MERCHANT 原位置传，buyMerchant 不受影响 */
  const ammoRows = MERCHANT.map((m, i) => ({ m, i })).filter(x => x.m.sec === 'ammo');
  const gearRows = MERCHANT.map((m, i) => ({ m, i })).filter(x => x.m.sec !== 'ammo');
  const cut = (t, list) => (list.length ? '<div class="sect-title">' + t + '</div>' + list.map(x => row(x.m, x.i)).join('') : '');
  /* M44：买卖两个页签（同一个 popup 里）—— 标题行下面那一排就是切换；材料与汇率两边都看得到 */
  const tabBtn = (id, label) => '<button class="btn sm ' + (merchantTab === id ? 'warn' : 'ghost') + '" onclick="setMerchantTab(\'' + id + '\')">' + label + '</button>';
  const head = '<div class="row" style="margin-bottom:10px;flex-wrap:wrap;gap:6px">' + tabBtn('buy', '🛒 买') + tabBtn('sell', '💰 卖（收多余的东西）') +
    '<span class="spacer"></span><span class="chip gold">🔩 材料 <b>' + S.mat + '</b></span>' +
    '<span class="chip">汇率 ×' + rate.toFixed(2) + '</span></div>';
  const buyBody = '<p class="muted" style="margin-bottom:10px">"末日里最贵的不是子弹，是还能说话的人。看看货？"</p>' +
    cut('🔩 弹药（按口径 · 穿透越高越贵）', ammoRows) + cut('🎒 物资与装备', gearRows) +
    '<div class="hint" style="margin-top:10px">今日汇率 <b class="mono">×' + rate.toFixed(2) + '</b>（每天 +2%：外面越乱，他越敢开价）· 每样货每天有量，卖完等明天 · 当前材料：<b class="mono">' + S.mat + '</b><br>' +
    '买到的弹药直接进背包的对应弹种：打装甲目标记得先换<b>穿甲弹</b>（背包 → 弹药 里装填）。<br>' +
    /* M39：批量购买 */
    '要补货就按 <b>×N / 买满</b>：份数按你现在的材料和今天的库存实时算，一次补完（不会再点十几下）。</div>';
  modal({ title:'🏪 神秘商人', body: head + (merchantTab === 'sell' ? sellPanelHtml(rate) : buyBody),
    footer:'<button class="btn" data-close>离开</button>' });
}
function buyMerchant(i, times){
  const m = MERCHANT[i];
  /* M32b 兜底：坏货架（id 不在物品表里 / 价格数量不是正数）**不许成交**——
     旧版就是"先扣材料、再 grant 一个不存在的 id"，玩家看到的是材料花了子弹没进包。 */
  if(!m || badShopRows([m], ITEMS).length){ log('❌ 这件货有点问题（不在物品表里），这次先不成交。','danger'); return; }
  const n = Math.max(1, m.n || 1);
  /* M39：批量购买。份数上限 = min(材料买得起的, 今日剩余, 99)，扣款与库存都按实际成交份数走 */
  const plan = buyPlan(m, merchantRate(), S.mat, shopLeft(m), times === undefined ? 1 : times);
  if(!plan.times){ log('❌ ' + plan.reason, 'dim'); return; }
  S.mat -= plan.total;
  S.shop.bought[m.id] = (S.shop.bought[m.id] || 0) + plan.times;
  grant(m.id, n * plan.times, true);
  sfx('loot');
  log('🛒 购买 ' + itemName(m.id) + ' ×' + (n * plan.times) +
    (plan.times > 1 ? '（' + plan.times + ' 份 · -' + plan.total + ' 材料）' : '（-' + plan.total + ' 材料）'), 'loot');
  if(plan.reason) log('　 ' + plan.reason, 'dim');
  addXP('trade', 3 * plan.times);               // M24 承诺过"和商人买卖涨交易技能"，这里补上（按成交份数给）
  autosave();
  refreshMerchant();                            // M44：重开弹窗但保住滚动位置（买卖各一次不再被甩回顶部）
}

/* ───────────── 菜单 / 帮助 ───────────── */
function openMenu(){
  /* M26：存档 / 世界 / 账号这些元操作从探索页的工具条搬到这里（用户：「这是什么，为什么在地图上面，
     放到设置的 subpage 里面」）。按钮 HTML 由 v4 的 world-ui 提供，拿不到就只少这一段，不影响菜单其它部分。 */
  const lab = isLab();
  const v4tools = (!lab && typeof window.__v4ToolsButtons === 'function') ? String(window.__v4ToolsButtons() || '') : '';
  /* M27：新手教程入口 —— 想再看一遍（或朋友第一次玩）就点这里。M33：沙盒里不显示（它自己就是教学） */
  const v4tut = (!lab && typeof window.V4Tutorial === 'object' && window.V4Tutorial)
    ? '<button class="btn sm" onclick="closeAllModals();V4Tutorial.start(true)">🎓 新手指南（从头看一遍）</button>' : '';
  /* M33：教程沙盒（分章练习，独立 iframe）—— 只在主页面里出现 */
  const v4labBtn = (!lab && typeof window.V4Lab === 'object' && window.V4Lab)
    ? '<button class="btn sm" onclick="closeAllModals();V4Lab.open()">🧪 教程沙盒（分章练习）</button>' : '';
  /* M32：字号 + 地图开关也进菜单（用户："字体太小了，做可自定义字号适配"） */
  const v4scale = (typeof window.V4Scale === 'object' && window.V4Scale && window.V4Scale.buttons) ? String(window.V4Scale.buttons() || '') : '';
  modal({ title:'☰ 菜单', body:'<div class="hint" style="line-height:2">' +
    (lab
      /* M33：沙盒里把"会写盘"的入口全摘掉（存档/读取/回滚/重开/世界/账号）——用户拍板的"完全隔离" */
      ? '<b>🧪 这是教程沙盒</b>：所有进度都是临时的，<b>不会</b>写进你的主档、也不会不上传。<br>想接着玩自己的存档，点上面的「✕ 关闭沙盒」回到主页面。'
      : '存档是<b>自动</b>的（每日结束、搜刮、制作、建造、战斗结束时）。手动存档随时可用。<br>' +
        'M29 起存档<b>全部加密</b>（AES-GCM-256，密钥只在本机 worker 里、不可导出）：本机读写的都是密文。<br>' +
        'M39 起搬档也不用明文了：<b>「导出 / 导入（口令）」</b>给你一段口令加密的文本（跨设备粘贴即可）；' +
        '「备份历史」留最近 ' + BACKUP_SLOTS + ' 份快照，能挑一份回滚。想多端同步仍可用下面的<b>云存档</b>。') + '</div>' +
    (lab ? '' : '<div class="sect-title" style="margin-top:14px">存档</div><div class="row">' +
      '<button class="btn sm" onclick="closeAllModals();openSavePort()">🔐 导出 / 导入（口令）</button>' +
      '<button class="btn sm" onclick="closeAllModals();openBackupHistory()">🗂️ 备份历史</button>' +
      '</div>') +
    (v4tools ? '<div class="sect-title" style="margin-top:14px">世界与账号</div>' + v4tools : '') +
    (v4tut ? '<div class="sect-title" style="margin-top:14px">上手帮助</div>' + v4tut +
      '<div class="hint" style="margin-top:6px">第一次玩建议先看一遍：15 步，会直接把界面上的东西圈出来给你看（随时能退出，下次从这里继续）。</div>' : '') +
    (v4labBtn ? '<div class="row" style="margin-top:6px">' + v4labBtn + '</div>' +
      '<div class="hint" style="margin-top:6px">沙盒是<b>独立 iframe 里的平行世界</b>：分章练习、固定种子、目标清单全绿才算过，' +
      '怎么玩都<b>不会写进主档</b>（不存档、不上传），死了也不惩罚。</div>' : '') +
    '<div class="sect-title" style="margin-top:14px">设置</div><div class="row">' +
      '<button class="btn sm ' + (S.ui.pace === 'beat' ? 'warn' : '') + '" onclick="togglePace()">🎬 战斗节奏：' + (S.ui.pace === 'beat' ? '节拍模式' : '即时模式') + '</button>' +
      '<button class="btn sm ' + (S.ui.amb ? 'ok' : '') + '" onclick="toggleAmb()">🌫️ 环境底噪：' + (S.ui.amb ? '开' : '关') + '</button>' +
      '<button class="btn sm ' + (S.sfx ? 'ok' : '') + '" onclick="document.getElementById(\'btn-sfx\').click();closeAllModals();openMenu()">🔊 总音效：' + (S.sfx ? '开' : '关') + '</button>' +
      '<button class="btn sm ' + (S.ui.music ? 'ok' : '') + '" onclick="toggleMusic()">🎵 配乐：' + (S.ui.music ? '开' : '关') + '</button>' +
    '</div>' +
    (v4scale ? '<div class="sect-title" style="margin-top:10px">显示（字号 / 地图）</div>' + v4scale : '') +
    '<div class="hint" style="margin-top:6px">节拍模式会让每次攻击分三段演出（约 +0.3 秒/回合），方便看清谁挨了打；即时模式保持原来的手感。<br>配乐是程序现场合成的四小节循环（Am–F–C–E），没有音频文件：白天/夜晚/战斗/残血各有一套速度与配器。</div>',
    footer:(lab
      ? '<button class="btn" data-close>关闭</button>'
      : '<button class="btn ok" onclick="saveGame();closeAllModals()">💾 保存</button>' +
        '<button class="btn" onclick="closeAllModals();loadGame()">📂 读取</button>' +
        '<button class="btn" onclick="restoreBackup()">🛟 回滚备份</button>' +
        '<button class="btn danger" onclick="closeAllModals();confirmRestart()">🔄 重开新档</button>' +
        '<button class="btn" data-close>关闭</button>') });
}
function openHelp(){
  modal({ title:'? 生存手册', body:
    '<div class="hint" style="line-height:1.9">' +
    '<b>核心循环</b>：每天 6 点行动力 → 搜刮／战斗／建造 → 睡觉进入下一天。睡觉会消耗饱食与水分，可能遭遇夜间尸潮。<br>' +
    '<b>饥饿与水分</b>：低于 18 会降低伤害／闪避，归零则每回合掉血。食物和水都在背包里，记得吃。<br>' +
    '<b>感染</b>：被咬会增加感染度。饱食与水分都 >25 时每晚自然消退 1+；到 60% 进入<b>爆发期</b>，此后每晚 +2 只涨不降，抗生素 -25、血清 -60。<br>' +
    '<b>濒死救援</b>：第 1–3 天的第一次死亡会被路过的幸存者救回（恢复 25% 生命、扣一半材料），<b>整档只有一次</b>，且最终决战与尸潮无效。<br>' +
    '<b>夜间守夜</b>：尸潮不再是单纯扣血——它会变成一场防守战。围墙/门窗每级直接少来一个方向的敌人；撑不住可以按 5 弃守，但据点会被搜刮一空。<br>' +
    '<b>噪音</b>：开枪会让噪音上升，噪音越高夜间尸潮概率越大。近战无声——撬棍是你最好的朋友。<br>' +
    '<b>负重</b>：超出上限会变慢（体力消耗上升、闪避下降）。把东西存进基地储物箱。<br>' +
    '<b>战斗</b>：点敌人卡片切换目标；防御可减伤 55% 并回体力；投掷物对全体生效；霰弹枪吃弹快但单发最狠，步枪靠暴击。<br>' +
    '<b>装甲丧尸</b>：枪械伤害减半，用消防斧（破甲）或爆炸物。<br>' +
    '<b>防化服</b>：僵尸伤害 -40%，咬伤概率减半、咬伤带来的感染再 -25%——但它闷热笨重。<br>' +
    '<b>商人</b>：他按行情开价，价格每天 +2%（界面上会显示"今日汇率"）。多出来的东西也能卖给他——弹窗里切到「💰 卖」页签：<b>回收价 = 他卖价的 45%</b>（汇率两边一起走，所以卖回去永远比买进来亏），剧情道具、独一份的东西和身上穿的他不收。<br>' +
    '<b>深度搜索</b>：耗 2 行动力，材料效率与普通搜索持平，但更容易刷出稀有物品与秘闻。<br>' +
    '<b>主线</b>：7 个阶段，最后要下到方舟实验室第 7 层。通关后可进无尽模式。<br>' +
    '<b>委托板</b>：每晚刷新 3 张委托（其中 1 张指向当前主线），材料奖励受"当日赏金预算"封顶（9 + 天数÷2），不会凭空印材料。<br>' +
    '<b>精英丧尸</b>：第 3 天起每天最多出现 1 只，带一个词条（腐化／迅捷／爆裂／装甲／寄生），血更厚、经验更高、掉落更好，也可能出现在夜间尸潮里。<br>' +
    '<b>三种"要动脑子打"的</b>：<b>自爆者</b>死了会炸——用燃烧瓶/手雷（火焰、爆炸类）打死就不会炸；<b>喷吐者</b>隔着距离吐酸液，举盾挡不住，还会把你的护甲腐蚀变薄；<b>孵化者</b>每两回合产出一只爬行者，得优先集火。血月夜里还可能跟着一头<b>暴君</b>，它半血后攻击直接 +50%。<br>' +
    '<b>武器改装</b>：工作台 Lv.2 后可改装，每把武器最多 2 件，且都有取舍（消音降伤、弹匣增重、握把只对近战）。<br>' +
    '<b>同伴支线</b>：招募同伴会开启他的支线，三步走完给独占装备与秘闻。<br>' +
    '<b>设置</b>：菜单里可切换战斗节奏（即时／节拍三段演出）、配乐与环境底噪；配乐按白天 62 / 夜晚 52 / 战斗 132 / 守夜 146 BPM 自动变奏，残血时会叠一层小二度张力音。<br>' +
    '</div>' +
    '<div class="sect-title" style="margin-top:14px">快捷键</div>' +
    '<div class="hint" style="line-height:2">' +
    '<kbd>E</kbd> 探索　<kbd>B</kbd> 据点　<kbd>I</kbd> 背包　<kbd>C</kbd> 制作　<kbd>K</kbd> 技能　<kbd>Q</kbd> 任务　<kbd>J</kbd> 图鉴　<kbd>S</kbd> 统计　<kbd>N</kbd> 睡觉<br>' +
    '战斗中：<kbd>1</kbd> 攻击　<kbd>2</kbd> 防御　<kbd>3</kbd> 用药　<kbd>4</kbd> 投掷　<kbd>5</kbd> 逃跑　<kbd>Esc</kbd> 关闭弹窗</div>',
    footer:'<button class="btn" data-close>明白了</button>' });
}
document.addEventListener('keydown', e => {
  if(e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if(battle){
    const map = { '1':() => combatAct(ITEMS[S.eq.wpn] && ITEMS[S.eq.wpn].ammo ? 'shoot' : 'melee'), '2':() => combatAct('guard'),
      '3':() => combatAct('item'), '4':() => combatAct('throw'), '5':() => { if(!battle.opts.noFlee) combatAct('flee'); } };
    if(map[k]){ e.preventDefault(); map[k](); }
    return;
  }
  if(k === 'escape'){ closeModal(); return; }
  /* M38：数字键 1-4 = 用补给（治疗/补水/进食/状态药），弹窗开着时不生效 */
  if(/^[1-4]$/.test(k) && !document.querySelector('.overlay')){
    const q = quickPick(S.inv, ITEMS, k);
    if(q){ useConsumable(q); return; }
  }
  const tabs = { e:'explore', b:'base', i:'inv', c:'craft', k:'skills', q:'quest', j:'codex', s:'stats' };
  if(tabs[k] && !document.querySelector('.overlay')){ setTab(tabs[k]); return; }
  if(k === 'n' && !document.querySelector('.overlay')) sleepNight();
});
$('#btn-sfx').onclick = () => { S.sfx = !S.sfx; renderTop(); if(S.sfx) sfx('ui'); ambSync(); };
/* C19：浏览器自动播放策略要求首次交互之后才建 AudioContext */
function firstGesture(){
  ambMode(phaseName()[1] === 'night' ? 'night' : 'day');
  ambSync();
  document.removeEventListener('pointerdown', firstGesture);
  document.removeEventListener('keydown', firstGesture);
}
document.addEventListener('pointerdown', firstGesture);
document.addEventListener('keydown', firstGesture);
function togglePace(){
  S.ui.pace = (S.ui.pace === 'beat') ? 'fast' : 'beat';
  log('🎬 战斗节奏：' + (S.ui.pace === 'beat' ? '节拍模式（挥击 → 命中 → 反击 三段演出）' : '即时模式（默认）'), 'info');
  closeAllModals(); openMenu(); autosave();
}
function toggleAmb(){
  S.ui.amb = !S.ui.amb; ambSync();
  log('🌫️ 环境底噪：' + (S.ui.amb ? '开（页面切到后台自动静音）' : '关'), 'info');
  closeAllModals(); openMenu(); autosave();
}
function toggleMusic(){
  S.ui.music = !S.ui.music; ambSync();
  log('🎵 配乐：' + (S.ui.music ? '开（白天 62 / 夜晚 52 / 战斗 132 BPM，随局面变奏）' : '关'), 'info');
  closeAllModals(); openMenu(); autosave();
}
$('#btn-help').onclick = openHelp;
$('#btn-menu').onclick = openMenu;
$('#btn-clear-log').onclick = () => { clearLog(); S.logBuf = []; log('（日志已清空）','dim'); };

/* ═══════════ legacy/50-boot.js ═══════════ */
/* ───────────── 进度检查 / 启动 ───────────── */
function initGame(fresh){
  battle = null; combatModalId = null;
  defInit();
  clearLog();
  log('⛔ 丧尸末日生存 v4.0 · 余烬（大世界）', 'system');
  log('🗓️ 第 1 天 · 清晨 · 行动力 6/6', 'system');
  log('你在一间废弃医院的病床上醒来。左手背插着断掉的针头，记忆碎成一块一块。', 'narrative');
  log('走廊里有东西在拖行。你手边只有一根撬棍。', 'narrative');
  log('值班台上压着一本褪色的日记——先去读它。', 'info');
  log('💡 目标：活到第 ' + GOAL_DAY + ' 天（救援）。每 7 天一次血月，第 14 天断水断电。', 'info');
  log('💡 搜刮要先到那个地方（地图上点一下）；天黑前回不回得来，是你每天要算的账。', 'dim');
  discoverLore('l_the_one');
  materializeAmmoPool();                        // M32b：开局那 24 发落成真弹（旧版它是 S.ammo 里的死数）
  render();
}
function boot(){
  /* M33：沙盒 iframe —— 不读主档，按章节预设开一局固定种子的平行世界 */
  if(isLab()){ bootLab(); return; }
  initGame();
  // localStorage 在部分浏览器（file:// 或隐私模式）会直接抛错，探测必须包住
  const hasV2 = !!readSavedRaw(), hasV1 = !!lsGet(V1_KEY);
  if(hasV2){
    // M7.1：用户反馈"每次进游戏都要点一下继续"太烦——有 v2 档就直接自动读档；想重开走菜单「🔄 重开新档」
    if(loadGame(true)) return;
    log('⚠️ 存档读取失败（主档与备份都坏了），已按新档开始。','danger');
  } else if(hasV1){
    modal({ title:'📦 发现 v1.0 存档', sticky:true,
      body:'<p class="muted">v1.0 的进度可以迁移到 v2.1：生命、材料、弹药、天数、主线进度、已解锁秘闻、背包物品都会带过来（旧存档不会被删除）。</p>',
      footer:'<button class="btn ok" onclick="closeAllModals();migrateV1()">迁移并继续</button>' +
        '<button class="btn ghost" onclick="closeAllModals()">从头开始</button>' });
  }
}
/** M33：教程沙盒的开局（预设来自 v4/sandbox-core 的章节表，这里只负责套用 + 打日志） */
function bootLab(){
  const lab = window.__ZSV_LAB || {};
  const p = lab.preset || {};
  S = newState();
  S.ammo = 0;                                   // 开局弹药池清零：沙盒的物资完全按预设给（见下）
  S.seed = p.seed || 'lab-01';                  // 固定种子：同一章每次进来地图一模一样
  S.world = null;                               // 让 ensureSaveWorld 按这个种子重建
  S.day = Math.max(1, Math.floor(p.day || 1));
  /* M33 第三批：行动力按预设给（第 5 章要走路+深搜+跨区，24 点才够；老预设没写就是 14） */
  S.ap = S.apMax = Math.max(1, Math.min(30, Math.floor(p.ap || 14)));
  S.mat = Math.max(0, Math.floor(p.mat == null ? 12 : p.mat));
  S.hp = S.hpMax = 100;
  S.hun = clamp(p.hun == null ? 80 : p.hun, 0, 100);
  S.thi = clamp(p.thi == null ? 80 : p.thi, 0, 100);
  S.sta = S.staMax = 100;
  S.inv = {}; S.store = {}; S.eq.wpn = null;
  const inv = p.inv || {};
  for(const id in inv){ if(ITEMS[id] && inv[id] > 0) S.inv[id] = Math.floor(inv[id]); }
  if(!S.eq.wpn){ const firstWpn = Object.keys(S.inv).find(id => ITEMS[id] && ITEMS[id].t === 'wpn'); if(firstWpn) S.eq.wpn = firstWpn; }
  /* M48：预设里给了护甲就顺手穿上 —— 第 2 章那只装甲丧尸一巴掌 17，教学章不该卡在"忘了穿甲衣"。 */
  if(!S.eq.body){
    const armorGear = Object.keys(S.inv)
      .filter(id => ITEMS[id] && ITEMS[id].slot === 'body' && ITEMS[id].armor)
      .sort((a, b) => (ITEMS[b].armor || 0) - (ITEMS[a].armor || 0))[0];
    if(armorGear) S.eq.body = armorGear;
  }
  /* M33 第三批：预设据点设施（第 4 章要"从零建"，就不给） */
  if(p.base && typeof p.base === 'object'){
    for(const k in p.base){ if(BASE_UP[k]) S.base[k] = Math.max(0, Math.floor(p.base[k] || 0)); }
  }
  /* M33 第三批：预设技能（第 5 章给体能 → 行动力上限跟着涨，由 syncApMax 在挂载时重算） */
  if(p.skills && typeof p.skills === 'object'){
    for(const k in p.skills){ if(S.skills[k] !== undefined) S.skills[k] = Math.max(0, Math.min(10, Math.floor(p.skills[k] || 0))); }
  }
  /* M33 第三批：预设伤情（第 3 章）——直接写进 S.body，医疗运行时读的就是它 */
  if((p.injuries && p.injuries.length) || (p.parts && typeof p.parts === 'object')){
    const parts = {};
    const PARTS = ['head','torso','belly','armL','armR','legL','legR'];
    for(const k of PARTS) parts[k] = (p.parts && typeof p.parts[k] === 'number') ? clamp(p.parts[k], 0, 100) : 100;
    const inj = (p.injuries || []).filter(i => i && i.id && i.part)
      .map(i => ({ id: i.id, part: i.part, day: Math.max(1, Math.floor(i.day || S.day)), field: !!i.field, done: !!i.done }));
    S.body = { parts, injuries: inj, bleedSince: S.day };
  }
  S.tab = 'explore';
  syncAmmo();
  initGame(true);
  /* M48：教学保证（第 2 章"用穿甲弹打死装甲丧尸"）—— 装甲丧尸平时只在地铁/军方/实验室那几区刷，
     靠运气走进去太玄学，所以预设要了就把它塞进**所有**区的敌人表。只动沙盒这一份内存里的表，
     主档的区表不受影响（沙盒是独立 iframe + 独立页面实例）。 */
  if(Array.isArray(p.extraEnemies)){
    for(const eid of p.extraEnemies){
      if(!ZOMBIES[eid]) continue;
      for(const zid in ZONES){
        const z = ZONES[zid];
        if(!z || !Array.isArray(z.enemies) || z.enemies.indexOf(eid) >= 0) continue;
        z.enemies.push(eid);
      }
    }
  }
  /* M55：教学保证（2）—— 把指定敌人的血量按倍率压成"训练靶"（同样只动沙盒内存里的那张表） */
  if(p.foeHpMul && typeof p.foeHpMul === 'object'){
    for(const eid in p.foeHpMul){
      const z = ZOMBIES[eid], mul = +p.foeHpMul[eid];
      if(!z || !isFinite(mul) || mul <= 0 || mul >= 1) continue;
      z.hp = Math.max(1, Math.round(z.hp * mul));
    }
  }
  hr();
  log('🧪 教程沙盒 · ' + (lab.ch || 'survival') + '（固定种子 ' + S.seed + '）','system');
  log('这里怎么玩都**不会**写进你的主档：不存档、不上传、死了不惩罚。照着右侧目标清单练就行。','info');
  render();
}
/* boot() 由 src/main.ts 在 v4 模块就绪后调用 */

/* ═══════════ legacy/45-globals.js ═══════════ */
/* 内联 onclick 只能看到 window 上的属性，而顶层 let/const 不是 window 属性：
   这里把状态对象挂成访问器，保证内联事件与外部脚本读写的是同一份状态。 */
/* ── C23 工程加固：显式导出（内联 onclick 与外部验证脚本依赖这些名字）── */
Object.assign(window, { VER, SAVE_KEY, V1_KEY, ITEMS, itemName, isWpn, ZOMBIES, ZONES, BASE_UP, RECIPES, SKILLS, COMPANIONS, MERCHANT, LORE, ACHIEVEMENTS, AFFIX, BOUNTY_POOL, QUEST_BOUNTIES, SIDE_QUESTS, MODS, ZONE_SIL, newState, RM, BAK_KEY, writeSave, saveGame, autosave, readSavedRaw, lsGet, lsSet, sanitizeSave, MIGRATIONS, migrateSave, loadGame, confirmRestart, migrateV1, deepMerge, restoreBackup, $, $$, clamp, rnd, ri, chance, pick, wpick, esc, AUDIO_MAX, actx, AMB, ambStart, ambBlip, ambStop, ambMode, ambSync, MUS, MUS_MAX, CHORDS, PENTA, mtof, musicMood, musicTempo, musicVoice, musicNoiseHit, musicBar, musicStart, musicStop, musicSting, tone, arnd, noise, SFX, sfx, floatText, shake, toast, firstTip, award, addXP, log, clearLog, replayLog, hr, skillBonus, capWeight, carryWeight, encumbrance, armorTotal, addItem, takeItem, itemCount, has, ammoInMag, phaseName, spendAP, tickVitals, statMods, sleepNight, nightRaid, combatRepair, rescueEnding, recapHtml, TABS, renderTop, bar, renderHud, nextStep, renderTabs, setTab, render, baseLevel, modal, closeModal, closeAllModals, mkFoe, startCombat, openCombatModal, cbLog, drawCombat, battleTarget, siegePanelHtml, effDmg, combatAct, combatAfter, combatResolve, hitFoe, killFoe, afterPlayerTurn, companionTurn, foeTurn, endCombat, gameOver, restart, zoneOpen, zoneLockText, renderExplore, openZone, drawZone, grant, searchZone, applyFirst, lootItem, encounterRoll, survivorEvent, recruit, restHere, useConsumable, equipItem, equipWeapon, dropItem, deposit, withdraw, TYPE_LABEL, TYPE_TAG, renderInv, renderSideQuests, renderMods, renderCraft, craft, renderBase, scaledCost, build, renderSkills, QUEST_STAGES, questProgress, checkQuest, renderQuest, GOAL_DAY, MAP, WOUND_DEF, daysToHorde, nextEventText, threatLevel, travelCost, travelTo, defMax, defInit, repairDefense, TRAPS, buildTrap, hasWound, addWound, cureWound, woundTick, spoilTick, powerOff, raiseHorde, renderCalendar, noiseCheck, runScore, bountyBudget, bountyDef, metricValue, rollBounties, bountyTick, claimBounty, renderBounties, affixRoll, applyAffix, sideActive, sideTick, sideAdvance, sideNightCheck, modsOf, modSum, modMul, addMod, shopLeft, shopDayCheck, startFinalBattle, bossPhase2, finalVictory, enterEndless, renderCodex, discoverLore, renderStats, checkAch, merchantRate, openMerchant, buyMerchant, openMenu, openHelp, firstGesture, togglePace, toggleAmb, toggleMusic, initGame,
  /* M25：口径/弹种/辐射这几个查询函数被验收探针与将来的 UI 直接用，一并挂出去 */
  CALIBERS, AMMO_OF, ammoCount, loadedAmmo, setLoaded, cycleLoaded, penMul, radTier, apCapOf, fitnessApBonus, phaseOf, PHASE_LABEL,
  syncAmmo, materializeAmmoPool, ammoShopRows,   // M32b：弹药镜像收口 + 货架弹药段（验收探针直接调）
  shopPrice, buyPlan,                            // M39：货架报价与批量购买方案（验收探针直接调）
  setMerchantTab, sellMerchant, sellMerchantCat, sellMerchantCatGo, merchantEquipped,   // M44：商人页签 + 卖东西（内联 onclick）
  sellPlan, sellValue, sellBatchPlan, sellBatchQuote, sellBlockReason, canSell, ITEM_BASE, SELL_RATE,   // M44：收购的纯逻辑（验收探针直接调）
  isLab,                                        // M33：教程沙盒（写盘守卫 + 菜单分岔都用它）
  depositAll, setBagFilter, quickBarHtml,       // M38：背包批量存入/筛选切换 + 补给快捷条（内联 onclick）
  openSavePort, openBackupHistory, restoreHistory, exportHistory, deleteHistory,   // M39：口令导出/导入 + 备份历史（内联 onclick）
  radLevelAt, radGain, radProtect, RAD_SOURCES, geigerText, boot });
Object.defineProperty(window, "logFollow", { get: function(){ return logFollow; }, set: function(v){ logFollow = v; }, configurable: true });
Object.defineProperty(window, "logFollowWhy", { get: function(){ return logFollowWhy; }, configurable: true });
Object.defineProperty(window, "bagFilter", { get: function(){ return bagFilter; }, set: function(v){ bagFilter = v; }, configurable: true });
Object.defineProperty(window, "S", { get: function(){ return S; }, set: function(v){ S = v; }, configurable: true });
Object.defineProperty(window, "battle", { get: function(){ return battle; }, set: function(v){ battle = v; }, configurable: true });
Object.defineProperty(window, "fxLock", { get: function(){ return fxLock; }, set: function(v){ fxLock = v; }, configurable: true });
Object.defineProperty(window, "AC", { get: function(){ return AC; }, set: function(v){ AC = v; }, configurable: true });
Object.defineProperty(window, "audioLive", { get: function(){ return audioLive; }, set: function(v){ audioLive = v; }, configurable: true });
Object.defineProperty(window, "audioSeed", { get: function(){ return audioSeed; }, set: function(v){ audioSeed = v; }, configurable: true });
Object.defineProperty(window, "tipLast", { get: function(){ return tipLast; }, set: function(v){ tipLast = v; }, configurable: true });
Object.defineProperty(window, "modalStack", { get: function(){ return modalStack; }, set: function(v){ modalStack = v; }, configurable: true });
Object.defineProperty(window, "modalSeq", { get: function(){ return modalSeq; }, set: function(v){ modalSeq = v; }, configurable: true });
Object.defineProperty(window, "combatModalId", { get: function(){ return combatModalId; }, set: function(v){ combatModalId = v; }, configurable: true });
Object.defineProperty(window, "codexCat", { get: function(){ return codexCat; }, set: function(v){ codexCat = v; }, configurable: true });
