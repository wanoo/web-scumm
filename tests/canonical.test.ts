// The canonical character (`canonicalPlayers`) must reach exactly the verdicts of the explicit search: same status,
// same ending, same broken invariants, softlocks or not. Fewer states is the point, not a different answer.
import { describe, expect, it } from 'vitest';
import type { GameDef, Layout } from '@engine/core/types';
import { solve } from '@engine/tools/solve';
import { makeStressGame } from '@engine/tools/stress';
import { cast, castLayouts } from './fixtures/cast';
import { game as demo, layouts as demoLayouts, commands } from '../games/demo';

const verdict = (r: Awaited<ReturnType<typeof solve>>) => ({ status: r.status, finished: r.finished, broken: r.broken.map((b) => b.invariant).sort(), softlocks: r.softlockCount > 0 });

describe('the canonical character', () => {
  const games: [string, GameDef, Record<string, Layout>, object][] = [
    ['cast fixture', cast(), castLayouts, {}],
    ['demo (hero and the cat)', structuredClone(demo), demoLayouts, { commands }],
    ...[1, 2, 3].map((seed): [string, GameDef, Record<string, Layout>, object] => { const g = makeStressGame({ rooms: 5 + seed, players: 2, items: 4, flags: 4, npcs: 0, scripts: 0, topics: 2 }); return [`stress ${5 + seed} rooms, 2 characters`, g.game, g.layouts, {}]; }),
    ...[1].map((seed): [string, GameDef, Record<string, Layout>, object] => { const g = makeStressGame({ rooms: 4 + seed, players: 3, items: 3, flags: 3, npcs: 0, scripts: 0, topics: 1 }); return [`stress ${4 + seed} rooms, 3 characters`, g.game, g.layouts, {}]; }),
  ];
  for (const [name, game, layouts, o] of games) it(`${name}: same verdict, no more states`, async () => {
    const explicit = await solve(structuredClone(game), layouts, { ...o, mode: 'prove', canonicalPlayers: false, maxStates: 60000 });
    const canon = await solve(structuredClone(game), layouts, { ...o, mode: 'prove', canonicalPlayers: true, maxStates: 60000 });
    expect(explicit.truncated).toBe(false);
    expect(verdict(canon)).toEqual(verdict(explicit));
    expect(canon.states).toBeLessThanOrEqual(explicit.states);
    if ((game.players?.ids.length ?? 1) > 1) expect(canon.profile.canonical.applied).toBe(true);
  }, 120000);

  it('stays off for a witness unless asked, and when the goal reads { player }', async () => {
    const g = makeStressGame({ rooms: 5, players: 2, items: 3, flags: 3, npcs: 0, scripts: 0, topics: 1 });
    expect((await solve(g.game, g.layouts, {})).profile.canonical.applied).toBe(false);
    const r = await solve(g.game, g.layouts, { mode: 'prove', goal: [{ player: 'p1' }] });
    expect(r.profile.canonical).toMatchObject({ applied: false, reason: 'the goal reads { player }' });
  }, 60000);
});
