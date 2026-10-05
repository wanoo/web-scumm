// The music director's requests (3.5.1): a score asked for, then another, whose stems finish decoding in the other
// order; a stop while a score loads; a stem that fails. Only the latest request plays. A fake audio context records
// what starts (the real Web Audio is scripts/e2e-music.mjs's).
import { describe, expect, it } from 'vitest';
import { MusicDirector, ScoreTooLarge, directorFits, UNKNOWN_MEMORY_PCM } from '../src/engine/dom/director';
import type { ScoreDef } from '../src/engine/core/types';

const param = () => ({ value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} });
function fakeCtx() {
  const started: string[] = [];
  const ctx = {
    currentTime: 0,
    destination: {},
    createGain: () => ({ gain: param(), connect() {} }),
    createBufferSource: () => {
      const src = { buffer: null as null | { name: string }, loop: false, loopStart: 0, loopEnd: 0, connect() {}, stop() {}, start() { started.push(src.buffer!.name); } };
      return src;
    },
    decodeAudioData: async (b: ArrayBuffer & { name?: string }) => ({ name: (b as unknown as { name: string }).name, duration: 8, length: 1000, numberOfChannels: 2 }),
  };
  return { ctx: ctx as unknown as BaseAudioContext, started };
}

/** Files that load when the test says so. */
function files() {
  const waiting = new Map<string, { ok: (b: ArrayBuffer) => void; ko: (e: Error) => void }>();
  const fetch = (url: string) => new Promise<ArrayBuffer>((ok, ko) => waiting.set(url, { ok, ko }));
  const load = (url: string) => waiting.get(url)!.ok({ name: url } as unknown as ArrayBuffer);
  const fail = (url: string) => waiting.get(url)!.ko(new Error(`${url}: 404`));
  return { fetch, load, fail };
}

const score = (n: string): ScoreDef => ({ stems: { a: `${n}-a`, b: `${n}-b` }, bpm: 120 });
const urls = (n: string) => ({ a: `${n}-a`, b: `${n}-b` });

describe('music director requests', () => {
  it('a score asked first but decoded last does not replace the one asked after it', async () => {
    const { ctx, started } = fakeCtx(), f = files();
    const d = new MusicDirector(ctx, f.fetch);
    const a = d.play('A', score('A'), urls('A'), ['a']);
    const b = d.play('B', score('B'), urls('B'), ['a']);
    f.load('B-a'); f.load('B-b'); await b;
    f.load('A-a'); f.load('A-b'); await a;
    expect(d.current).toBe('B');
    expect(started).toEqual(['B-a', 'B-b']);
  });

  it('stop() while a score loads: nothing plays', async () => {
    const { ctx, started } = fakeCtx(), f = files();
    const d = new MusicDirector(ctx, f.fetch);
    const a = d.play('A', score('A'), urls('A'), ['a']);
    expect(d.loading).toBe('A');
    d.stop();
    expect(d.loading).toBeNull();
    f.load('A-a'); f.load('A-b'); await a;
    expect(d.current).toBeNull();
    expect(started).toEqual([]);
  });

  it('a stem that fails for a stale score changes nothing; for the latest it rejects', async () => {
    const { ctx, started } = fakeCtx(), f = files();
    const d = new MusicDirector(ctx, f.fetch);
    const a = d.play('A', score('A'), urls('A'), ['a']);
    const b = d.play('B', score('B'), urls('B'), ['a']);
    f.fail('A-a'); await expect(a).resolves.toBeUndefined();
    f.load('B-a'); f.load('B-b'); await b;
    expect(d.current).toBe('B');
    const c = d.play('C', score('C'), urls('C'), ['a']);
    const failed = expect(c).rejects.toThrow('C-b: 404');
    f.fail('C-b');
    await failed;
    expect(d.current).toBe('B');
    expect(d.loading).toBeNull();
    expect(started).toEqual(['B-a', 'B-b']);
  });

  it('the same score asked twice while it loads starts once', async () => {
    const { ctx, started } = fakeCtx(), f = files();
    const d = new MusicDirector(ctx, f.fetch);
    const a1 = d.play('A', score('A'), urls('A'), ['a']);
    const a2 = d.play('A', score('A'), urls('A'), ['a', 'b']);
    f.load('A-a'); f.load('A-b'); await Promise.all([a1, a2]);
    expect(d.current).toBe('A');
    expect(d.stems).toEqual(['a', 'b']);
    expect(started).toEqual(['A-a', 'A-b']);
  });

  it('the playing score asked again cancels a score still loading', async () => {
    const { ctx, started } = fakeCtx(), f = files();
    const d = new MusicDirector(ctx, f.fetch);
    const a = d.play('A', score('A'), urls('A'), ['a']);
    f.load('A-a'); f.load('A-b'); await a;
    const b = d.play('B', score('B'), urls('B'), ['a']);
    await d.play('A', score('A'), urls('A'), ['a']);
    f.load('B-a'); f.load('B-b'); await b;
    expect(d.current).toBe('A');
    expect(started).toEqual(['A-a', 'A-b']);
  });
});

describe('where the director plays stems', () => {
  const nav = (n: object) => ({ hardwareConcurrency: 8, ...n }) as unknown as Navigator;
  const MB = 1024 * 1024;
  it('a device that does not tell its memory gets stems only for a known, light enough score', () => {
    const g = globalThis as { AudioContext?: unknown };
    const had = g.AudioContext;
    g.AudioContext = class {};
    try {
      expect(directorFits(40 * MB, nav({}))).toBe(true);
      expect(directorFits(101376032, nav({}))).toBe(true); // the demo's theme
      expect(directorFits(UNKNOWN_MEMORY_PCM + 1, nav({}))).toBe(false);
      expect(directorFits(undefined, nav({}))).toBe(false);
      // A device that tells: its memory decides, as in 3.5.
      expect(directorFits(undefined, nav({ deviceMemory: 4 }))).toBe(true);
      expect(directorFits(40 * MB, nav({ deviceMemory: 2 }))).toBe(false);
      expect(directorFits(40 * MB, nav({ hardwareConcurrency: 2 }))).toBe(false);
      expect(directorFits(40 * MB, nav({ deviceMemory: 8, connection: { saveData: true } }))).toBe(false);
    } finally { g.AudioContext = had; }
    expect(directorFits(40 * MB, nav({ deviceMemory: 8 }))).toBe(false); // no Web Audio
  });
});

describe('the decoded audio the director keeps (3.6)', () => {
  // Every fake stem decodes to 1000 frames × 2 channels × 4 bytes: 8 000 bytes, 16 000 a score of two stems.
  const loadAll = async (d: MusicDirector, f: ReturnType<typeof files>, n: string) => { const p = d.play(n, score(n), urls(n), ['a']); f.load(`${n}-a`); f.load(`${n}-b`); await p; };

  it('the scores least recently played are let go past the cap; the playing one stays', async () => {
    const { ctx } = fakeCtx(), f = files();
    let fetched = 0;
    const d = new MusicDirector(ctx, (u) => { fetched++; return f.fetch(u); });
    d.maxDecodedBytes = 32000;
    await loadAll(d, f, 'A'); await loadAll(d, f, 'B');
    expect(d.decodedBytes).toBe(32000);
    await loadAll(d, f, 'C');
    expect(d.cached).toEqual(['B-a', 'B-b', 'C-a', 'C-b']);
    expect(d.decodedBytes).toBe(32000);
    // B again: from the cache, and now the most recent; then A comes back from the network and C goes.
    await d.play('B', score('B'), urls('B'), ['a']);
    expect(fetched).toBe(6);
    await loadAll(d, f, 'A');
    expect(fetched).toBe(8);
    expect(d.cached).toEqual(['B-a', 'B-b', 'A-a', 'A-b']);
    expect(d.current).toBe('A');
  });

  it('a score larger than the cap is refused: by its declared weight before any download, else once decoded', async () => {
    const { ctx, started } = fakeCtx(), f = files();
    let fetched = 0;
    const d = new MusicDirector(ctx, (u) => { fetched++; return f.fetch(u); });
    d.maxDecodedBytes = 10000;
    await expect(d.play('A', { ...score('A'), pcmBytes: 16000 }, urls('A'), ['a'])).rejects.toBeInstanceOf(ScoreTooLarge);
    expect(fetched).toBe(0);
    const b = d.play('B', score('B'), urls('B'), ['a']);
    const refused = expect(b).rejects.toThrow(/decodes to 0 MB, over the 0 MB/);
    f.load('B-a'); f.load('B-b');
    await refused;
    expect(d.current).toBeNull();
    expect(d.cached).toEqual([]);
    expect(started).toEqual([]);
  });
});
