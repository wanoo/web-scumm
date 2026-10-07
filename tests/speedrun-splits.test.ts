// Splits from the semantic journal (4.1.14 "Time Attack"): automatic, sub-splits included, the same live and replayed;
// a missed split leaves the attempt whole; best segments, the sum of best, ahead or behind a personal best; routes
// exported and imported as .wsroute, the solver's witness as a logical route that is never a record, two routes
// compared.
import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core/engine';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import { RunTape, type TapeLink } from '@engine/core/run-tape';
import type { GameDef, SessionEntry } from '@engine/core/types';
import { solve } from '@engine/tools/solve';
import { replayRun } from '@engine/tools/speedrun/replay-run';
import { addRun, againstPb, emptyRecords, raiseTrust, segments, sumOfBest } from '@engine/tools/speedrun/records';
import { compareRoutes, exportRoute, parseRoute, routeFromRun, routeFromWitness } from '@engine/tools/speedrun/routes';
import { formatDelta, formatTime, rankedTime, SplitTracker } from '@engine/tools/speedrun/splits';
import { ROUTE, speedrunGame, speedrunLayouts } from './fixtures/speedrun-game';

async function attempt(game: GameDef, route: readonly { verb: string; a: string; b?: string }[], seed = 's') {
  const e = new Engine(game, speedrunLayouts, new FakePresenter(), new MemoryStore());
  e.digestOn = true;
  e.sessions.nextSeed = seed;
  const links: TapeLink[] = [];
  const tape = new RunTape(e, (l) => links.push(l));
  await e.newGame();
  for (const a of route) await e.act({ ...a });
  tape.seal();
  return { e, links, entries: e.session!.log as SessionEntry[] };
}
const cat = (g: GameDef, id = 'any%') => g.speedrun!.categories.find((c) => c.id === id)!;

describe('automatic splits', () => {
  it('start, splits (a sub-split included), finish, in order, with logical times since the start', async () => {
    const g = speedrunGame();
    const { links } = await attempt(g, ROUTE);
    const t = new SplitTracker(g.speedrun!, cat(g));
    const kinds = links.flatMap((l) => t.feed(l).map((s) => (s.kind === 'split' ? `split:${s.split.id}` : s.kind)));
    expect(kinds).toEqual(['start', 'split:key', 'split:found', 'split:vault', 'split:end', 'finish']);
    expect(t.splits.every((s) => s.entry !== null)).toBe(true);
    const times = t.splits.map((s) => BigInt(s.logicalTime!));
    expect([...times].sort((a, b) => (a < b ? -1 : 1))).toEqual(times);
    expect(t.finish!.logicalTime).toBe(t.splits.at(-1)!.logicalTime);
    // The cutscene's 1.5 s and its line are IGT, not Active IGT.
    expect(BigInt(t.finish!.logicalTime) - BigInt(t.finish!.activeTime)).toBe(BigInt(1500 + 2200) * 1000n);
  });

  it('are the same replayed (the verifier’s and the Studio’s path)', async () => {
    const g = speedrunGame();
    const { links, entries } = await attempt(g, ROUTE, 'same');
    const live = new SplitTracker(g.speedrun!, cat(g));
    for (const l of links) live.feed(l);
    const r = await replayRun(speedrunGame(), speedrunLayouts, entries, { seed: 'same', category: cat(g) });
    expect(r.replay.divergedAt).toBeUndefined();
    expect(r.tracker!.splits).toEqual(live.splits);
    expect(r.tracker!.finish).toEqual(live.finish);
  });

  it('a missed split is marked and the attempt goes on to its finish', async () => {
    const g = speedrunGame();
    // A split that never fires (a room nobody enters on this route) between two that do.
    g.speedrun = {
      ...g.speedrun!,
      splits: [
        g.speedrun!.splits[0]!,
        { id: 'detour', name: 'Detour', at: { event: 'flagChanged', flag: 'never' } },
        g.speedrun!.splits[2]!,
        g.speedrun!.splits[3]!,
      ],
    };
    const { links } = await attempt(g, ROUTE);
    const t = new SplitTracker(g.speedrun!, cat(g));
    const signals = links.flatMap((l) => t.feed(l));
    expect(signals.filter((s) => s.kind === 'missed')).toEqual([{ kind: 'missed', id: 'detour' }]);
    expect(t.splits.map((s) => s.entry === null)).toEqual([false, true, false, false]);
    expect(t.finished).toBe(true);
    expect(segments(cat(g), t.splits)[1]).toBeNull();
  });

  it('formats times and deltas', () => {
    expect(formatTime(83_456_000n)).toBe('1:23.456');
    expect(formatTime(3_723_004_000n)).toBe('1:02:03.004');
    expect(formatTime(null)).toBe('—');
    expect(formatDelta(1_234_000n)).toBe('+1.234');
    expect(formatDelta(-500_000n)).toBe('−0.500');
    expect(rankedTime({ timing: 'rta' }, { logicalTime: '1', activeTime: '1', rtaMs: 12 })).toBe(12_000n);
  });
});

describe('records: personal best, best segments, sum of best, ahead and behind', () => {
  it('a faster run becomes the PB; segments keep their best; an abandon counts', async () => {
    const g = speedrunGame();
    const c = cat(g);
    const slow = await attempt(g, [ROUTE[0], ROUTE[0], ...ROUTE]);
    const fast = await attempt(g, ROUTE);
    const track = (links: TapeLink[]) => {
      const t = new SplitTracker(g.speedrun!, c);
      for (const l of links) t.feed(l);
      return t;
    };
    const a = track(slow.links);
    const b = track(fast.links);
    let rec = emptyRecords('vault', 'any%', 1);
    rec = addRun(rec, c, 1, { runId: 'slow', at: 1, splits: a.splits, finish: a.finish });
    expect(rec.pb!.runId).toBe('slow');
    const vs = againstPb(c, rec, b.splits);
    expect(vs.every((d) => d !== null && d <= 0n)).toBe(true);
    expect(vs[0]!).toBeLessThan(0n);
    rec = addRun(rec, c, 1, { runId: 'fast', at: 2, splits: b.splits, finish: b.finish });
    expect(rec.pb!.runId).toBe('fast');
    expect(rec.pb!.trust).toBe('local');
    rec = addRun(rec, c, 1, { runId: 'quit', at: 3, splits: b.splits.map((s) => ({ ...s })), finish: null });
    expect([rec.attempts, rec.finished, rec.abandoned]).toEqual([3, 2, 1]);
    const ids = g.speedrun!.splits.map((s) => s.id);
    const sob = sumOfBest(rec, ids)!;
    expect(sob).toBeLessThanOrEqual(BigInt(rec.pb!.total));
    expect(rec.history.map((h) => h.status)).toEqual(['abandoned', 'finished', 'finished']);
    // Rules changed: the records start again, a PB under other rules is never compared.
    const v2 = addRun(rec, c, 2, { runId: 'new-rules', at: 4, splits: a.splits, finish: a.finish });
    expect([v2.attempts, v2.pb!.runId]).toEqual([1, 'new-rules']);
    // Trust is raised by a verdict, never lowered.
    const up = raiseTrust(rec, 'fast', 'replay-valid');
    expect(up.pb!.trust).toBe('replay-valid');
    expect(raiseTrust(up, 'fast', 'local').pb!.trust).toBe('replay-valid');
  });
});

describe('routes (.wsroute)', () => {
  it('export and import a human route; refuse what is not a route', async () => {
    const g = speedrunGame();
    const { entries } = await attempt(g, ROUTE);
    const r = routeFromRun({ gameId: 'vault', categoryId: 'any%', name: 'Mine', steps: entries, notes: 'take first' });
    const text = exportRoute(r);
    const back = parseRoute(text);
    expect(back).toEqual(r);
    expect(back.steps.every((s) => !('digest' in s) && !('t' in s))).toBe(true);
    expect(() => parseRoute('{"format":"web-scumm-session"}')).toThrow(/not a web-scumm route/);
    expect(() => parseRoute(text.replace('"human"', '"record"'))).toThrow(/human or logical/);
  });

  it('the solver’s witness is a logical route, never a record; two routes compare by actions and splits', async () => {
    const g = speedrunGame();
    const s = await solve(speedrunGame(), speedrunLayouts, { maxStates: 5000 });
    expect(s.finished).toBe(true);
    const logical = routeFromWitness('vault', s.steps);
    expect(logical.kind).toBe('logical');
    const { entries } = await attempt(g, [ROUTE[0], ...ROUTE]);
    const human = routeFromRun({ gameId: 'vault', name: 'Looks twice', steps: entries });
    const time = async (steps: SessionEntry[]) => {
      const x = await replayRun(speedrunGame(), speedrunLayouts, steps, { category: cat(g) });
      return { splits: x.tracker!.splits, logicalTime: x.tracker!.finish?.logicalTime };
    };
    Object.assign(logical, await time(logical.steps));
    Object.assign(human, await time(human.steps));
    const cmp = compareRoutes(logical, human);
    expect(cmp.firstDifference).not.toBeNull();
    expect(cmp.splits.map((x) => x.id)).toEqual(['key', 'found', 'vault', 'end']);
    expect(BigInt(cmp.splits.at(-1)!.delta!)).toBeGreaterThan(0n);
  });
});
