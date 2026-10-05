// The proof's abstractions (the canonical character, the mobility regions, the no-op memo) against the explicit
// search, beyond the hand-written corpus: random small games (tests/gen/random-game.ts), and one game per condition
// and per command of the DSL. `auditAbstractions` (npm run solve -- --audit-abstractions) runs every memo hit anyway
// and compares the verdicts. A new condition or command must get a sample here: the two tables are checked against
// the `Cond` and `Cmd` types at compile time.
import { describe, expect, it } from 'vitest';
import type { Cmd, Cond, GameDef, Layout } from '@engine/core/types';
import type { CmdKey } from '@engine/core/cmds';
import type { CustomCommands } from '@engine/core/custom';
import { auditAbstractions, type AuditResult } from '@engine/tools/audit';
import { solve } from '@engine/tools/solve';
import { randomGame } from './gen/random-game';

describe('random games: the abstractions give the explicit search verdict', () => {
  it('120 seeds: never diverged, and every kind of verdict is met', async () => {
    const seen: Record<string, number> = {};
    const diverged: string[] = [];
    for (let seed = 1; seed <= 120; seed++) {
      const { game, layouts } = randomGame(seed);
      const a = await auditAbstractions(game, layouts, { maxStates: 3000 });
      seen[a.status] = (seen[a.status] ?? 0) + 1;
      seen[`explicit ${a.explicit.status}`] = (seen[`explicit ${a.explicit.status}`] ?? 0) + 1;
      if (a.status === 'diverged') diverged.push(`seed ${seed}: ${a.divergences.join('; ')}`);
    }
    expect(diverged).toEqual([]);
    expect(seen.same).toBeGreaterThan(80);
    for (const s of ['solved', 'softlocks', 'unsolved']) expect(seen[`explicit ${s}`], s).toBeGreaterThan(5);
  }, 600000);

  it('the same seed gives the same game', () => {
    expect(JSON.stringify(randomGame(7))).toBe(JSON.stringify(randomGame(7)));
    expect(JSON.stringify(randomGame(7))).not.toBe(JSON.stringify(randomGame(8)));
  });
});

/** Two rooms, a spot, a door, two characters; `rule` is the rule under test, the door ends the game once `did` is set. */
function harness(o: { rules: NonNullable<GameDef['rooms'][number]['on']>; patch?: Partial<GameDef>; roomPatch?: Partial<GameDef['rooms'][number]> }): { game: GameDef; layouts: Record<string, Layout> } {
  const game: GameDef = {
    id: 'kind', title: 'Kind', saveVersion: 1, hero: 'ann',
    players: { ids: ['ann', 'bob'], start: { bob: { room: 'room1' } } },
    verbs: [{ id: 'look', label: 'Look', color: '#fff' }, { id: 'take', label: 'Take', color: '#fff' }, { id: 'use', label: 'Use', color: '#fff', join: 'with' }, { id: 'talk', label: 'Talk', color: '#fff' }],
    characters: { ann: { name: 'Ann', color: '#fff', sprites: { idle: ['a/1'] } }, bob: { name: 'Bob', color: '#fff', sprites: { idle: ['b/1'] } }, cat: { name: 'Cat', color: '#fff', room: 'room0', sprites: { idle: ['c/1'] } } },
    items: { key: { name: 'key', icon: 'i/key', look: 'A key.' }, coin: { name: 'coin', icon: 'i/coin', look: 'A coin.' } },
    rooms: [
      { id: 'room0', name: 'Room 0', decor: 'd/0', hotspots: { spot: { name: 'spot' }, lever: { name: 'lever' }, door: { name: 'door' } }, props: { box: { name: 'box', states: { shut: 'p/shut', open: 'p/open' }, anims: { open: { frames: ['p/a1', 'p/a2'], at: { 1: [{ set: 'creak' }] } } } } }, actors: { cat: { char: 'cat' } }, look: {},
        on: [...o.rules, { verb: 'take', a: 'lever', do: [{ if: 'lever', then: [{ unset: 'lever' }], else: [{ set: 'lever' }] }] }, { verb: 'take', a: 'spot', if: { not: { has: 'key' } }, do: [{ gain: 'key' }] }, { verb: 'use', a: 'door', if: 'did', do: [{ end: true }] }],
        exits: { next: { name: 'next', to: 'room1' } }, ...o.roomPatch },
      { id: 'room1', name: 'Room 1', decor: 'd/1', hotspots: { well: { name: 'well' } }, look: {}, on: [{ verb: 'use', a: 'key', b: 'well', do: [{ lose: 'key' }, { set: 'wet' }] }], exits: { back: { name: 'back', to: 'room0' } } },
    ],
    map: { regions: { r: { name: 'Region', image: 'm/r' } }, start: 'r', places: { p0: { name: 'Room 0', room: 'room0', region: 'r', pos: [10, 10] }, p1: { name: 'Room 1', room: 'room1', region: 'r', pos: [50, 50] } } },
    rules: { fallbacks: { look: ['Nothing.'], take: ['No.'], use: ['No.'], talk: ['No.'], use2: ['No.'] } },
    start: { room: 'room0' },
    skin: { icons: { map: 'ui/map', pause: 'ui/pause', music: 'ui/music' } }, ui: {} as GameDef['ui'],
    ...o.patch,
  };
  return { game, layouts: { room0: { entries: { default: [320, 360] }, actors: { cat: { x: 200, y: 330, h: 100 } } }, room1: { entries: { default: [320, 360] } } } };
}

const commands: CustomCommands = { ring: { effects: [{ set: 'rang' }] } };
const did: Cmd = { set: 'did' };

/** One sample per command: the rule `Take spot2` runs it, then sets `did` (the ending's gate). */
const CMD_SAMPLES: Record<CmdKey, { cmd: Cmd; patch?: Partial<GameDef>; roomPatch?: Partial<GameDef['rooms'][number]> }> = {
  say: { cmd: { say: ['ann', 'Hello.'] } }, walk: { cmd: { walk: [200, 350] } }, face: { cmd: { face: 'left' } }, pose: { cmd: { pose: ['ann', 'idle'] } },
  anim: { cmd: { anim: ['ann', 'idle'], ms: 10, at: { 0: [{ set: 'mid' }] } } }, place: { cmd: { place: ['ann', [100, 350]] } }, wait: { cmd: { wait: 10 } },
  parallel: { cmd: { parallel: [[{ set: 'x' }], [{ gain: 'coin' }]] } }, camera: { cmd: { camera: 'reset' } }, play: { cmd: { play: ['box', 'open'] } }, stopAnim: { cmd: { stopAnim: 'box' } },
  launch: { cmd: { launch: { target: 'box', to: [420, 330], rotate: 360 } } }, spring: { cmd: { spring: { target: 'box', axis: 'rot' } } },
  path: { cmd: { path: { target: 'ann', points: [[100, 360], [300, 340], [500, 360]] } } }, follow: { cmd: { follow: { target: 'cat', leader: 'ann', ms: 200 } } },
  prop: { cmd: { prop: ['box', 'open'] }, roomPatch: undefined }, show: { cmd: { show: 'cat' } }, hide: { cmd: { hide: 'cat' } }, gain: { cmd: { gain: 'coin' } }, lose: { cmd: { lose: 'key' } },
  used: { cmd: { used: 'key' } }, set: { cmd: { set: ['level', 2] } }, unset: { cmd: { unset: 'lever' } }, inc: { cmd: { if: { flag: 'n', lt: 2 }, then: [{ inc: 'n' }] } }, unlock: { cmd: { unlock: 'p1' } },
  goto: { cmd: { goto: 'room1' } }, map: { cmd: { map: true } }, moveActor: { cmd: { moveActor: ['cat', 'room1'] } }, emit: { cmd: { emit: 'bell' }, roomPatch: { events: [{ on: 'bell', once: true, do: [{ set: 'heard' }] }] } },
  waitUntil: { cmd: { startScript: 'watch' }, patch: { scripts: [{ id: 'watch', do: [{ waitUntil: 'lever' }, { set: 'watched' }] }] } },
  waitEvent: { cmd: { startScript: 'listen' }, patch: { scripts: [{ id: 'listen', do: [{ waitEvent: 'bell' }, { set: 'listened' }] }] } },
  switchPlayer: { cmd: { switchPlayer: 'bob' } }, transfer: { cmd: { transfer: ['key', 'bob'] } }, custom: { cmd: { custom: 'ring' } },
  startScript: { cmd: { startScript: 'tick' }, patch: { scripts: [{ id: 'tick', do: [{ wait: 100 }, { set: 'ticked' }] }] } }, stopScript: { cmd: { stopScript: 'tock' }, patch: { scripts: [{ id: 'tock', loop: true, do: [{ wait: 100 }, { if: { flag: 'n', lt: 2 }, then: [{ inc: 'n' }] }] }] } },
  sfx: { cmd: { sfx: 'click' } }, music: { cmd: { music: { stop: true } } }, toast: { cmd: { toast: 'Saved.' } }, shake: { cmd: { shake: 100 } },
  if: { cmd: { if: { has: 'key' }, then: [{ set: 'k' }], else: [{ unset: 'k' }] } }, once: { cmd: { once: [{ gain: 'coin' }], id: 'o1' } }, nth: { cmd: { nth: [[{ set: 'a' }], [{ set: 'b' }]], id: 'n1' } },
  cycle: { cmd: { cycle: [[{ set: 'a' }], [{ unset: 'a' }]], id: 'c1' } }, random: { cmd: { random: [[{ set: 'a' }], [{ set: 'b' }]], id: 'r1' } },
  cutscene: { cmd: { cutscene: [{ set: 'cut' }, { say: ['ann', 'Hm.'] }] } }, choice: { cmd: { choice: [{ id: 'c-yes', text: 'Yes', do: [{ set: 'yes' }] }, { id: 'c-no', text: 'No', if: 'lever', do: [{ unset: 'yes' }] }] } },
  minigame: { cmd: { minigame: 'pick', then: [{ set: 'won' }] } }, phone: { cmd: { phone: 'bob', do: [{ say: ['bob', 'Hi.'] }, { set: 'called' }] } },
  guide: { cmd: { guide: { verb: 'take', target: 'lever', say: 'Try the lever.' } } }, talk: { cmd: { talk: 'cat' }, roomPatch: { talk: { cat: [{ topic: 'Hi?', do: [{ set: 'chat' }] }, { topic: 'Lever?', if: 'lever', do: [{ unset: 'chat' }] }] } } },
  hint: { cmd: { hint: true } }, ending: { cmd: { ending: true } }, reveal: { cmd: { reveal: true } }, end: { cmd: { end: true } },
};

type CondKey = 'string' | 'has' | 'flag' | 'not' | 'all' | 'any' | 'visited' | 'room' | 'prop' | 'unlocked' | 'seen' | 'actorIn' | 'player';
type CondObj = Exclude<Cond, string>;
type Unlisted = Exclude<CondObj, { [K in Exclude<CondKey, 'string'>]: Record<K, unknown> }[Exclude<CondKey, 'string'>]>;
const _everyCondListed: [Unlisted] extends [never] ? true : 'a Cond variant has no sample in COND_SAMPLES' = true;
void _everyCondListed;
/** One sample per condition: it gates the rule that sets `did`; the lever, the key, the box, the rooms and the cat can all change it. */
const COND_SAMPLES: Record<CondKey, Cond> = {
  string: '!lever', has: { has: 'key' }, flag: { flag: 'wet', eq: true }, not: { not: { has: 'key' } }, all: { all: ['lever', { not: { has: 'key' } }] },
  any: { any: ['wet', { prop: ['box', 'open'] }] }, visited: { visited: 'room1' }, room: { room: 'room0' }, prop: { prop: ['box', 'open'] },
  unlocked: { unlocked: 'p1' }, seen: { seen: 'lever' }, actorIn: { actorIn: ['cat', 'room0'] }, player: { player: 'bob' },
};

const expectSame = (a: AuditResult) => { expect(a.divergences).toEqual([]); expect(a.status).toBe('same'); };

describe('every command and every condition, audited', () => {
  for (const [key, s] of Object.entries(CMD_SAMPLES)) it(`command ${key}`, async () => {
    const { game, layouts } = harness({ rules: [{ verb: 'take', a: 'spot', if: 'lever', do: [s.cmd, did] }, { verb: 'look', a: 'box', do: [{ prop: ['box', 'shut'] }] }, { verb: 'take', a: 'box', do: [{ prop: ['box', 'open'] }] }], patch: s.patch, roomPatch: s.roomPatch });
    expectSame(await auditAbstractions(game, layouts, { commands, maxStates: 20000 }));
  }, 60000);
  for (const [key, cond] of Object.entries(COND_SAMPLES)) it(`condition ${key}`, async () => {
    const { game, layouts } = harness({ rules: [{ verb: 'use', a: 'lever', if: cond, do: [did] }, { verb: 'take', a: 'box', do: [{ cycle: [[{ prop: ['box', 'open'] }], [{ prop: ['box', 'shut'] }]], id: 'boxc' }, { set: 'seen_lever' }] }, { verb: 'look', a: 'lever', do: [{ unlock: 'p1' }] }, { verb: 'use', a: 'spot', do: [{ moveActor: ['cat', 'room1'] }] }] });
    expectSame(await auditAbstractions(game, layouts, { commands, maxStates: 20000 }));
  }, 60000);
});

describe('what the audit found', () => {
  // A rule that answers first shadows a later one on the same action while its condition holds: the flag that gates
  // the earlier rule decides which one answers, so it is part of the state even if the earlier rule only touches it.
  it('a flag that only gates a shadowing rule is live (seed 199)', async () => {
    const { game, layouts } = harness({ rules: [{ verb: 'take', a: 'spot', if: 'lever', do: [{ unset: 'lever' }] }, { verb: 'take', a: 'spot', do: [did] }], roomPatch: { exits: {} }, patch: { start: { room: 'room0', flags: { lever: true } } } });
    // Without the shadowing edges, `lever` (only read by the first rule, which only changes `lever`) looked dead: the
    // states before and after pulling the lever merged, and the path through the second rule was lost.
    const r = await solve(game, layouts, { mode: 'prove', memo: false, canonicalPlayers: false, mobility: false });
    expect(r.status).toBe('solved');
    const { game: g199, layouts: l199 } = randomGame(199);
    const a = await auditAbstractions(g199, l199, { maxStates: 20000 });
    expect(a.status).not.toBe('diverged');
  }, 120000);

  it('the rooms where another playable character stands are reached, abstractions on or off', async () => {
    const { game, layouts } = harness({ rules: [] });
    const on = await solve(structuredClone(game), layouts, { mode: 'prove' });
    const off = await solve(structuredClone(game), layouts, { mode: 'prove', canonicalPlayers: false, mobility: false });
    expect(on.profile.canonical.applied).toBe(true);
    expect(on.roomsReached).toEqual(off.roomsReached);
  }, 60000);

  it('a divergence fails the audit, and a truncated explicit search is partial, not a pass', async () => {
    const { game, layouts } = harness({ rules: [] });
    const lying = async (...args: Parameters<typeof solve>) => { const r = await solve(...args); if (args[2]?.memo !== false) r.flagsReached = [...r.flagsReached, 'ghost']; return r; };
    const bad = await auditAbstractions(game, layouts, { solver: lying });
    expect(bad).toMatchObject({ status: 'diverged', exit: 1 });
    expect(bad.divergences.join()).toContain('ghost');
    const cut = await auditAbstractions(game, layouts, { maxStates: 3 });
    expect(cut).toMatchObject({ status: 'partial', exit: 2 });
  }, 60000);
});
