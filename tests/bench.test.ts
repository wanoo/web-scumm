// The generated stress game (src/engine/tools/stress.ts): valid, solvable chapter by chapter and globally, with the
// solver leaving out what cannot change the outcome (a clock nobody reads, a walker nobody waits for).
import { describe, expect, it } from 'vitest';
import { makeStressGame } from '@engine/tools/stress';
import { validate } from '@engine/tools/validate';
import { solve } from '@engine/tools/solve';
import { liveness, puzzleFor, puzzleGraph } from '@engine/tools/puzzle';

describe('the stress game', () => {
  const { game, layouts } = makeStressGame({ rooms: 10, players: 2, items: 12, flags: 30, npcs: 2, scripts: 4, topics: 6 });

  it('is valid and every item has a source', () => {
    expect(validate(game, layouts).errors).toEqual([]);
    const g = puzzleGraph(game);
    for (const id of Object.keys(game.items)) expect(puzzleFor(g, id)!.acquiredBy.length, id).toBeGreaterThan(0);
  });

  it('tells what is live', () => {
    const l = liveness(puzzleGraph(game));
    expect(l.flags.has('opened_1')).toBe(true);   // read by the exit
    expect(l.flags.has('looked_0')).toBe(false);  // only its own setter reads it
    expect(l.flags.has('ticks_1')).toBe(false);   // a clock nobody reads
    expect(l.actions.has('clock_1')).toBe(false);
    expect(l.actions.has('patrol_0')).toBe(false); // nobody waits for the walkers
    expect(l.actors.has('npc0')).toBe(false);
  });

  it('is solved chapter by chapter, then globally, in a few hundred states', async () => {
    let prev: string | undefined;
    for (const [cp, def] of Object.entries(game.checkpoints!)) {
      const r = await solve(game, layouts, { maxStates: 5000, start: prev ? { checkpoint: prev } : 'new', goal: def.goals });
      expect(r.finished, cp).toBe(true);
      prev = cp;
    }
    const end = await solve(game, layouts, { maxStates: 5000, start: { checkpoint: prev! } });
    expect(end.finished).toBe(true);
    const all = await solve(game, layouts, { maxStates: 5000 });
    expect(all.finished).toBe(true);
    expect(all.broken).toEqual([]);
    expect(all.states).toBeLessThan(1000);
    expect(all.path.some((s) => s === 'Switch to p1')).toBe(true);
  }, 60000);
});
