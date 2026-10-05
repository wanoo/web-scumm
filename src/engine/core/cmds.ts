// The catalogue of commands: the one place that knows every key of the `Cmd` union, which keys hold nested command
// lists, which ones change the state and which ones carry text. The engine, the validator, the solver, the texts walker
// and the content tools read it, so a new command is declared once here (the type check below refuses an unlisted one).
import type { Cmd, GameDef, RoomDef } from './types';

/** The discriminant key of every `Cmd` variant (a plain string is the hero's line). */
export const CMD_KEYS = [
  'say',
  'walk',
  'face',
  'pose',
  'anim',
  'place',
  'wait',
  'parallel',
  'camera',
  'play',
  'stopAnim',
  'launch',
  'spring',
  'path',
  'follow',
  'prop',
  'show',
  'hide',
  'gain',
  'lose',
  'used',
  'set',
  'unset',
  'inc',
  'unlock',
  'goto',
  'map',
  'moveActor',
  'emit',
  'waitUntil',
  'waitEvent',
  'switchPlayer',
  'transfer',
  'custom',
  'startScript',
  'stopScript',
  'sfx',
  'music',
  'toast',
  'shake',
  'if',
  'once',
  'nth',
  'cycle',
  'random',
  'cutscene',
  'choice',
  'minigame',
  'phone',
  'guide',
  'talk',
  'hint',
  'ending',
  'reveal',
  'end',
] as const;
export type CmdKey = (typeof CMD_KEYS)[number];

type CmdObj = Exclude<Cmd, string>;
type KeysOfUnion<T> = T extends unknown ? keyof T : never;
/** Every variant of `Cmd` must carry one of the listed keys… */
type Unlisted = Exclude<CmdObj, { [K in CmdKey]: Record<K, unknown> }[CmdKey]>;
/** …and every listed key must exist on some variant. */
type Unknown = Exclude<CmdKey, KeysOfUnion<CmdObj>>;
const _everyVariantListed: [Unlisted] extends [never] ? true : 'a Cmd variant is missing from CMD_KEYS' = true;
const _everyKeyKnown: [Unknown] extends [never] ? true : 'CMD_KEYS names a key no Cmd has' = true;
void _everyVariantListed;
void _everyKeyKnown;

/** The key that names a command (`undefined` for a plain string). */
export function cmdKey(c: Cmd): CmdKey | undefined {
  if (typeof c === 'string') return undefined;
  for (const k of CMD_KEYS) if (k in c) return k;
  return undefined;
}

/** Commands that change the game's state (what the solver and the saves care about); the others only show something. */
export const CHANGES: ReadonlySet<CmdKey> = new Set<CmdKey>([
  'prop',
  'show',
  'hide',
  'gain',
  'lose',
  'used',
  'set',
  'unset',
  'inc',
  'unlock',
  'goto',
  'map',
  'moveActor',
  'emit',
  'switchPlayer',
  'transfer',
  'custom',
  'startScript',
  'stopScript',
  'minigame',
  'phone',
  'ending',
  'reveal',
  'end',
]);

/** Commands that carry a text the player reads (`choice` holds one per option, a plain string is a line). */
export const TEXTS: ReadonlySet<CmdKey> = new Set<CmdKey>(['say', 'toast', 'guide', 'choice']);

/** Keys of the commands that hold nested command lists. */
export const CONTAINERS: ReadonlySet<CmdKey> = new Set<CmdKey>([
  'if',
  'once',
  'nth',
  'cycle',
  'random',
  'parallel',
  'cutscene',
  'choice',
  'minigame',
  'phone',
  'anim',
  'ending',
  'reveal',
]);

export interface SubList {
  list: Cmd[] /** Path suffix, the convention of the translation tables: `.then`, `.nth[1]`, `.choice[0].do`, `.at[3]`. */;
  path: string;
}

/** The command lists nested in a command, with their path suffixes. */
export function subLists(c: Cmd): SubList[] {
  if (typeof c === 'string') return [];
  const out: SubList[] = [];
  const add = (list: Cmd[] | undefined, path: string) => {
    if (list) out.push({ list, path });
  };
  if ('if' in c) {
    add(c.then, '.then');
    add(c.else, '.else');
  } else if ('once' in c) add(c.once, '.once');
  else if ('nth' in c) c.nth.forEach((b, j) => add(b, `.nth[${j}]`));
  else if ('cycle' in c) c.cycle.forEach((b, j) => add(b, `.cycle[${j}]`));
  else if ('random' in c) c.random.forEach((b, j) => add(b, `.random[${j}]`));
  else if ('parallel' in c) c.parallel.forEach((b, j) => add(b, `.parallel[${j}]`));
  else if ('cutscene' in c) add(c.cutscene, '.cutscene');
  else if ('choice' in c) c.choice.forEach((o, j) => add(o.do, `.choice[${j}].do`));
  else if ('minigame' in c) add(c.then, '.then');
  else if ('phone' in c) add(c.do, '.do');
  else if ('anim' in c) {
    for (const [k, b] of Object.entries(c.at ?? {})) add(b, `.at[${k}]`);
  } else if ('ending' in c || 'reveal' in c) add(c.after, '.after');
  return out;
}

/** Visits every command of a list, nested ones included (parents first). `fn` gets the command and its path. */
export function eachCmd(list: Cmd[] | undefined, fn: (c: Cmd, path: string) => void, path = ''): void {
  list?.forEach((c, i) => {
    const p = `${path}[${i}]`;
    fn(c, p);
    for (const s of subLists(c)) eachCmd(s.list, fn, p + s.path);
  });
}

/** Does any command of the list (deep) satisfy the test? */
export function someCmd(
  list: Cmd[] | undefined,
  test: (c: Exclude<Cmd, string>, key: CmdKey | undefined) => boolean,
): boolean {
  let found = false;
  eachCmd(list, (c) => {
    if (!found && typeof c !== 'string' && test(c, cmdKey(c))) found = true;
  });
  return found;
}

/** Does the list (deep) change the state? A gag that only talks does not. */
export function changesState(list: Cmd[] | undefined): boolean {
  return someCmd(list, (_c, k) => k !== undefined && CHANGES.has(k));
}

export interface CmdList {
  list: Cmd[];
  /** The path of the list, the convention of the translation tables (`room:house/on[2].do`, `rules/on[0].do`, `start/intro`). */
  path: string;
  /** The room the list belongs to (none for the game's rules, scripts, events and intro). */
  room?: RoomDef;
  /** Generated by the engine from a declared exit (the tools skip those: nothing to translate or report). */
  generated?: boolean;
  /** The top level of a script (where `waitUntil` / `waitEvent` pause it). */
  script?: boolean;
}

/** Every command list of the game: rooms (onEnter, rules, topics, scripts, events, prop frame events), then the game's. */
export function cmdLists(game: GameDef): CmdList[] {
  const out: CmdList[] = [];
  for (const r of game.rooms) {
    const P = `room:${r.id}/`;
    if (r.onEnter) out.push({ list: r.onEnter, path: `${P}onEnter`, room: r });
    (r.on ?? []).forEach((x, i) => out.push({ list: x.do, path: `${P}on[${i}].do`, room: r, generated: !!x.exit }));
    for (const [actor, ts] of Object.entries(r.talk ?? {}))
      ts.forEach((t, i) => out.push({ list: t.do, path: `${P}talk.${actor}[${i}].do`, room: r }));
    (r.scripts ?? []).forEach((sc) =>
      out.push({ list: sc.do, path: `${P}scripts.${sc.id}.do`, room: r, script: true }),
    );
    (r.events ?? []).forEach((ev, i) => out.push({ list: ev.do, path: `${P}events[${i}].do`, room: r }));
    for (const [pid, p] of Object.entries(r.props ?? {}))
      for (const [an, a] of Object.entries(p.anims ?? {}))
        for (const [k, b] of Object.entries(a.at ?? {}))
          out.push({ list: b, path: `${P}props.${pid}.anims.${an}.at[${k}]`, room: r });
  }
  (game.rules.on ?? []).forEach((x, i) => out.push({ list: x.do, path: `rules/on[${i}].do` }));
  (game.scripts ?? []).forEach((sc) => out.push({ list: sc.do, path: `scripts.${sc.id}.do`, script: true }));
  (game.events ?? []).forEach((ev, i) => out.push({ list: ev.do, path: `events[${i}].do` }));
  if (game.start.intro) out.push({ list: game.start.intro, path: 'start/intro' });
  return out;
}
