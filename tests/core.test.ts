// Generic engine tests, on the fixture game (tests/fixture) and a dummy game written here.
import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core/engine';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import { check } from '@engine/core/cond';
import type { GameDef, GameState, Layout } from '@engine/core/types';
import { validate } from '@engine/tools/validate';
import { solve } from '@engine/tools/solve';
import { migrate } from '@engine/core/migrate';
import { toDot, toSvg, worldGraph } from '@engine/tools/graph';
import { report, reportMarkdown } from '@engine/tools/report';
import { minigames } from '@engine/minigames';
import { game, layouts } from './fixture';

const tick = () => new Promise((r) => setTimeout(r, 0));

function boot(g: GameDef = game) {
  const ui = new FakePresenter();
  const store = new MemoryStore();
  const e = new Engine(structuredClone(g), layouts, ui, store);
  e.random = () => 0;
  return { e, ui, store };
}

describe('conditions', () => {
  it('evaluates flags, items, negations and combinations', () => {
    const { e } = boot();
    const s = e.fresh();
    s.flags.a = true; s.inventory = ['coin']; s.props['house.lamp'] = 'on';
    expect(check('a', s)).toBe(true);
    expect(check('!a', s)).toBe(false);
    expect(check({ has: 'coin' }, s)).toBe(true);
    expect(check({ all: ['a', { prop: ['lamp', 'on'] }] }, s, 'house')).toBe(true);
    expect(check({ any: ['b', { not: 'a' }] }, s)).toBe(false);
  });
});

describe('fixture game', () => {
  it('the guided tutorial refuses other actions then advances', async () => {
    const { e, ui } = boot();
    const started = e.newGame();
    await tick();
    expect(e.guiding).toEqual({ verb: 'look', target: 'lamp' });
    await e.act({ verb: 'take', a: 'lamp' });
    expect(ui.log.at(-1)).toBe('hero: Look at the lamp first.');
    await e.act({ verb: 'look', a: 'lamp' });
    await started;
    expect(e.guiding).toBeNull();
    expect(ui.log).toContain('hero: A lamp.');
  });

  it('the drawer → coin → Grandma chain gives the key and unlocks a place', async () => {
    const { e } = boot();
    await e.checkpoint('free');
    expect(await e.act({ verb: 'open', a: 'drawer' })).toBe('rule');
    expect(e.state.inventory).toContain('coin');
    expect(await e.act({ verb: 'open', a: 'drawer' })).toBe('fallback');
    await e.act({ verb: 'give', a: 'coin', b: 'grandma' });
    expect(e.state.inventory).toEqual(['talkie', 'key']);
    expect(e.state.unlocked).toContain('garden');
    await e.act({ verb: 'use', a: 'door' });
    expect(e.state.room).toBe('garden');
  });

  it('fallback responses follow the order: kind, refuse, fallback', async () => {
    const { e, ui } = boot();
    await e.checkpoint('free');
    expect(await e.act({ verb: 'take', a: 'grandma' })).toBe('kind');
    expect(ui.log.at(-1)).toBe('hero: I cannot carry Grandma.');
    expect(await e.act({ verb: 'give', a: 'talkie', b: 'grandma' })).toBe('refuse');
    expect(ui.log.at(-1)).toBe('grandma: No thanks, dear.');
    expect(await e.act({ verb: 'push', a: 'drawer' })).toBe('fallback');
    const first = ui.log.at(-1);
    await e.act({ verb: 'push', a: 'drawer' });
    expect(ui.log.at(-1)).not.toBe(first);
    await e.act({ verb: 'open', a: 'drawer' });
    expect(await e.act({ verb: 'use', a: 'coin', b: 'talkie' })).toBe('fallback');
    expect(ui.log.at(-1)).toBe('hero: These do not go together.');
  });

  it('list looks rotate, topics get marked as seen', async () => {
    const { e, ui } = boot();
    await e.checkpoint('free');
    await e.act({ verb: 'look', a: 'drawer' });
    await e.act({ verb: 'look', a: 'drawer' });
    expect(ui.log.at(-1)).toBe('hero: Still an old drawer.');
    ui.picks = [0, 3];
    await e.act({ verb: 'talk', a: 'grandma' });
    expect(e.state.seen['house.grandma.0']).toBe(1);
    expect(ui.log).toContain('grandma: Bring me a coin.');
    expect(ui.log.at(-1)).toBe('hero: See you!');
  });

  it('hints follow progress', async () => {
    const { e, ui } = boot();
    await e.checkpoint('free');
    await e.act({ verb: 'talk', a: 'talkie' });
    expect(ui.log.at(-1)).toBe('hero: Look in the drawer.');
    await e.act({ verb: 'talk', a: 'talkie' });
    expect(ui.log.at(-1)).toBe('hero: The DRAWER.');
    e.state.flags.coin_found = true;
    await e.act({ verb: 'talk', a: 'talkie' });
    expect(ui.log.at(-1)).toBe('hero: Grandma wants the coin.');
  });

  it('the save resumes the state', async () => {
    const { e, store, ui } = boot();
    await e.checkpoint('free');
    await e.act({ verb: 'use', a: 'lamp' });
    await e.act({ verb: 'open', a: 'drawer' });
    const e2 = new Engine(structuredClone(game), layouts, ui, store);
    await e2.continueGame();
    expect(e2.state.inventory).toContain('coin');
    expect(e2.propState('lamp')).toBe('on');
  });

  it('the computed approach point does not go below the layout floor', async () => {
    const { e } = boot();
    await e.checkpoint('free');
    await e.script([{ goto: 'garden' }]);
    expect(e.approach('shed')).toEqual([460, 380]);
  });

  it('{ ending } and the old { reveal } play the ending, then the lines, then the card', async () => {
    for (const cmd of [{ ending: true as const }, { reveal: true as const }]) {
      const { e, ui } = boot();
      await e.checkpoint('free');
      await e.script([{ ...cmd, after: ['Hourra !'] }]);
      expect(ui.log.slice(-2)).toEqual(['ENDING', 'hero: Hourra !']);
    }
  });
});

describe('validator', () => {
  const minigameParams = Object.fromEntries(Object.entries(minigames).map(([k, m]) => [k, m.required ?? []]));

  it('the fixture game has no error', () => {
    const { errors } = validate(game, layouts, { minigameIds: Object.keys(minigames), minigameParams });
    expect(errors).toEqual([]);
  });

  it('flags a minigame missing its required params', () => {
    const g = structuredClone(game);
    g.rooms[1].on![0].do = [{ minigame: 'pipes', params: { tiles: {} } }, { minigame: 'hide' }];
    const { errors } = validate(g, layouts, { minigameIds: Object.keys(minigames), minigameParams });
    expect(errors).toEqual([
      'garden.on[0][0] › minigame "pipes": missing required param "source"',
      'garden.on[0][0] › minigame "pipes": missing required param "nozzle"',
      'garden.on[0][0] › minigame "pipes": missing required param "tank"',
      'garden.on[0][1] › minigame "hide": missing required param "spots"',
    ]);
  });

  it('checks the skin\'s images and sounds, and the sealed ending', () => {
    const g = structuredClone(game);
    g.skin.icons.spark = 'ui/nope';
    g.skin.sounds = { phone: 'ring', jingle: 'tada' };
    g.ending = { file: 'data/x.bin', password: { given: 'X' }, scratch: {} };
    const { errors } = validate(g, layouts, { minigameParams, assets: { images: { 'ui/map': [1, 1], 'ui/pause': [1, 1], 'ui/music': [1, 1] } } });
    expect(errors.filter((x) => x.startsWith('skin') || x.startsWith('ending'))).toEqual([
      'skin.icons.spark › image not found: "ui/nope"',
      'skin.sounds.phone › unknown sound effect: "ring"',
      'skin.sounds.jingle › unknown music: "tada"',
      'ending.scratch › minigame "scratch": missing required param "ticket"',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Dummy game: two-way phone call, used items, actor cutscene.
// ---------------------------------------------------------------------------

function mini(): GameDef {
  return {
    id: 'mini', title: 'Mini', saveVersion: 1, hero: 'hero',
    verbs: [{ id: 'look', label: 'Look', color: '#fff' }, { id: 'use', label: 'Use', color: '#fff', join: 'with' }, { id: 'give', label: 'Give', color: '#fff', join: 'to' }],
    characters: {
      hero: { name: 'Hero', color: '#fff', sprites: { idle: ['h/1'] } },
      voice: { name: 'Voice', color: '#f0f', offscreen: true },
      ann: { name: 'Ann', color: '#0ff', height: 108, sprites: { idle: ['m/1'], phone: ['m/2'] }, mouths: { phone: { closed: 'tm/1', open: ['tm/2', 'tm/3'] } } },
      bea: { name: 'Bea', color: '#ff0', height: 84, sprites: { idle: ['p/1'], phone: ['p/2'] } },
      uncle: { name: 'Uncle', color: '#0f0', sprites: { idle: ['pa/1'], front: ['pa/2'], attack: ['pa/3'] } },
    },
    items: { cle: { name: 'key', icon: 'i/cle' }, badge: { name: 'badge', icon: 'i/badge' } },
    rooms: [
      { id: 'a', name: 'A', decor: 'd/a',
        props: { valise: { img: 'o/valise', name: 'suitcase' } },
        actors: { uncle: { char: 'uncle', pose: 'front' } },
        on: [{ verb: 'use', a: 'cle', b: 'valise', do: [{ used: 'cle' }, 'Opened.'] }] },
      { id: 'b', name: 'B', decor: 'd/b',
        props: { cadenas: { img: 'o/cadenas', name: 'padlock' } },
        on: [{ verb: 'use', a: ['cle', 'badge'], b: 'cadenas', do: ['No, not that.'] }] },
    ],
    rules: { fallbacks: { look: ['Nothing.'], use: ['No.'], use2: ['These do not go together.'] } },
    start: { room: 'a', inventory: ['cle', 'badge'] },
    skin: { icons: { map: 'ui/map', pause: 'ui/pause', music: 'ui/music' } },
    ui: {} as GameDef['ui'],
  };
}

const miniLayouts: Record<string, Layout> = {
  a: { entries: { default: [320, 360] }, props: { valise: { x: 300, y: 340, h: 40, rot: 13, flipV: true, states: {} } }, actors: { uncle: { x: 200, y: 300, h: 110, z: 500 } } },
  b: { entries: { default: [320, 360] }, props: { cadenas: { x: 300, y: 340, h: 40 } } },
};

function bootMini() {
  const ui = new FakePresenter();
  const store = new MemoryStore();
  const e = new Engine(mini(), miniLayouts, ui, store);
  e.random = () => 0;
  return { e, ui, store };
}

describe('two-way phone call', () => {
  it('accepts a list of callers, then plays the dialogue', async () => {
    const { e, ui } = bootMini();
    await e.newGame();
    await e.script([{ phone: ['ann', 'bea'], do: [{ say: ['bea', 'Hello?'] }, { say: ['ann', 'Wait, Bea.'] }] }]);
    const i = ui.log.indexOf('phone ann+bea');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(ui.log.slice(i)).toEqual(['phone ann+bea', 'bea: Hello?', 'ann: Wait, Bea.', 'phone ann+bea']);
  });

  it('stays compatible with a single caller', async () => {
    const { e, ui } = bootMini();
    await e.newGame();
    await e.script([{ phone: 'voice', do: [{ say: ['voice', 'Hello.'] }] }]);
    expect(ui.log).toContain('phone voice');
  });

  it('the validator checks each caller', () => {
    const g = mini();
    g.rooms[0].onEnter = [{ phone: ['ann', 'bea'], do: [] }, { phone: ['ann', 'inconnue'], do: [] }];
    const { errors } = validate(g, miniLayouts);
    expect(errors).toEqual(['a.onEnter[1] › unknown character: "inconnue"']);
  });
});

describe('used items', () => {
  it('stay in the inventory, greyed out unless a rule targets them, and gain re-enables them', async () => {
    const { e, ui, store } = bootMini();
    await e.newGame();
    expect(e.usedLocked('cle')).toBe(false);
    await e.act({ verb: 'use', a: 'cle', b: 'valise' });
    expect(e.state.inventory).toContain('cle');
    expect(e.state.used).toEqual(['cle']);
    expect(e.isUsed('cle')).toBe(true);
    // room a's rule still targets the key (use cle → valise): it stays active here
    expect(e.usedLocked('cle')).toBe(false);
    await e.script([{ goto: 'b' }]);
    expect(e.usedLocked('cle')).toBe(false); // the lock explicitly targets it
    e.game.rooms[1].on = [];
    expect(e.usedLocked('cle')).toBe(true);
    expect(e.usedLocked('badge')).toBe(false);
    // save
    const e2 = new Engine(mini(), miniLayouts, ui, store);
    await e2.continueGame();
    expect(e2.state.used).toEqual(['cle']);
    await e.script([{ used: ['badge', 'cle'] }]);
    expect(e.state.used).toEqual(['cle', 'badge']);
    await e.script([{ gain: 'cle' }]);
    expect(e.state.used).toEqual(['badge']);
  });

  it('an old save without "used" loads successfully', async () => {
    const { e, store, ui } = bootMini();
    await e.newGame();
    const old = store.load()!;
    delete old.used;
    store.save(old);
    const e2 = new Engine(mini(), miniLayouts, ui, store);
    await e2.continueGame();
    expect(e2.usedLocked('cle')).toBe(false);
  });

  it('the validator knows "used", "rot", "flipV" and actors\' "z"', () => {
    const g = mini();
    g.rooms[0].onEnter = [{ used: 'cle' }, { used: ['badge'] }, { used: 'licorne' }];
    const { errors } = validate(g, miniLayouts);
    expect(errors).toEqual(['a.onEnter[2] › unknown item: "licorne"']);
  });
});

describe('actor cutscene', () => {
  it('walk and anim work for an actor in the front pose', async () => {
    const { e, ui } = bootMini();
    await e.newGame();
    await e.script([{ walk: [300, 380], who: 'uncle' }, { anim: ['uncle', 'attack'], ms: 600 }, { face: 'left', who: 'uncle' }]);
    expect(ui.log).toContain('walk uncle 300,380');
    expect(e.state.actors['a.uncle']).toMatchObject({ x: 300, y: 380, facing: 'left' });
    const { errors, warnings } = validate(mini(), miniLayouts);
    expect(errors).toEqual([]);
    expect(warnings.filter((w) => w.includes('attack'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The world lives: a moving character, events, scripts.
// ---------------------------------------------------------------------------

function world(): GameDef {
  return {
    id: 'world', title: 'World', saveVersion: 1, hero: 'hero',
    verbs: [{ id: 'look', label: 'Look', color: '#fff' }, { id: 'use', label: 'Use', color: '#fff', join: 'with' }, { id: 'talk', label: 'Talk', color: '#fff' }],
    characters: {
      hero: { name: 'Hero', color: '#fff', sprites: { idle: ['h/1'] } },
      cook: { name: 'Cook', color: '#0f0', room: 'kitchen', sprites: { idle: ['c/1'] } },
    },
    items: {},
    rooms: [
      { id: 'hall', name: 'Hall', decor: 'd/hall',
        actors: { cook: { char: 'cook' } },
        hotspots: { door: { name: 'door' }, gong: { name: 'gong' } },
        look: { door: 'A door.', gong: 'A gong.', cook: 'The cook.' },
        on: [
          { verb: 'use', a: 'door', do: [{ goto: 'kitchen' }] },
          { verb: 'use', a: 'gong', do: [{ emit: 'gong' }] },
          { verb: 'talk', a: 'cook', if: { actorIn: ['cook', 'hall'] }, do: [{ say: ['cook', 'Dinner!'] }, { set: 'dinner' }, { end: true }] },
        ],
        events: [{ on: 'gong', once: true, do: [{ set: 'rang' }] }],
        scripts: [{ id: 'hall_clock', loop: true, do: [{ wait: 1000 }, { inc: 'ticks' }] }],
      },
      { id: 'kitchen', name: 'Kitchen', decor: 'd/kitchen',
        actors: { cook: { char: 'cook' } },
        hotspots: { door: { name: 'door' } },
        look: { door: 'A door.', cook: 'The cook, cooking.' },
        on: [{ verb: 'use', a: 'door', do: [{ goto: 'hall' }] }],
      },
    ],
    scripts: [{ id: 'cook_comes', do: [{ waitEvent: 'gong' }, { moveActor: ['cook', 'hall'] }, { toast: 'The cook comes.' }] }],
    events: [{ on: 'gong', do: [{ inc: 'gongs' }] }],
    rules: { fallbacks: { look: ['Nothing.'], use: ['No.'], talk: ['...'], use2: ['No.'] } },
    start: { room: 'hall' },
    skin: { icons: { map: 'ui/map', pause: 'ui/pause', music: 'ui/music' } },
    ui: {} as GameDef['ui'],
  };
}

const worldLayouts: Record<string, Layout> = {
  hall: { entries: { default: [320, 360] }, actors: { cook: { x: 200, y: 300, h: 100 } }, hotspots: { door: { rect: [0, 0, 50, 50] }, gong: { rect: [100, 0, 50, 50] } } },
  kitchen: { entries: { default: [320, 360] }, actors: { cook: { x: 400, y: 320, h: 100 } }, hotspots: { door: { rect: [0, 0, 50, 50] } } },
};

function bootWorld(g: GameDef = world()) {
  const ui = new FakePresenter();
  const store = new MemoryStore();
  const e = new Engine(g, worldLayouts, ui, store);
  e.random = () => 0;
  return { e, ui, store };
}

describe('the world lives', () => {
  it('a moving character only shows in the room it is in', async () => {
    const { e } = bootWorld();
    await e.newGame();
    expect(e.state.where).toEqual({ cook: 'kitchen' });
    expect(e.visible('cook')).toBe(false);
    expect(e.targets()).toEqual(['door', 'gong']);
    await e.act({ verb: 'use', a: 'door' });
    expect(e.state.room).toBe('kitchen');
    expect(e.visible('cook')).toBe(true);
    expect(check({ actorIn: ['cook', 'kitchen'] }, e.state)).toBe(true);
  });

  it('emit runs the room listeners, then the game ones; once is once', async () => {
    const { e } = bootWorld();
    await e.newGame();
    await e.act({ verb: 'use', a: 'gong' });
    expect(e.state.flags).toEqual({ rang: true, gongs: 1 });
    await e.act({ verb: 'use', a: 'gong' });
    expect(e.state.flags).toEqual({ rang: true, gongs: 2 });
    expect(e.state.seen['event.hall.0']).toBe(1);
  });

  it('a script waits for an event, then moves the character into the room on screen', async () => {
    const { e, ui } = bootWorld();
    await e.newGame();
    expect(await e.runScript('cook_comes')).toBe(false);
    expect(e.scriptState('cook_comes')).toEqual({ pc: 0 });
    expect(await e.act({ verb: 'talk', a: 'cook' })).toBe('fallback'); // not here yet
    await e.act({ verb: 'use', a: 'gong' });
    expect(e.scriptState('cook_comes').pc).toBe(1); // past the waitEvent
    expect(await e.runScript('cook_comes')).toBe(true);
    expect(e.state.where).toEqual({ cook: 'hall' });
    expect(e.state.actors['hall.cook']).toEqual({});
    expect(e.visible('cook')).toBe(true);
    expect(ui.log.slice(-2)).toEqual(['show cook', 'toast The cook comes.']);
    expect(e.scriptState('cook_comes')).toEqual({ pc: 3, done: true });
    expect(await e.runScript('cook_comes')).toBe(false);
    expect(await e.act({ verb: 'talk', a: 'cook' })).toBe('rule');
    expect(e.state.done).toBe(true);
  });

  it('a loop script runs one iteration at a time, resumes from the save, and can be stopped and restarted', async () => {
    const { e, store } = bootWorld();
    await e.newGame();
    expect(await e.runScript('hall_clock')).toBe(true);
    expect(e.state.flags.ticks).toBe(1);
    expect(e.scriptState('hall_clock')).toEqual({ pc: 0 });
    await e.runScript('hall_clock');
    expect(e.state.flags.ticks).toBe(2);
    await e.script([{ stopScript: 'hall_clock' }]);
    expect(await e.runScript('hall_clock')).toBe(false);
    e.save();
    const e2 = new Engine(world(), worldLayouts, new FakePresenter(), store);
    await e2.continueGame();
    expect(e2.scriptState('hall_clock')).toEqual({ pc: 0, off: true });
    await e2.script([{ startScript: 'hall_clock' }]);
    expect(await e2.runScript('hall_clock')).toBe(true);
    expect(e2.state.flags.ticks).toBe(3);
  });

  it('scripts pause while the engine is busy, and the while condition rewinds them', async () => {
    const g = world();
    g.rooms[0].scripts = [{ id: 'guard', loop: true, while: '!dinner', do: [{ set: 'step1' }, { wait: 10 }, { set: 'step2' }] }];
    const { e } = bootWorld(g);
    await e.newGame();
    expect(await e.advance('guard')).toBe('ran');
    e.state.flags.dinner = true;
    expect(await e.advance('guard')).toBe('blocked');
    expect(e.scriptState('guard').pc).toBe(0);
    delete e.state.flags.dinner;
    // busy: a player action in progress
    const p = e.act({ verb: 'look', a: 'gong' });
    expect(await e.advance('guard')).toBe('blocked');
    await p;
    expect(await e.runScript('guard')).toBe(true);
    expect(e.state.flags).toMatchObject({ step1: true, step2: true });
  });

  it('the validator knows the world', () => {
    expect(validate(world(), worldLayouts).errors).toEqual([]);
    const g = world();
    g.characters.cook.room = undefined;
    g.rooms[0].scripts!.push({ id: 'spin', loop: true, do: [{ set: 'x' }] }, { id: 'hall_clock', do: ['dup'] });
    g.rooms[0].on!.push({ verb: 'use', a: 'gong', do: [{ startScript: 'nope' }, { emit: 'silence' }] });
    const { errors, warnings } = validate(g, worldLayouts);
    expect(errors).toEqual([
      'hall.scripts › duplicate script id: "hall_clock" (also in hall.scripts)',
      'scripts[0].do[1] › character "cook" has no starting room ("room" in its definition), needed to move it between rooms',
      'hall.on[2] › character "cook" has no starting room ("room" in its definition), needed to move it between rooms',
      'hall.scripts[1] › loop script "spin" never waits (add a wait, waitUntil or waitEvent)',
      'hall.on[3][0] › unknown script: "nope"',
    ]);
    expect(warnings).toContain('hall.on[3][1] › event "silence" is emitted but nothing listens to it');
  });

  it('the solver lets scripts run and finishes the game through them', async () => {
    const r = await solve(world(), worldLayouts, { maxStates: 500 });
    expect(r.finished).toBe(true);
    // The clock may tick along the way (it is a state the player can reach by waiting); the beats are in order.
    expect(r.path.filter((x) => x !== 'Script hall_clock')).toEqual(['Use gong', 'Script cook_comes', 'Talk cook']);
    expect(r.truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scale: declared exits, the world's map, chapters and invariants, migrations, the profiler.
// ---------------------------------------------------------------------------

function scale(): GameDef {
  return {
    id: 'scale', title: 'Scale', saveVersion: 3, hero: 'hero',
    verbs: [{ id: 'look', label: 'Look', color: '#fff' }, { id: 'open', label: 'Open', color: '#fff' }, { id: 'use', label: 'Use', color: '#fff', join: 'with' }, { id: 'take', label: 'Take', color: '#fff' }],
    characters: { hero: { name: 'Hero', color: '#fff', sprites: { idle: ['h/1'] } } },
    items: { key: { name: 'key', icon: 'i/key', look: 'A key.' }, gem: { name: 'gem', icon: 'i/gem', look: 'A gem.' } },
    rooms: [
      { id: 'hall', name: 'Hall', decor: 'd/hall',
        hotspots: { mat: { name: 'mat' } },
        exits: { door: { name: 'door', to: 'yard', entry: 'from_hall', if: { has: 'key' }, locked: 'Locked.', sfx: 'creak' } },
        look: { mat: 'A mat.', door: 'A door.' },
        on: [{ verb: 'take', a: 'mat', if: '!key_found', do: [{ gain: 'key' }, { set: 'key_found' }] }],
        hints: [{ until: { has: 'key' }, lines: ['Under the mat.'] }] },
      { id: 'yard', name: 'Yard', decor: 'd/yard',
        hotspots: { well: { name: 'well' } },
        exits: { back: { name: 'back door', to: 'hall', oneWay: true } },
        look: { well: 'A well.', back: 'The door.' },
        on: [{ verb: 'use', a: 'well', do: [{ gain: 'gem' }, { goto: 'attic' }] }],
        hints: [{ until: 'never', lines: ['Use the well.'] }] },
      { id: 'attic', name: 'Attic', decor: 'd/attic', hotspots: { chest: { name: 'chest' } }, look: { chest: 'A chest.' },
        on: [{ verb: 'use', a: 'gem', b: 'chest', do: ['Done.', { end: true }] }], hints: [{ until: 'never', lines: ['The chest.'] }] },
      { id: 'cellar', name: 'Cellar', decor: 'd/cellar', hotspots: { barrel: { name: 'barrel' } }, look: { barrel: 'A barrel.' } },
    ],
    rules: { fallbacks: { look: ['Nothing.'], open: ['No.'], use: ['No.'], take: ['No.'], use2: ['No.'] } },
    audio: { sfx: { creak: 'creak.mp3' } },
    start: { room: 'hall' },
    checkpoints: {
      yard: { room: 'yard', inventory: ['key'], flags: { key_found: true }, goals: [{ has: 'key' }, { room: 'yard' }] },
    },
    invariants: [{ all: [{ has: 'gem' }, { not: { has: 'key' } }] }],
    migrations: [
      { from: 1, renameFlag: { found: 'key_found' }, renameItem: { cle: 'key' } },
      { from: 2, renameRoom: { lobby: 'hall' }, dropFlag: ['tmp'] },
    ],
    saves: { slots: 2 },
    skin: { icons: { map: 'ui/map', pause: 'ui/pause', music: 'ui/music' } },
    ui: {} as GameDef['ui'],
  };
}
const scaleLayouts: Record<string, Layout> = {
  hall: { entries: { default: [320, 360] }, hotspots: { mat: { rect: [10, 10, 50, 50] }, door: { rect: [100, 10, 50, 50] } } },
  yard: { entries: { default: [320, 360], from_hall: [40, 360] }, hotspots: { well: { rect: [10, 10, 50, 50] }, back: { rect: [100, 10, 50, 50] } } },
  attic: { entries: { default: [320, 360] }, hotspots: { chest: { rect: [10, 10, 50, 50] } } },
  cellar: { entries: { default: [320, 360] }, hotspots: { barrel: { rect: [10, 10, 50, 50] } } },
};

describe('scale: exits, chapters, saves', () => {
  it('a declared exit is a hotspot with a goto rule, locked until its condition holds', async () => {
    const ui = new FakePresenter();
    const e = new Engine(scale(), scaleLayouts, ui, new MemoryStore());
    await e.newGame();
    expect(e.targets()).toEqual(['mat', 'door']);
    expect(e.nameOf('door')).toBe('door');
    expect(e.kindsOf('door')).toEqual(['exit']);
    expect(await e.act({ verb: 'open', a: 'door' })).toBe('rule');
    expect(ui.log.at(-1)).toBe('hero: Locked.');
    await e.act({ verb: 'take', a: 'mat' });
    await e.act({ verb: 'open', a: 'door' });
    expect(e.state.room).toBe('yard');
    expect(e.state.hero.yard).toEqual([40, 360]);
    expect(ui.log).toContain('sfx creak');
    expect(await e.act({ verb: 'look', a: 'back' })).toBe('look');
    expect(ui.log.at(-1)).toBe('hero: The door.');
  });

  it('the validator and the world graph see unreachable rooms and missing ways back', () => {
    const g = worldGraph(scale());
    expect(g.unreachable).toEqual(['cellar']);
    expect(g.edges.filter((e) => e.kind === 'exit').map((e) => `${e.from}>${e.to}`)).toEqual(['hall>yard', 'yard>hall']);
    expect(g.edges.filter((e) => e.kind === 'goto').map((e) => `${e.from}>${e.to}:${e.via}`)).toEqual(['yard>attic:on[0][1]']);
    expect(toDot(g)).toContain('"yard" -> "attic"');
    expect(toSvg(g)).toContain('unreachable');
    const { errors, warnings } = validate(scale(), scaleLayouts);
    expect(errors).toEqual([]);
    expect(warnings).toContain('cellar › no exit, goto or map place leads to this room from the start');
    expect(warnings.filter((w) => w.includes('no way back'))).toEqual([]); // yard.back is oneWay; hall.door has a way back through it
    const g2 = scale();
    g2.rooms[1].exits!.back.oneWay = false;
    g2.rooms[1].on = [];
    expect(validate(g2, scaleLayouts).warnings.filter((w) => w.includes('no way back'))).toEqual([]);
    g2.rooms[1].exits = {};
    expect(validate(g2, scaleLayouts).warnings).toContain('hall.exits.door › no way back from yard to hall (add oneWay: true if intended)');
    g2.rooms[0].hotspots!.door = { name: 'twice' };
    expect(validate(g2, scaleLayouts).errors).toContain('hall.exits.door › "door" is both an exit and a hotspot');
  });

  it('the solver proves a chapter by its goals and reports broken invariants', async () => {
    const r = await solve(scale(), scaleLayouts, { goal: scale().checkpoints!.yard.goals });
    expect(r.finished).toBe(true);
    expect(r.path).toEqual(['Take mat', 'Open door']);
    const r2 = await solve(scale(), scaleLayouts, { start: { checkpoint: 'yard' } });
    expect(r2.finished).toBe(true);
    expect(r2.broken).toEqual([]);
    const g = scale();
    g.invariants = [{ has: 'gem' }];
    const r3 = await solve(g, scaleLayouts, { start: { checkpoint: 'yard' } });
    expect(r3.broken).toEqual([{ invariant: 0, path: ['Use well'] }]);
  });

  it('migrates an old save step by step, and refuses one with no path', () => {
    const g = scale();
    const old = { v: 1, room: 'lobby', inventory: ['cle'], flags: { found: true, tmp: 1 }, props: {}, actors: {}, hero: { lobby: [1, 2] as [number, number] }, unlocked: [], visited: { lobby: 1 }, counters: {}, seen: {}, started: 0 };
    const s = migrate(g, old as GameState)!;
    expect(s.v).toBe(3);
    expect(s.room).toBe('hall');
    expect(s.inventory).toEqual(['key']);
    expect(s.flags).toEqual({ key_found: true });
    expect(s.hero).toEqual({ hall: [1, 2] });
    expect(s.visited).toEqual({ hall: 1 });
    expect(old.v).toBe(1); // untouched
    expect(migrate(g, { ...old, v: 0 } as GameState)).toBeNull();
    const e = new Engine(g, scaleLayouts, new FakePresenter(), new MemoryStore());
    e.store.save(old as GameState);
    expect(e.hasSave()).toBe(true);
    const { errors, warnings } = validate(g, scaleLayouts);
    expect(errors).toEqual([]);
    expect(warnings.filter((w) => w.startsWith('migrations'))).toEqual([]);
    g.migrations = [{ from: 1 }];
    expect(validate(g, scaleLayouts).warnings).toContain('migrations › no migration from version 2: those saves start a new game');
    g.migrations = [{ from: 3, renameItem: { a: 'nope' } }];
    expect(validate(g, scaleLayouts).errors).toEqual(['migrations[0] › from 3 is not below saveVersion 3', 'migrations[0] › renamed item does not exist: "nope"']);
  });

  it('the content report counts what matters', () => {
    const r = report(scale(), scaleLayouts);
    expect(r.totals.rooms).toBe(4);
    expect(r.rooms[0]).toMatchObject({ id: 'hall', hotspots: 1, exits: 1, rules: 1, noLook: [] });
    expect(r.rooms[3].verbsUnused).toEqual(['open', 'take']);
    expect(r.items.find((i) => i.id === 'gem')).toMatchObject({ gainedIn: ['yard'], usedIn: 1, consumed: false });
    expect(r.world).toEqual({ unreachable: ['cellar'], oneWay: [] });
    const md = reportMarkdown(r);
    expect(md).toContain('**Unreachable rooms:** cellar');
    expect(md).toContain('| Hall (hall) | 1 | 0 | 0 | 1 | 1 |');
  });
});
