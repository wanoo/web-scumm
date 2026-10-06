// The command catalogue (core/cmds.ts): every key of the `Cmd` union is known to the validator, the engine and the
// walkers. Adding a variant to `Cmd` without listing it in CMD_KEYS fails `tsc`; this test checks the runtime side.
import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core/engine';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import {
  CHANGES,
  CMD_KEYS,
  CONTAINERS,
  changesState,
  cmdKey,
  cmdLists,
  eachCmd,
  subLists,
  type CmdKey,
} from '@engine/core/cmds';
import type { Cmd, GameDef } from '@engine/core/types';
import type { CustomCommands } from '@engine/core/custom';
import { validate } from '@engine/tools/validate';
import { textPaths } from '@engine/tools/i18n';
import { mini, miniLayouts } from './fixtures/mini';

const commands: CustomCommands = { zap: { pure: true } };

/** A game where every instance below refers to something that exists. */
function stage(): GameDef {
  const g = mini();
  g.audio = { sfx: { ding: 'ding.mp3' }, music: { tune: 'tune.mp3' } };
  g.characters.uncle.room = 'a';
  g.players = { ids: ['hero', 'uncle'] };
  const a = g.rooms[0];
  a.props!.valise.anims = { wobble: { frames: ['o/valise'], fps: 8 } };
  a.props!.valise.states = { open: 'o/valise' };
  a.scripts = [{ id: 'tick', loop: true, do: [{ wait: 100 }] }];
  a.talk = { uncle: [{ topic: 'Hi', do: ['Hello.'] }] };
  g.rooms[1].actors = { uncle: { char: 'uncle' } };
  return g;
}
const layouts = { ...miniLayouts, b: { ...miniLayouts.b, actors: { uncle: { x: 200, y: 300, h: 110 } } } };

/** One minimal instance per command key. */
const instances: Record<CmdKey, Cmd> = {
  say: { say: ['hero', 'Hi.'] },
  walk: { walk: 'valise' },
  face: { face: 'left' },
  pose: { pose: ['uncle', 'front'] },
  anim: { anim: ['uncle', 'attack'], at: { 0: ['Go.'] } },
  place: { place: ['hero', [100, 300]] },
  wait: { wait: 10 },
  parallel: { parallel: [['One.'], ['Two.']] },
  camera: { camera: 'follow' },
  play: { play: ['valise', 'wobble'] },
  stopAnim: { stopAnim: 'valise' },
  prop: { prop: ['valise', 'open'] },
  show: { show: 'uncle' },
  hide: { hide: 'uncle' },
  gain: { gain: 'cle' },
  lose: { lose: 'cle' },
  used: { used: 'cle' },
  set: { set: 'seen_it' },
  unset: { unset: 'seen_it' },
  inc: { inc: 'count' },
  unlock: { unlock: 'nowhere' },
  goto: { goto: 'b' },
  map: { map: true },
  moveActor: { moveActor: ['uncle', 'b'] },
  emit: { emit: 'ping' },
  waitUntil: { waitUntil: { has: 'cle' } },
  waitEvent: { waitEvent: 'ping' },
  switchPlayer: { switchPlayer: 'uncle' },
  transfer: { transfer: ['cle', 'uncle'] },
  custom: { custom: 'zap' },
  startScript: { startScript: 'tick' },
  stopScript: { stopScript: 'tick' },
  launch: { launch: { target: 'valise', to: [300, 320] } },
  spring: { spring: { target: 'valise' } },
  path: {
    path: {
      target: 'hero',
      points: [
        [100, 300],
        [200, 280],
        [300, 320],
      ],
    },
  },
  follow: { follow: { target: 'uncle', leader: 'hero', ms: 100 } },
  sfx: { sfx: 'ding' },
  music: { music: 'tune' },
  toast: { toast: 'Done.' },
  shake: { shake: 2 },
  if: { if: 'seen_it', then: ['Yes.'], else: ['No.'] },
  once: { once: ['Once.'] },
  nth: { nth: [['First.'], ['Then.']] },
  cycle: { cycle: [['A.'], ['B.']] },
  random: { random: [['A.'], ['B.']] },
  cutscene: { cutscene: ['Scene.'] },
  choice: { choice: [{ text: 'Ok', do: ['Fine.'] }] },
  minigame: { minigame: 'pipes', then: ['Won.'] },
  phone: { phone: 'ann', do: ['Ring.'] },
  guide: { guide: { verb: 'look', target: 'valise', say: 'Look at it.' } },
  talk: { talk: 'uncle' },
  hint: { hint: true },
  ending: { ending: true, after: ['Yay.'] },
  reveal: { reveal: true, after: ['Again.'] },
  end: { end: true },
};

describe('the command catalogue', () => {
  it('names every command', () => {
    for (const k of CMD_KEYS) expect(cmdKey(instances[k])).toBe(k);
    expect(cmdKey('A line.')).toBeUndefined();
  });

  it('is what the validator knows', () => {
    const g = stage();
    g.rooms[0].on!.push({ verb: 'look', a: 'valise', do: CMD_KEYS.map((k) => instances[k]) });
    const r = validate(g, layouts, { commands });
    expect(r.errors.filter((e) => /unknown command/.test(e))).toEqual([]);
    // the one error expected: a sealed ending without the ending module, the unknown map place
    expect(r.errors.filter((e) => !/sealed ending|map place/.test(e))).toEqual([]);
  });

  it('is what the engine runs', async () => {
    // `guide` waits for the player, the sealed ending needs its module: the rest runs in node as is.
    const skip = new Set<CmdKey>(['guide', 'ending', 'reveal']);
    for (const k of CMD_KEYS) {
      if (skip.has(k)) continue;
      const e = new Engine(stage(), layouts, new FakePresenter(), new MemoryStore(), { commands });
      await e.newGame();
      await expect(e.script([instances[k]]), k).resolves.toBeUndefined();
    }
  });

  it('reaches into every container', () => {
    for (const k of CONTAINERS) {
      const c = instances[k];
      expect(subLists(c).length, k).toBeGreaterThan(0);
      const found: string[] = [];
      eachCmd([c], (x, path) => {
        if (typeof x === 'string') found.push(path);
      });
      expect(found.length, k).toBeGreaterThan(0);
      expect(found[0]).toMatch(/^\[0\]\.\w+/);
    }
    for (const k of CMD_KEYS) if (!CONTAINERS.has(k)) expect(subLists(instances[k]), k).toEqual([]);
    expect(changesState([{ once: [{ if: 'x', then: [{ gain: 'cle' }] }] }])).toBe(true);
    expect(changesState([{ once: ['Just a line.', { sfx: 'ding' }] }])).toBe(false);
    for (const k of CHANGES) expect(CMD_KEYS).toContain(k);
  });

  it('lists every command list of the game, with the paths the translation tables use', () => {
    const g = stage();
    const lists = cmdLists(g);
    expect(lists.map((l) => l.path)).toEqual([
      'room:a/on[0].do',
      'room:a/talk.uncle[0].do',
      'room:a/scripts.tick.do',
      'room:b/on[0].do',
    ]);
    expect(lists[2].script).toBe(true);
    // the texts walker follows the same convention
    const paths = textPaths(g).map((p) => p.path);
    expect(paths).toContain('room:a/on[0].do[1]');
    expect(paths).toContain('room:a/talk.uncle[0].do[0]');
  });
});
