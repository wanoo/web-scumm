// The explosion profile (4.1.13, src/engine/tools/solve/explosion.ts; `npm run solve -- --profile`): the states
// attributed to the dimensions of the matrix's sheet, and every abstraction named with what it did or why it is off.
import { describe, expect, it } from 'vitest';
import { explosion } from '@engine/tools/solve/explosion';
import { profileText, proofProfileLines, solve } from '@engine/tools/solve';
import type { Dims } from '@engine/tools/solve/abstractions';
import type { GameDef } from '@engine/core/types';
import { matrixGame } from './gen/random-game';

describe('the explosion profile', () => {
  it('attributes each family by what would merge without it', () => {
    const game = {
      rooms: [
        {
          id: 'r',
          talk: { k: [{ topic: 't', do: [{ set: 'told' }] }] },
          scripts: [{ id: 's', do: [{ set: 'rang' }] }],
        },
      ],
      rules: {},
      start: {},
    } as unknown as GameDef;
    const d = (room: string, item: string, told: boolean, rang: boolean, flag: boolean): Dims =>
      [
        ['flag:other', flag ? 'true' : ''],
        ['flag:rang', rang ? 'true' : ''],
        ['flag:told', told ? 'true' : ''],
        ['pos:ann', `${room} ${item} `],
      ].filter(([, v]) => v !== '') as Dims;
    const all = [
      d('r1', '', false, false, false),
      d('r2', '', false, false, false),
      d('r1', 'key', false, false, false),
      d('r1', '', true, false, false),
      d('r1', '', false, true, false),
      d('r1', '', false, false, true),
    ];
    const p = { canonical: { folded: 2 }, noops: 5, memo: { hits: 3, verified: 1 }, hashHits: 7, postponed: 0 };
    const x = explosion(all, game, p as never);
    const by = Object.fromEntries(x.families.map((f) => [f.family, f.split]));
    // Without the rooms, r1 and r2 merge (one state less); the same for each other family.
    expect(by).toEqual({ positions: 1, inventories: 1, flags: 1, dialogues: 1, scripts: 1 });
    expect(x.measured).toBe(6);
    expect(x.noops).toEqual({ tries: 5, memoSkipped: 2 });
    expect(x.permutations.landedOnKnown).toBe(7);
    expect(x.symmetries.folded).toBe(2);
  });

  it('a matrix instance: the profile names every abstraction and what multiplies the states', async () => {
    const g = matrixGame(13, { characters: 3, rooms: [20, 40] });
    const r = await solve(structuredClone(g.game), g.layouts, { mode: 'prove', maxStates: 20000, explosion: true });
    const x = r.profile.explosion!;
    expect(x.measured).toBe(r.states);
    expect(x.families.map((f) => f.family)).toEqual(['positions', 'inventories', 'flags', 'dialogues', 'scripts']);
    // In a constrained instance the rooms may follow from the doors opened (positions then split nothing).
    expect(x.families.some((f) => f.split > 0)).toBe(true);
    const text = proofProfileLines(r.profile).join('\n');
    for (const name of [
      'canonical character',
      'mobility regions',
      'no-op memo',
      'canonical owner',
      'witness dominance',
      'symmetric items',
      'representation',
      'Explosion',
      'permutations',
    ])
      expect(text).toContain(name);
    expect(profileText(r.profile, g.game)).toContain('Explosion');
  }, 120_000);
});
