// The runs' store in the browser (4.1.14 "Time Attack", ADR 0016): IndexedDB `web-scumm-runs`, a chunk and its run's
// head in one transaction. A page closed in the middle of a write (the transaction aborted, as fake-indexeddb does it
// here) leaves the run at its previous chunk; the run resumes from the last chunk that checks, and the chain goes on.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { ChunkedJournal, CHUNK_SIZE, readRun } from '@engine/core/journal-chunks';
import type { TapeLink } from '@engine/core/run-tape';
import { IndexedDbRunStore } from '@engine/dom/run-store';

const link = (i: number): TapeLink => ({
  index: i,
  entry: { act: { verb: 'look', a: i % 2 ? 'valise' : 'uncle' } },
  events: [],
  logicalSteps: String(i + 1),
  logicalTime: String((i + 1) * 2_200_000),
  activeTime: String((i + 1) * 2_200_000),
});

beforeEach(() => {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});

describe('the IndexedDB run store', () => {
  it('writes chunks and heads, reads them back checked, lists and deletes runs; keeps records', async () => {
    const store = await IndexedDbRunStore.open();
    const j = new ChunkedJournal(store, 'r1', 'h0', undefined, () => ({ chunkEnd: true }));
    for (let i = 0; i < CHUNK_SIZE + 10; i++) j.push(link(i));
    await j.seal('finished');
    const r = (await readRun(store, 'r1'))!;
    expect(r.ok).toBe(true);
    expect(r.chunks.map((c) => c.links.length)).toEqual([CHUNK_SIZE, 10]);
    expect((await store.runs()).map((h) => h.runId)).toEqual(['r1']);
    await store.putRecord('g:any', { pb: 12 });
    expect(await store.getRecord('g:any')).toEqual({ pb: 12 });
    await store.deleteRun('r1');
    expect(await readRun(store, 'r1')).toBeNull();
    expect(await store.chunks('r1')).toEqual([]);
  });

  it('a page closed mid-write: the chunk and the head are both missing, the run resumes at the chunk before', async () => {
    const store = await IndexedDbRunStore.open();
    const proto = IDBObjectStore.prototype as unknown as { put: (v: unknown, k?: IDBValidKey) => IDBRequest };
    const put = proto.put;
    // The second chunk's write: the chunk goes in, then the page dies before the head (the transaction aborts).
    proto.put = function (this: IDBObjectStore, v: unknown, k?: IDBValidKey) {
      const r = put.call(this, v, k);
      if (this.name === 'heads' && (v as { chunks: number }).chunks === 2) this.transaction.abort();
      return r;
    };
    const j = new ChunkedJournal(store, 'r2', 'h0', undefined, () => ({ resumeAt: 'chunk end' }));
    try {
      for (let i = 0; i < 2 * CHUNK_SIZE + 5; i++) j.push(link(i));
      await j.idle();
    } finally {
      proto.put = put;
    }
    expect(j.error).not.toBeNull();
    expect(await store.chunks('r2')).toHaveLength(1);
    const r = (await readRun(store, 'r2'))!;
    expect(r.ok).toBe(true);
    expect(r.head.chunks).toBe(1);
    expect(r.head.resume).toEqual({ resumeAt: 'chunk end' });
    // Reopened: the run goes on from the last validated chunk.
    const again = await IndexedDbRunStore.open();
    const k = new ChunkedJournal(again, 'r2', 'h0', { chunks: r.chunks.length, lastHash: r.lastHash });
    for (let i = CHUNK_SIZE; i < 2 * CHUNK_SIZE + 5; i++) k.push(link(i));
    await k.seal('finished');
    const done = (await readRun(again, 'r2'))!;
    expect(done.ok).toBe(true);
    expect(done.chunks.map((c) => c.links.length)).toEqual([CHUNK_SIZE, CHUNK_SIZE, 5]);
  });
});
