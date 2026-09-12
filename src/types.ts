/* v4.0 核心类型：世界 / 宝可梦式战斗 / NPC。旧版单文件代码在 src/legacy/game.ts 里当底座，通过 bridge 访问。 */

/* ── 世界 ── */
export type Biome = 'city' | 'suburb' | 'industrial' | 'forest' | 'farm' | 'water' | 'ruins' | 'military' | 'highway';

export interface Block {
  x: number;
  y: number;
  biome: Biome;
  name: string;
  poi: string | null;      // POI 类型 id
  danger: number;          // 1..5
  searched: number;        // 已搜刮次数
  depleted: boolean;       // 搜空
  visited: boolean;
  revealed: boolean;       // 迷雾：只有到过或相邻才显示细节
}

export interface WorldState {
  seed: string;
  w: number;
  h: number;
  home: { x: number; y: number };
  lab: { x: number; y: number };
  blocks: Record<string, Block>;   // key = "x,y"
}

/* ── 战斗（宝可梦式） ── */
export type DamageType = 'blunt' | 'slash' | 'bullet' | 'fire' | 'blast' | 'toxic' | 'shock';
export type FoeType = 'flesh' | 'bone' | 'armor' | 'toxic' | 'swift' | 'hulk';
export type StatusKind = 'bleed' | 'poison' | 'burn' | 'stun' | 'weak';

export interface MoveCost { sta?: number; ammo?: number; item?: string; }
export interface Move {
  id: string;
  name: string;
  type: DamageType;
  power: number;
  acc: number;            // 0..1
  crit: number;           // 额外暴击率
  cost: MoveCost;
  target: 'one' | 'all' | 'self';
  priority?: number;      // 先制度（越大越先出手）
  status?: StatusKind;
  statusChance?: number;
  self?: { guard?: number; critUp?: number; sta?: number; acc?: number };
  desc: string;
  /** 只有装备对应武器/道具时才可用 */
  require?: { weaponTag?: string; item?: string };
}

export interface Foe {
  id: string;
  name: string;
  hp: number;
  hpMax: number;
  atk: number;
  def: number;
  spd: number;
  types: FoeType[];
  moves: string[];
  statuses: { kind: StatusKind; turns: number; power: number }[];
  elite?: boolean;
  affix?: string;
  traits: string[];
  loot?: Record<string, number>;
  xp?: number;
  boss?: boolean;
}

export interface PlayerCombatState {
  hp: number;
  sta: number;
  ammo: number;
  guard: number;          // 本回合减伤
  critUp: number;         // 蓄力
  weak: boolean;
  statuses: { kind: StatusKind; turns: number; power: number }[];
}

export type ActorRef = { side: 'player' } | { side: 'foe'; index: number };

export interface BattleEvent {
  kind: 'damage' | 'status' | 'miss' | 'faint' | 'info' | 'effect' | 'end';
  text: string;
  target?: ActorRef;
  amount?: number;
  effectiveness?: number;   // 2 = 效果拔群
  crit?: boolean;
}

export interface Battle {
  foes: Foe[];
  player: PlayerCombatState;
  queue: ActorRef[];
  idx: number;
  round: number;
  events: BattleEvent[];
  log: { text: string; cls: string }[];
  over: null | 'win' | 'lose' | 'flee';
  opts: {
    siege?: boolean; boss?: boolean; final?: boolean; noFlee?: boolean; bloodMoon?: boolean;
    title?: string; sub?: string;
    /** 战斗中的副作用钩子：引擎保持纯逻辑，掉血/感染/掉落这些交给外层去落到存档上 */
    hooks?: {
      onFoeFaint?(foe: Foe): void;
      onPlayerHit?(dmg: number, foe: Foe): void;
      onPlayerFaint?(): void;
      onEnd?(result: 'win' | 'lose' | 'flee'): void;
    };
  };
  target: number;
  /** 玩家的先手值：playerAct 内部要用它推进到下一轮 */
  playerSpeed: number;
  stats: { dealt: number; taken: number; clean: boolean };
}

/* ── NPC 幸存者 ── */
export interface Survivor {
  id: string;
  name: string;
  role: 'trader' | 'medic' | 'scout' | 'mechanic' | 'bandit' | 'refugee';
  hp: number;
  rep: number;
  desc: string;
  stock?: { id: string; cost: number; n?: number }[];
}
