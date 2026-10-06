// Open: custom commands (the escape hatch), localisation by extraction, condition explanations.
import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core/engine';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import { explainCond } from '@engine/core/cond';
import type { CustomCommands } from '@engine/core/custom';
import { applyLocale, localeStatus, textPaths } from '@engine/tools/i18n';
import { validate } from '@engine/tools/validate';
import { solve } from '@engine/tools/solve';
import { game as fixture, layouts } from './fixture';

const commands: CustomCommands = {
  boom: {
    effects: [{ set: 'boomed' }, { sfx: 'bang' }],
    run: async (ctx) => {
      ran.push(`boom ${JSON.stringify(ctx.args)} in ${ctx.room.id}`);
    },
  },
  sparkle: {
    pure: true,
    run: () => {
      ran.push('sparkle');
    },
  },
  shady: {},
};
const ran: string[] = [];

describe('custom commands', () => {
  it('apply their declared effects everywhere, run their visual part only when asked', async () => {
    const g = structuredClone(fixture);
    g.audio = { sfx: { bang: 'bang.mp3' } };
    g.rooms[0].on!.push({
      verb: 'push',
      a: 'lamp',
      do: [{ custom: 'boom', args: { size: 3 } }, { custom: 'sparkle' }],
    });
    const ui = new FakePresenter();
    const e = new Engine(g, layouts, ui, new MemoryStore(), { commands });
    await e.checkpoint('free');
    expect(await e.act({ verb: 'push', a: 'lamp' })).toBe('rule');
    expect(e.state.flags.boomed).toBe(true);
    expect(ui.log).toContain('sfx bang');
    expect(ran).toEqual([]); // node: no run
    const e2 = new Engine(structuredClone(g), layouts, new FakePresenter(), new MemoryStore(), {
      commands,
      runCustom: true,
    });
    await e2.checkpoint('free');
    await e2.act({ verb: 'push', a: 'lamp' });
    expect(ran).toEqual(['boom {"size":3} in house', 'sparkle']);
    const e3 = new Engine(structuredClone(g), layouts, new FakePresenter(), new MemoryStore());
    await e3.checkpoint('free');
    await expect(e3.script([{ custom: 'boom' }])).rejects.toThrow(/unknown custom command/);
    // the solver knows the effects
    const r = await solve(g, layouts, { maxStates: 500, commands });
    expect(r.finished).toBe(true);
    expect(r.flagsReached).toContain('boomed');
  });

  it('the validator wants known commands with effects or pure', () => {
    const g = structuredClone(fixture);
    g.rooms[0].on!.push({ verb: 'push', a: 'lamp', do: [{ custom: 'boom' }, { custom: 'shady' }, { custom: 'nope' }] });
    expect(validate(g, layouts).errors).toEqual([]); // no commands given: not checked
    const { errors } = validate(g, layouts, { commands });
    expect(errors).toEqual([
      'commands.boom.effects[1] › unknown sound effect: "bang"',
      'house.on[4][1] › custom command "shady" declares neither "effects" nor "pure: true": the solver cannot know what it does',
      'house.on[4][2] › unknown custom command: "nope" (known: boom, sparkle, shady)',
    ]);
  });
});

describe('localisation by extraction', () => {
  it('lists every text with a stable path, applies a table, reports coverage', () => {
    const paths = textPaths(fixture);
    const byPath = Object.fromEntries(paths.map((p) => [p.path, p.text]));
    expect(byPath['room:house/look.drawer[1]']).toBe('Still an old drawer.');
    expect(byPath['room:house/on[0].do[1]']).toBe('Light!');
    expect(byPath['room:house/on[2].do[1].say']).toBe('Thanks! Here is the key.');
    expect(byPath['room:house/talk.grandma[0].topic']).toBe('Where is the key?');
    expect(byPath['room:house/hints[0].lines[1]']).toBe('The DRAWER.');
    expect(byPath['item:key/look']).toBe('The shed key!');
    expect(byPath['char:grandma/refuse']).toBe('No thanks, dear.');
    expect(byPath['rules/fallbacks.push[1]']).toBe('Nope.');
    expect(byPath['ui/newGame']).toBe('New game');
    expect(byPath['start/intro[0].guide']).toBe('Look at the lamp first.');
    expect(byPath['map/places.garden.name']).toBe('Garden');
    expect(paths.some((p) => p.text.includes('/'))).toBe(false); // no image id leaked as a text
    const fr = {
      'room:house/look.drawer[1]': 'Toujours un vieux tiroir.',
      'ui/newGame': 'Nouvelle partie',
      'char:grandma/name': 'Grand-mère',
      'old/key': 'gone',
    };
    const g = applyLocale(fixture, fr);
    expect(g.rooms[0].look!.drawer[1]).toBe('Toujours un vieux tiroir.');
    expect(g.ui.newGame).toBe('Nouvelle partie');
    expect(g.characters.grandma.name).toBe('Grand-mère');
    expect(fixture.ui.newGame).toBe('New game'); // untouched
    const st = localeStatus(fixture, fr);
    expect(st.total).toBe(paths.length);
    expect(st.translated).toBe(3);
    expect(st.stale).toEqual(['old/key']);
    expect(st.missing).toContain('room:house/name');
  });
});

describe('explained conditions', () => {
  it('tells which part of a condition fails', () => {
    const e = new Engine(structuredClone(fixture), layouts, new FakePresenter(), new MemoryStore());
    const s = e.fresh();
    s.inventory = ['coin'];
    s.flags.a = 1;
    const x = explainCond({ all: ['coin_found', { has: 'coin' }, { not: { flag: 'a', gte: 2 } }] }, s, 'house');
    expect(x.ok).toBe(false);
    expect(x.parts!.map((p) => `${p.ok ? '✓' : '✗'} ${p.text}`)).toEqual([
      '✗ flag coin_found is true (false)',
      '✓ has coin',
      '✓ not',
    ]);
    expect(x.parts![2].parts![0]).toEqual({ text: 'flag a ≥ 2 (1)', ok: false });
  });
});
