// Tools (validator, solver) on the fixture game.
import { describe, expect, it } from 'vitest';
import { validate } from '@engine/tools/validate';
import { solve } from '@engine/tools/solve';
import type { GameDef } from '@engine/core/types';
import { game, layouts } from './fixture';

describe('validate', () => {
  it('flags broken references', () => {
    const bad = structuredClone(game) as GameDef;
    bad.rooms[0].on!.push({
      verb: 'use',
      a: 'licorne',
      do: [{ gain: 'arc_en_ciel' }, { prop: ['lamp', 'violet'] }, { sfx: 'tonnerre' }],
    });
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

describe('minigame bindings', () => {
  it('flags a sound a minigame param names that the game does not have', () => {
    const bad = structuredClone(game) as GameDef;
    bad.audio = { ...(bad.audio ?? {}), sfx: { purr: 'purr.mp3' } };
    bad.rooms[0].on!.push({
      verb: 'use',
      a: 'lamp',
      do: [{ minigame: 'stroke', params: { target: 'lamp/off', hand: 'lamp/off', sfx: 'nope' } }],
    });
    const bindings = { stroke: { sfx: ['sfx'] } };
    const { errors } = validate(bad, layouts, { minigameBindings: bindings });
    expect(errors.some((e) => e.includes('unknown sound "nope"'))).toBe(true);
    bad.rooms[0].on!.at(-1)!.do = [
      { minigame: 'stroke', params: { target: 'lamp/off', hand: 'lamp/off', sfx: 'purr' } },
    ];
    expect(validate(bad, layouts, { minigameBindings: bindings }).errors.some((e) => e.includes('unknown sound'))).toBe(
      false,
    );
  });
});

describe('line ids at release time', () => {
  const lines = (): GameDef => {
    const g = structuredClone(game) as GameDef;
    g.rooms[0].on!.push({
      verb: 'use',
      a: 'lamp',
      do: [{ say: ['hero', 'No id here.'] }, { id: 'x.l-dup', say: ['hero', 'One'] }, { id: 'x.l-dup', toast: 'Two' }],
    });
    return g;
  };
  it('a duplicate line id is always an error; a missing one only at --release, as a warning without voices', () => {
    const plain = validate(lines(), layouts);
    expect(plain.errors.some((e) => e.includes('line id "x.l-dup" is already used'))).toBe(true);
    expect(plain.warnings.some((w) => w.includes('no stable id'))).toBe(false);
    const release = validate(lines(), layouts, { release: true });
    expect(release.warnings.some((w) => w.includes('no stable id'))).toBe(true);
    const voiced = lines();
    voiced.audio = { ...(voiced.audio ?? {}), voices: { 'x.l-dup': 'dup.mp3' } };
    expect(validate(voiced, layouts, { release: true }).errors.some((e) => e.includes('no stable id'))).toBe(true);
  });
});
