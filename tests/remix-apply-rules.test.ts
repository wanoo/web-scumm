// Applying a world to a small game, value by value (4.1.17, mutation survivors of core/remix/apply.ts): what the
// compiler reads of a game (every rule and listener with an id, none without), a text written once is that text in any
// language, a placeholder no coupled dimension declares stays as written, a line's text replaces only its text (a
// `say`, a choice, a toast, never a field the line does not have), an image in the named room only, a palette, a
// cosmetic parameter of a minigame nested in a condition and only of the named rule; a target that names nothing (a
// missing prop, character or rule, a parameter that decides a win, an unknown kind) is refused, never thrown; a code
// wheel takes the world's seed unless its author fixed one; a `null` in a command's arguments passes through.
import { describe, expect, it } from 'vitest';
import type { Cmd, GameDef } from '@engine/core/types';
import {
  applyVariant,
  compileGameManifest,
  presentationTargetExists,
  remixWorld,
  textIn,
} from '@engine/core/remix/apply';
import type { VariationDimension, VariationManifest } from '@engine/core/remix/manifest';
import { REMIX_ALGORITHM, variantHash, type WorldVariant } from '@engine/core/remix/story';

type Presentation = Extract<VariationDimension, { kind: 'presentation' }>;
const pres = (id: string, target: string, values: unknown[]): Presentation => ({
  id,
  kind: 'presentation',
  target,
  values,
  story: 0,
  logical: false,
});

const manifest: VariationManifest = {
  schema: 1,
  algorithm: 'web-scumm-remix-1',
  modes: [{ id: 'all', strategy: 'catalogue', dimensions: ['combo', 'door', 'pal', 'say', 'toast', 'choice', 'mg'] }],
  dimensions: [
    {
      id: 'combo',
      kind: 'coupled',
      story: 0,
      logical: true,
      pairs: [
        { hint: { en: 'one sun', fr: 'un soleil' }, answer: '12' },
        { hint: 'a plain hint', answer: '34' },
      ],
    },
    pres('door', 'prop-img:yard.door', ['door/a', 'door/b']),
    pres('pal', 'palette:grandma', [{}, { '#f00': '#0f0' }]),
    pres('say', 'line:l-say', ['Hello', { en: 'Bye', fr: 'Salut' }]),
    pres('toast', 'line:l-toast', ['Saved', 'Kept']),
    pres('choice', 'line:l-choice', ['Yes', 'Sure']),
    pres('mg', 'minigame:wheel-b:question', ['Which?', 'Who?']),
  ],
  constraints: [],
};

const sayCode: Cmd = { say: ['grandma', '{code:combo} / {hint:combo} / {code:nope} / {hint:pal}'] };
const game = {
  id: 'tiny',
  title: 'Tiny',
  lang: 'en',
  saveVersion: 1,
  hero: 'kid',
  verbs: [],
  characters: { kid: { name: 'Kid', room: 'hall' }, grandma: { name: 'Grandma', room: 'yard' } },
  items: {},
  rooms: [
    {
      id: 'hall',
      name: 'Hall',
      decor: 'hall',
      props: { door: { img: 'door/a' } },
      on: [
        { verb: 'look', a: 'door', do: ['no id here'] },
        {
          id: 'r-say',
          verb: 'talk',
          a: 'grandma',
          do: [
            { say: ['grandma', 'Hello'], id: 'l-say' },
            { toast: 'Saved', id: 'l-toast' },
            { choice: [{ id: 'l-choice', text: 'Yes', do: [] }] },
            sayCode,
            { custom: 'note', args: { last: null, n: 3 } },
          ],
        },
        { id: 'wheel-a', verb: 'use', a: 'door', do: [{ minigame: 'code-wheel', params: { question: 'Front?' } }] },
      ],
      events: [
        { on: 'ring', do: ['anonymous listener'] },
        { id: 'l-room', on: 'ring', do: [{ set: 'rang' }] },
      ],
    },
    { id: 'yard', name: 'Yard', decor: 'yard', props: { door: { img: 'door/a' } } },
  ],
  rules: {
    on: [
      { verb: 'look', a: 'kid', do: ['still no id'] },
      {
        id: 'wheel-b',
        verb: 'use',
        a: 'kid',
        do: [
          'Let me think.',
          {
            if: { flag: 'rang' },
            then: [{ minigame: 'code-wheel', params: { question: 'Which?', seed: 'fixed-by-author' } }],
          },
        ],
      },
    ],
  },
  events: [
    { on: 'ring', do: ['game anonymous'] },
    { id: 'l-game', on: 'ring', do: [{ unset: 'rang' }] },
  ],
  start: { room: 'hall', flags: { mood: 'calm' } },
  skin: {},
  remix: manifest,
} as unknown as GameDef;

/** A world of the game with these assignments (hashed as a stored one would be). */
function world(assignments: Record<string, unknown>, seed = 'SEED-1'): WorldVariant {
  const body = {
    seed,
    algorithm: REMIX_ALGORITHM,
    algorithmVersion: 1,
    manifestHash: compileGameManifest(game).hash,
    mode: 'all',
    assignments,
  };
  return { ...body, hash: variantHash(body) };
}
const away = world({ combo: 1, door: 1, pal: 1, say: 1, toast: 1, choice: 1, mg: 1 });
const story = world({ combo: 0, door: 0, pal: 0, say: 0, toast: 0, choice: 0, mg: 0 });
const hallDo = (g: GameDef, rule: string) => g.rooms[0]!.on!.find((r) => r.id === rule)!.do;

describe('what the compiler reads of a game', () => {
  it('every rule and listener with an id, rooms first, then the game; none without an id', () => {
    const w = remixWorld(game);
    expect(w.rooms).toBe(game.rooms);
    expect(w.rules.map((r) => [r.id, r.kind])).toEqual([
      ['r-say', 'rule'],
      ['wheel-a', 'rule'],
      ['l-room', 'listener'],
      ['wheel-b', 'rule'],
      ['l-game', 'listener'],
    ]);
    expect(w.rules[2]!.do).toEqual([{ set: 'rang' }]);
    expect(w.rules[4]!.do).toEqual([{ unset: 'rang' }]);
  });
});

describe('textIn', () => {
  it('a text written once is that text in any language; a table falls back to the default then the first', () => {
    expect(textIn('plain words', 'fr')).toBe('plain words');
    expect(textIn({ en: 'one', fr: 'un' }, 'fr')).toBe('un');
    expect(textIn({ en: 'one', fr: 'un' }, 'de')).toBe('one');
    expect(textIn({ de: 'eins' }, 'fr')).toBe('eins');
  });
});

describe('applying a world away from its story', () => {
  const g = applyVariant(game, away);

  it('fills a coupled code and its plain hint; a placeholder of no coupled dimension stays as written', () => {
    expect(g.rooms[0]!.on![1]!.do[3]).toEqual({ say: ['grandma', '34 / a plain hint / {code:nope} / {hint:pal}'] });
    expect(g.start.flags).toEqual({ mood: 'calm', 'remix.combo': '34' });
  });

  it('a line takes its new text in its own field only (say, toast, choice)', () => {
    const d = hallDo(g, 'r-say');
    expect(d[0]).toEqual({ say: ['grandma', 'Bye'], id: 'l-say' });
    expect(d[1]).toEqual({ toast: 'Kept', id: 'l-toast' });
    expect(d[2]).toEqual({ choice: [{ id: 'l-choice', text: 'Sure', do: [] }] });
    expect(hallDo(applyVariant(game, away, { lang: 'fr' }), 'r-say')[0]).toEqual({
      say: ['grandma', 'Salut'],
      id: 'l-say',
    });
  });

  it("an image changes in the named room only; a character's palette is replaced", () => {
    expect(g.rooms[1]!.props!.door!.img).toBe('door/b');
    expect(g.rooms[0]!.props!.door!.img).toBe('door/a');
    expect(g.characters.grandma!.palette).toEqual({ '#f00': '#0f0' });
    expect(g.characters.kid!.palette).toBeUndefined();
  });

  it("a minigame parameter of the named rule, found inside a condition; the other rule's wheel untouched", () => {
    expect(g.rules.on![1]!.do[1]).toEqual({
      if: { flag: 'rang' },
      then: [{ minigame: 'code-wheel', params: { question: 'Who?', seed: 'fixed-by-author' } }],
    });
    expect(hallDo(g, 'wheel-a')).toEqual([{ minigame: 'code-wheel', params: { question: 'Front?', seed: 'SEED-1' } }]);
  });

  it("a null in a command's arguments passes through; the input game is not mutated", () => {
    expect(hallDo(g, 'r-say')[4]).toEqual({ custom: 'note', args: { last: null, n: 3 } });
    expect(hallDo(game, 'r-say')[0]).toEqual({ say: ['grandma', 'Hello'], id: 'l-say' });
    expect(game.rooms[1]!.props!.door!.img).toBe('door/a');
    expect(game.variant).toBeUndefined();
    expect(g.variant).toBe(away);
  });

  it('the story world changes no presentation and fills the story hint in the language asked', () => {
    const s = applyVariant(game, story, { lang: 'fr' });
    expect(s.rooms[0]!.on![1]!.do[3]).toEqual({ say: ['grandma', '12 / un soleil / {code:nope} / {hint:pal}'] });
    expect(s.start.flags).toEqual({ mood: 'calm' });
    expect(hallDo(s, 'r-say').slice(0, 3)).toEqual(hallDo(game, 'r-say').slice(0, 3));
  });
});

describe('a presentation target names something, or is refused (never thrown)', () => {
  const exists = (target: string, values: unknown[] = ['x']) =>
    presentationTargetExists(game, pres('p', target, values));

  it('a prop image: the prop of that room, not a missing one', () => {
    expect(exists('prop-img:yard.door')).toBe(true);
    expect(exists('prop-img:yard.window')).toBe(false);
    expect(exists('prop-img:cellar.door')).toBe(false);
  });

  it('a palette: a declared character only', () => {
    expect(exists('palette:grandma', [{}])).toBe(true);
    expect(exists('palette:ghost', [{}])).toBe(false);
  });

  it('a minigame: a cosmetic parameter of a rule that has one; not a missing rule, nor a winning parameter', () => {
    expect(exists('minigame:wheel-b:question')).toBe(true);
    expect(exists('minigame:no-such-rule:question')).toBe(false);
    expect(exists('minigame:r-say:question')).toBe(false);
    expect(exists('minigame:wheel-b:answers')).toBe(false);
    expect(exists('minigame:wheel-b')).toBe(false);
  });

  it('an unknown kind of target is refused, even shaped like a minigame one', () => {
    expect(exists('sound:wheel-b:question')).toBe(false);
    expect(exists('line:l-say')).toBe(true);
    expect(exists('line:no-such-line')).toBe(false);
  });
});
