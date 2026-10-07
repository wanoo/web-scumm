// Dominance, symmetries and sub-puzzles (4.1.13, src/engine/tools/solve/search/dominance.ts): every rule against the
// explicit search on small generated games. Symmetric items give the explicit verdict (and fold states where twins
// exist); dominance gives a witness whenever there is one, and changes proof verdicts, which is why it stays off in
// proofs (the profile says so). Sub-puzzles are reported, not applied.
import { describe, expect, it } from 'vitest';
import type { GameDef, Layout } from '@engine/core/types';
import { auditAbstractions } from '@engine/tools/audit';
import { solve, type SolveOptions } from '@engine/tools/solve';
import { subPuzzles, symmetricItems, symmetryDims } from '@engine/tools/solve/search/dominance';
import { matrixGame, randomGame } from './gen/random-game';

/** A generated game with two twin coins: both in the bag at the start, each paying the same slot of room 0. */
function twins(seed: number): { game: GameDef; layouts: Record<string, Layout> } {
  const { game, layouts } = randomGame(seed);
  const r0 = game.rooms[0]!;
  r0.hotspots = { ...r0.hotspots, slot: { name: 'slot' } };
  r0.look = { ...r0.look, slot: 'A slot.' };
  r0.on = [
    ...(r0.on ?? []),
    ...['coinA', 'coinB'].map((c) => ({
      verb: 'use' as const,
      a: c,
      b: 'slot',
      do: [{ lose: c }, { inc: 'paid' }, 'Clink.'],
    })),
  ];
  // The ending also asks for both coins paid: the twins are on the way.
  const last = game.rooms.at(-1)!;
  last.on = (last.on ?? []).map((r) =>
    r.do.some((c) => typeof c === 'object' && 'end' in c)
      ? { ...r, if: { all: [r.if ?? 'f0', { flag: 'paid', gte: 2 }] } }
      : r,
  );
  game.items = {
    ...game.items,
    coinA: { name: 'coin', icon: 'i/coin', look: 'A coin.' },
    coinB: { name: 'coin', icon: 'i/coin', look: 'A coin.' },
  };
  game.start = { ...game.start, inventory: ['coinA', 'coinB'] };
  return { game, layouts };
}

describe('symmetric items', () => {
  it('finds twins the game treats alike, and only them', () => {
    expect(symmetricItems(twins(3).game)).toContainEqual(['coinA', 'coinB']);
    // One more rule for one of them: not twins any more.
    const g = twins(3).game;
    g.rooms[0]!.on!.push({ verb: 'look', a: 'coinA', do: [{ set: 'f0' }] });
    expect(symmetricItems(g).flat()).not.toContain('coinA');
    // A block the engine keys by its place (`once`), in the rule of one of them: apart.
    const k = twins(3).game;
    for (const r of k.rooms[0]!.on!) if (r.a === 'coinA' || r.a === 'coinB') r.do = [{ once: r.do }];
    expect(symmetricItems(k).flat()).not.toContain('coinA');
    // A goal that names one of them keeps them apart.
    expect(symmetricItems(twins(3).game, [{ has: 'coinA' }]).flat()).not.toContain('coinA');
    // The generated games of the corpus and the matrix have none (their items are found in different places).
    expect(symmetricItems(randomGame(5).game)).toEqual([]);
    expect(symmetricItems(matrixGame(11, { characters: 3, rooms: [20, 40] }).game)).toEqual([]);
  });

  it('a state and its swapped twin get the same dimensions', () => {
    const cls = [['coinA', 'coinB']];
    const a = symmetryDims(
      [
        ['item:coinA', '1'],
        ['pos:ann', 'room0 coinA,key used'],
        ['room', 'room0'],
      ],
      cls,
    );
    const b = symmetryDims(
      [
        ['item:coinB', '1'],
        ['pos:ann', 'room0 coinB,key used'],
        ['room', 'room0'],
      ],
      cls,
    );
    expect(a).toEqual(b);
    const both = symmetryDims(
      [
        ['item:coinA', '1'],
        ['item:coinB', '1'],
      ],
      cls,
    );
    expect(both).toEqual([['item:coinA', '2']]);
  });

  it('30 games with twins: the explicit search verdict, fewer states', async () => {
    const diverged: string[] = [];
    let folded = 0,
      compared = 0;
    const withSymmetry = (g: GameDef, l: Record<string, Layout>, o: SolveOptions) =>
      solve(g, l, o.memo === false ? o : { ...o, symmetry: true });
    for (let seed = 1; seed <= 30; seed++) {
      const { game, layouts } = twins(seed);
      const a = await auditAbstractions(game, layouts, { maxStates: 4000, solver: withSymmetry });
      if (a.status === 'diverged') diverged.push(`seed ${seed}: ${a.divergences.join('; ')}`);
      if (a.status === 'same') compared++;
      const on = await solve(structuredClone(game), layouts, { mode: 'prove', maxStates: 4000, symmetry: true });
      const off = await solve(structuredClone(game), layouts, { mode: 'prove', maxStates: 4000 });
      expect(on.profile.symmetry?.applied).toBe(true);
      if (!on.truncated && !off.truncated && on.states < off.states) folded++;
    }
    expect(diverged).toEqual([]);
    // The rest are `partial`: the explicit search needs more than 4 000 states.
    expect(compared).toBeGreaterThan(10);
    expect(folded).toBeGreaterThan(10);
  }, 600_000);

  it('off unless asked for, and the profile says so', async () => {
    const { game, layouts } = twins(2);
    const r = await solve(structuredClone(game), layouts, { mode: 'prove', maxStates: 500 });
    expect(r.profile.symmetry).toMatchObject({ applied: false, reason: expect.stringContaining('--symmetry') });
  }, 60_000);
});

describe('dominance', () => {
  it('a witness with it whenever there is one without (40 games)', async () => {
    const differ: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const { game, layouts } = randomGame(seed);
      const on = await solve(structuredClone(game), layouts, { maxStates: 3000, dominance: true });
      const off = await solve(structuredClone(game), layouts, { maxStates: 3000 });
      if (on.finished !== off.finished) differ.push(seed);
    }
    expect(differ).toEqual([]);
  }, 300_000);

  it('in a proof it changes verdicts against the explicit search: off in proofs, and the profile says why', async () => {
    let changed = 0,
      compared = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const { game, layouts } = randomGame(seed);
      const o = { mode: 'prove' as const, maxStates: 3000 };
      const exp = await solve(structuredClone(game), layouts, { ...o, canonicalPlayers: false, mobility: false });
      if (exp.truncated) continue;
      const dom = await solve(structuredClone(game), layouts, { ...o, dominance: true, unsafeReduction: true });
      compared++;
      if (dom.status !== exp.status || dom.softlockCount > 0 !== exp.softlockCount > 0) changed++;
    }
    expect(compared).toBeGreaterThan(30);
    expect(changed).toBeGreaterThan(0);
    const { game, layouts } = randomGame(1);
    const r = await solve(structuredClone(game), layouts, { mode: 'prove', maxStates: 500, dominance: true });
    expect(r.profile.dominance).toMatchObject({ applied: false, reason: expect.stringContaining('off in proofs') });
  }, 600_000);
});

describe('sub-puzzles', () => {
  it('the matrix instances split into independent groups of dimensions, reported', () => {
    const { game } = matrixGame(11, { characters: 3, rooms: [20, 40] });
    const p = subPuzzles(game);
    expect(p.count).toBeGreaterThan(1);
    expect(p.sizes.reduce((a, b) => a + b, 0)).toBeGreaterThan(p.count);
    expect([...p.sizes].sort((a, b) => b - a)).toEqual(p.sizes);
  });
});
