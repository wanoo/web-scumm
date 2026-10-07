// The chunked, chained journal of a run (4.1.14 "Time Attack", ADR 0016): the tape turns each session entry into a
// link (the entry, its events, the clock after it), the same live and replayed; links go into chunks of SESSION_MAX
// entries chained by their hashes, only the current chunk in memory; a chunk altered or cut short is where reading
// stops, and the run resumes from the last chunk that checks.
import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core/engine';
import { SESSION_MAX } from '@engine/core/engine-shared';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import {
  CHUNK_SIZE,
  ChunkedJournal,
  chainStep,
  checkChunk,
  MemoryChunkStore,
  readRun,
} from '@engine/core/journal-chunks';
import { RunTape, type TapeLink } from '@engine/core/run-tape';
import type { Session } from '@engine/core/types';
import { replay } from '@engine/tools/replay';
import { mini, miniLayouts } from './fixtures/mini';

async function live(n: number, seed = 'chunks') {
  const e = new Engine(mini(), miniLayouts, new FakePresenter(), new MemoryStore());
  e.digestOn = true;
  e.sessions.nextSeed = seed;
  const links: TapeLink[] = [];
  const tape = new RunTape(e, (l) => links.push(l));
  await e.newGame();
  const targets = ['valise', 'uncle'];
  for (let i = 0; i < n; i++) await e.act({ verb: 'look', a: targets[i % 2]! });
  tape.seal();
  return { e, links, tape };
}

describe('the tape', () => {
  it('one link per entry, in order, with the events and the clock after it', async () => {
    const { links } = await live(3);
    expect(links.map((l) => l.index)).toEqual([0, 1, 2, 3]);
    expect('start' in links[0]!.entry).toBe(true);
    expect(links[0]!.events.map((x) => x.kind)).toEqual(['sessionStarted', 'roomEntered']);
    expect(links.map((l) => l.logicalSteps)).toEqual(['1', '2', '3', '4']);
    expect(BigInt(links[3]!.logicalTime)).toBeGreaterThan(BigInt(links[1]!.logicalTime));
    for (const l of links) expect(typeof l.logicalTime).toBe('string');
  });

  it('a seeded replay of the same session yields the same links', async () => {
    const { e, links } = await live(12);
    const session = JSON.parse(JSON.stringify(e.session)) as Session;
    const again: TapeLink[] = [];
    let tape: RunTape | undefined;
    await replay(mini(), miniLayouts, session, {
      seed: 'chunks',
      attach: (x) => {
        tape = new RunTape(x, (l) => again.push(l));
      },
    });
    tape!.seal();
    const strip = (ls: TapeLink[]) => ls.map(({ entry: { t: _t, ...entry }, ...l }) => ({ ...l, entry }));
    expect(strip(again)).toEqual(strip(links));
  });
});

describe('chunks', () => {
  it('closes a chunk every SESSION_MAX links, chained, and keeps only the current chunk in memory', async () => {
    expect(CHUNK_SIZE).toBe(SESSION_MAX);
    expect(SESSION_MAX).toBe(500);
    const store = new MemoryChunkStore();
    const j = new ChunkedJournal(store, 'run-1', 'h0', undefined, () => ({ note: 'resume here' }));
    const { links } = await live(1100);
    let peak = 0;
    for (const l of links) {
      j.push(l);
      peak = Math.max(peak, j.current.length);
    }
    await j.idle();
    expect(peak).toBeLessThanOrEqual(CHUNK_SIZE);
    expect(j.chunks).toBe(2);
    expect(j.current.length).toBe(links.length - 2 * CHUNK_SIZE);
    await j.seal('finished');
    const r = (await readRun(store, 'run-1'))!;
    expect(r.ok).toBe(true);
    expect(r.chunks.map((c) => c.links.length)).toEqual([500, 500, links.length - 1000]);
    expect(r.chunks[1]!.prevHash).toBe(r.chunks[0]!.hash);
    expect(r.chunks[0]!.prevHash).toBe('h0');
    expect(r.lastHash).toBe(await j.lastHash());
    expect(r.head.sealed).toBe('finished');
    // The chain is H0 → H1 → … over every link.
    let h = 'h0';
    for (const l of links) h = await chainStep(h, l);
    expect(r.lastHash).toBe(h);
  }, 60000);

  it('reading stops at a chunk altered or out of order; the run resumes from the last that checks', async () => {
    const store = new MemoryChunkStore();
    const j = new ChunkedJournal(store, 'run-2', 'h0', undefined, () => ({ at: 'end of chunk' }));
    const { links } = await live(1050);
    for (const l of links) j.push(l);
    await j.idle();
    const chunks = await store.chunks('run-2');
    expect(await checkChunk(chunks[1]!)).toBe(chunks[1]!.hash);
    // Alter one entry of the second chunk.
    const bad = structuredClone(chunks[1]!);
    (bad.links[3]!.entry as { act: { a: string } }).act.a = 'uncle-altered';
    await store.putChunk(bad, (await store.head('run-2'))!);
    const r = (await readRun(store, 'run-2'))!;
    expect(r.ok).toBe(false);
    expect(r.chunks).toHaveLength(1);
    expect(r.lastHash).toBe(chunks[0]!.hash);
    // Resuming: a new journal from the last good chunk continues the chain.
    const k = new ChunkedJournal(store, 'run-2', 'h0', { chunks: r.chunks.length, lastHash: r.lastHash });
    for (const l of links.slice(CHUNK_SIZE)) k.push(l);
    await k.seal('finished');
    const again = (await readRun(store, 'run-2'))!;
    expect(again.ok).toBe(true);
    expect(again.lastHash).toBe(await j.lastHash());
  }, 60000);
});
