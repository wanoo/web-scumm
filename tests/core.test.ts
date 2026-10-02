// Generic engine tests, on the fixture game (tests/fixture) and a dummy game written here.
import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core/engine';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import { check } from '@engine/core/cond';
import type { GameDef, Layout } from '@engine/core/types';
import { validate } from '@engine/tools/validate';
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
