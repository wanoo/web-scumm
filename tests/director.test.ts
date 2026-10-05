// The music director's requests (3.5.1): a score asked for, then another, whose stems finish decoding in the other
// order; a stop while a score loads; a stem that fails. Only the latest request plays. A fake audio context records
// what starts (the real Web Audio is scripts/e2e-music.mjs's).
import { describe, expect, it } from 'vitest';
import { MusicDirector, ScoreTooLarge, directorFits, UNKNOWN_MEMORY_PCM } from '../src/engine/dom/director';
import type { ScoreDef } from '../src/engine/core/types';

const param = () => ({ value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} });
function fakeCtx() {
  const started: string[] = [];
  const starts: { name: string; when: number; offset: number }[] = [];
  const ctx = {
    currentTime: 0,
    destination: {},
    createGain: () => ({ gain: param(), connect() {} }),
    createBufferSource: () => {
      const src = { buffer: null as null | { name: string }, loop: false, loopStart: 0, loopEnd: 0, connect() {}, stop() {}, start(when = 0, offset = 0) { started.push(src.buffer!.name); starts.push({ name: src.buffer!.name, when, offset }); } };
      return src;
    },
    decodeAudioData: async (b: ArrayBuffer & { name?: string }) => ({ name: (b as unknown as { name: string }).name, duration: 8, length: 1000, numberOfChannels: 2 }),
  };
  return { ctx: ctx as unknown as BaseAudioContext, started, starts, raw: ctx };
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

describe('from one score to another (3.6)', () => {
  // 120 BPM: a beat is 0.5 s, a bar 2 s. Each fake file lasts 8 s.
  it('the new score starts on the old one\'s landing, after its bridge', async () => {
    const { ctx, starts, raw } = fakeCtx(), f = files();
    const d = new MusicDirector(ctx, f.fetch);
    d.lead = 0;
    const a = d.play('A', score('A'), urls('A'), ['a']); f.load('A-a'); f.load('A-b'); await a;
    raw.currentTime = 0.7;
    const b = d.play('B', score('B'), urls('B'), ['a'], { transition: { at: 'bar' } }); f.load('B-a'); f.load('B-b'); await b;
    expect(d.lastTransition).toEqual({ from: 'A', to: 'B', at: 2, start: 2 });
    expect(starts.filter((s) => s.name.startsWith('B')).map((s) => s.when)).toEqual([2, 2]);
    raw.currentTime = 2.3;
    const c = d.play('C', score('C'), urls('C'), ['a'], { transition: { at: 'beat', bridge: 'jingle' } });
    f.load('C-a'); f.load('C-b'); f.load('jingle'); await c;
    // B started at 2: its next beat after 2.3 is 2.5; the bridge (8 s) plays there, then C.
    expect(d.lastTransition).toEqual({ from: 'B', to: 'C', at: 2.5, start: 10.5 });
    expect(starts.find((s) => s.name === 'jingle')?.when).toBe(2.5);
    expect(starts.filter((s) => s.name.startsWith('C')).map((s) => s.when)).toEqual([10.5, 10.5]);
  });

  it('a save\'s phase: every stem starts at that point of the file, and the grid stays the file\'s', async () => {
    const { ctx, starts, raw } = fakeCtx(), f = files();
    const d = new MusicDirector(ctx, f.fetch);
    d.lead = 0;
    raw.currentTime = 100;
    const a = d.play('A', score('A'), urls('A'), ['a'], { offset: 3 }); f.load('A-a'); f.load('A-b'); await a;
    expect(starts.map((s) => [s.when, s.offset])).toEqual([[100, 3], [100, 3]]);
    expect(d.startedAt).toBe(97);
    raw.currentTime = 101.5;
    expect(d.position).toBeCloseTo(4.5);
    // The next bar of the file is at 6 s of it: 103 on the clock.
    expect(d.mix(['a', 'b'])).toBe(103);
  });
});
