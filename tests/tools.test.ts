// Tools (validator, solver) on the fixture game.
import { describe, expect, it } from 'vitest';
import { validate } from '@engine/tools/validate';
import { solve } from '@engine/tools/solve';
import type { GameDef } from '@engine/core/types';
import { game, layouts } from './fixture';

describe('validate', () => {
  it('flags broken references', () => {
    const bad = structuredClone(game) as GameDef;
    bad.rooms[0].on!.push({ verb: 'use', a: 'licorne', do: [{ gain: 'arc_en_ciel' }, { prop: ['lamp', 'violet'] }, { sfx: 'tonnerre' }] });
    const { errors } = validate(bad, layouts);
    expect(errors.some((e) => e.includes('licorne'))).toBe(true);
    expect(errors.some((e) => e.includes('arc_en_ciel'))).toBe(true);
    expect(errors.some((e) => e.includes('violet'))).toBe(true);
    expect(errors.some((e) => e.includes('tonnerre'))).toBe(true);
  });
});

describe('solve', () => {
  it('from a new game, finishes the fixture game', async () => {
    const r = await solve(game, layouts, { maxStates: 2000 });
    expect(r.errors).toEqual([]);
    expect(r.finished).toBe(true);
    expect(r.path[0].startsWith('(tutorial)')).toBe(true);
    expect(r.roomsReached).toContain('garden');
  });
});
