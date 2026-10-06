import { describe, expect, it } from 'vitest';
import { compileGame } from '@engine/core/define';
import { validate } from '@engine/tools/validate';
import { mini, miniLayouts } from './fixtures/mini';

describe('v3 content compilation', () => {
  it('normalises a clone, never the authoring source, and freezes schema v3 output', () => {
    const source = mini();
    source.schemaVersion = 3;
    source.rooms[0].exits = { hall: { name: 'Hall', to: 'b' } };
    const compiled = compileGame(source);
    expect(source.rooms[0].hotspots?.hall).toBeUndefined();
    expect(compiled.rooms[0].hotspots?.hall?.exit).toBe(true);
    expect(compiled.rooms[0].on?.find((r) => r.exit === 'hall')?.id).toBe('exit.a.hall.go');
    expect(Object.isFrozen(compiled)).toBe(true);
    expect(() => {
      (compiled.rooms[0] as { name: string }).name = 'mutated';
    }).toThrow();
  });

  it('rejects missing and duplicate persistence ids in schema v3', () => {
    const game = mini();
    game.schemaVersion = 3;
    game.rooms[0].on![0].id = 'same';
    game.rooms[1].on![0].id = 'same';
    game.start.intro = [{ choice: [{ text: 'A', once: true, do: [] }] }];
    const report = validate(game, miniLayouts);
    expect(report.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('duplicate stable id "same"'),
        expect.stringContaining('choice requires a stable "id"'),
      ]),
    );
  });
});
