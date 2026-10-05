// @vitest-environment happy-dom
// The music's three intents (3.6.1): `play` (the story's, with its transitions), `restore` (a loaded save's music, at
// its point, even when it is the one playing, never a transition) and `stop`. Howler and the director are fakes that
// record what they are asked; the director's own lifecycle is tests/director.test.ts's.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScoreDef } from '../src/engine/core/types';

const log: unknown[][] = [];
let refuse: 'large' | 'stem' | null = null;

vi.mock('howler', () => {
  class Howl {
    pos = 0; src: string;
    constructor(o: { src: string[] }) { this.src = o.src[0]; }
    play() { log.push(['howl.play', this.src]); } stop() {} pause() {} playing() { return true; }
    seek(at?: number) { if (at === undefined) return this.pos; this.pos = at; log.push(['howl.seek', this.src, at]); return this; }
    volume() { return 0.5; } fade() {} on() {} off() {} once() {}
  }
  return { Howl, Howler: { ctx: null, usingWebAudio: false, mute() {} } };
});

vi.mock('../src/engine/dom/director', async (orig) => {
  const real = await orig<typeof import('../src/engine/dom/director')>();
  class MusicDirector {
    current: string | null = null;
    position = 0;
    ctx = {};
    master = { gain: { value: 1 } };
    maxDecodedBytes = 0;
    async play(id: string, _s: unknown, _u: unknown, _st: unknown, opts: { offset?: number; transition?: unknown }) { log.push(['play', id, opts.offset ?? 0, !!opts.transition]); return this.settle(id); }
    async restore(id: string, _s: unknown, _u: unknown, _st: unknown, at: number) { log.push(['restore', id, at]); return this.settle(id); }
    private settle(id: string) {
      if (refuse === 'large') throw new real.ScoreTooLarge(id, 2, 1);
      if (refuse === 'stem') throw new Error('404');
      this.current = id;
    }
    mix() { return null; }
    stop() { log.push(['stop']); this.current = null; }
    volume() {} duck() { return () => {}; }
  }
  return { ...real, MusicDirector, directorFits: () => true };
});

const { Audio } = await import('../src/engine/dom/audio');

const score = (n: string): ScoreDef => ({ stems: { a: `${n}-a.mp3` }, bpm: 120 });
const bank = { music: (f: string) => f, sfx: (f: string) => f, voice: (f: string) => f } as never;
const make = () => new Audio(bank, {
  music: { A: 'A.mp3', B: 'B.mp3', C: 'C.mp3', bridge: 'bridge.mp3', plain: 'plain.mp3' },
  scores: { A: score('A'), B: score('B'), C: score('C') },
  transitions: [{ from: '*', to: '*', at: 'bar', bridge: 'bridge' }],
});
const flush = () => new Promise((r) => setTimeout(r, 0));
const gesture = () => document.dispatchEvent(new Event('pointerdown'));

beforeEach(() => { log.length = 0; refuse = null; (globalThis as { AudioContext?: unknown }).AudioContext = class {}; });

describe('the music\'s intents (3.6.1)', () => {
  it('a save loaded while its own score plays starts it again at the saved point', async () => {
    const a = make(); gesture();
    a.play('A'); await flush();
    log.length = 0;
    a.restore({ id: 'A', at: 1.2 });
    a.play('A'); // the room entered by the save asks for it: only its mix follows
    a.restored(); await flush();
    expect(log).toEqual([['restore', 'A', 1.2]]);
  });

  it('a save with another score: no transition, no bridge, even for what the room asks while it loads', async () => {
    const a = make(); gesture();
    a.play('A'); await flush();
    log.length = 0;
    a.restore({ id: 'B', at: 3 });
    a.play('C');
    a.restored(); await flush();
    expect(log).toEqual([['restore', 'B', 3], ['restore', 'C', 0]]);
    // After it, the story's transitions again.
    log.length = 0;
    a.play('A'); await flush();
    expect(log).toEqual([['play', 'A', 0, true]]);
  });

  it('a score that falls back to its mix keeps the saved point', async () => {
    for (const why of ['large', 'stem'] as const) {
      log.length = 0; refuse = why;
      const a = make(); gesture();
      a.restore({ id: 'A', at: 1.2 }); a.restored(); await flush();
      expect(log).toEqual([['restore', 'A', 1.2], ['stop'], ['howl.play', 'A.mp3'], ['howl.seek', 'A.mp3', 1.2]]);
      expect(a.phaseToSave()).toEqual({ id: 'A', at: 1.2 });
    }
  });

  it('a single mix already playing: only its position moves', async () => {
    const a = make(); gesture();
    a.play('plain'); await flush();
    log.length = 0;
    a.restore({ id: 'plain', at: 7 }); a.play('plain'); a.restored();
    expect(log).toEqual([['howl.seek', 'plain.mp3', 7]]);
  });

  it('before the first gesture: the phase waits, a save made meanwhile keeps it, the gesture starts there', async () => {
    const a = make();
    a.restore({ id: 'B', at: 2.5 }); a.play('B'); a.restored();
    expect(a.phaseToSave()).toEqual({ id: 'B', at: 2.5 });
    expect(log.filter((l) => l[0] !== 'stop')).toEqual([]);
    gesture(); await flush();
    expect(log.filter((l) => l[0] !== 'stop')).toEqual([['play', 'B', 2.5, false]]);
  });

  it('a save without music only cuts: the room\'s score then starts from the top, without a transition', async () => {
    const a = make(); gesture();
    a.play('A'); await flush();
    log.length = 0;
    a.restore(null); a.play('B'); a.restored(); await flush();
    expect(log).toEqual([['stop'], ['restore', 'B', 0]]);
  });
});
