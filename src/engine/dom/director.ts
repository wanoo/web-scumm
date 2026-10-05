// The music director (3.5): a score's stems on Web Audio, from decoded buffers. Every stem of a score starts at the
// same instant of the audio clock and loops over the same window, so they stay sample-locked for as long as the score
// plays; a change of mix (the game's state: a flag, the room, the active character) moves stem gains on the next beat
// or bar, over a crossfade in beats (core/score.ts decides when, this file only schedules it). Entering another room
// with the same score changes nothing but the mix: the music goes on. A stinger plays on the next beat. Works on an
// OfflineAudioContext too (scripts/e2e-music.mjs renders thirty minutes of it and counts the samples).
import type { Id } from '../core/types';
import { beatSec, crossfade, landing, loopWindow, nextBoundary, positionAt, type GainStep, type Landing, type ScoreDef } from '../core/score';

interface Playing {
  id: Id;
  score: ScoreDef;
  start: number;
  /** The stems' length in seconds (they all have the same). */
  duration: number;
  sources: AudioBufferSourceNode[];
  gains: Map<Id, GainNode>;
  bus: GainNode;
  stems: Id[];
  /** The last ramp scheduled per stem: where its gain is at any instant. */
  ramps: Map<Id, GainStep>;
}

/** A stem's gain at `t`, from its last ramp. */
const gainAt = (r: GainStep | undefined, fallback: number, t: number) =>
  !r ? fallback : t <= r.at ? r.from : t >= r.until ? r.to : r.from + ((r.to - r.from) * (t - r.at)) / (r.until - r.at);

/** A score whose stems decode to more than the director's cap: it plays as its single mix (dom/audio.ts). */
export class ScoreTooLarge extends Error {
  constructor(readonly id: Id, readonly bytes: number, readonly cap: number) { super(`score "${id}" decodes to ${Math.round(bytes / 1048576)} MB, over the ${Math.round(cap / 1048576)} MB the director keeps`); }
}

export class MusicDirector {
  readonly master: GainNode;
  /** Decoded files, least recently used first (3.6): over `maxDecodedBytes`, the oldest not playing are let go. */
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private sizes = new Map<string, number>();
  /** The most decoded audio kept (default 160 MB: the demo's theme is 97 MB). */
  maxDecodedBytes = 160 * 1024 * 1024;
  private playing: Playing | null = null;
  /**
   * Counts the requests (`play`, `stop`): a score whose stems finish decoding after a later request is dropped, so a
   * slow score asked first never replaces one asked after it, and `stop()` also cancels a score still loading.
   */
  private gen = 0;
  private want: Id | null = null;
  /** How far ahead a change is scheduled at the least (the audio thread takes it from there). */
  lead = 0.05;

  constructor(readonly ctx: BaseAudioContext, private fetchBuffer: (url: string) => Promise<ArrayBuffer> = (u) => fetch(u).then((r) => r.arrayBuffer())) {
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
  }

  get current(): Id | null { return this.playing?.id ?? null; }
  /** The last transition scheduled (tests, the Studio): when the old score let go, and when the new one starts. */
  lastTransition: { from: Id; to: Id; at: number; start: number } | null = null;

  /** Where the playing score is in its file, in seconds (a save keeps it, 3.6), or null. */
  get position(): number | null {
    const p = this.playing;
    if (!p) return null;
    return positionAt(Math.max(0, this.ctx.currentTime - p.start), loopWindow(p.score, p.duration));
  }

  /** The score asked for whose stems are still decoding (null: none). */
  get loading(): Id | null { return this.want; }
  /** When the playing score started, on the audio clock (tests, the Studio's mixer). */
  get startedAt(): number | null { return this.playing?.start ?? null; }
  get stems(): Id[] { return this.playing?.stems ?? []; }
  /** The playing score's file length (its stems'), in seconds. */
  get duration(): number | null { return this.playing?.duration ?? null; }

  /** The decoded audio kept, in bytes (frames × channels × 4). */
  get decodedBytes(): number { let n = 0; for (const b of this.sizes.values()) n += b; return n; }
  /** The files kept, least recently used first. */
  get cached(): string[] { return [...this.buffers.keys()]; }

  /** Decodes a file once (the same promise for every caller), and marks it as the most recently used. */
  buffer(url: string): Promise<AudioBuffer> {
    let p = this.buffers.get(url);
    if (p) { this.buffers.delete(url); this.buffers.set(url, p); return p; }
    p = this.fetchBuffer(url).then((b) => this.ctx.decodeAudioData(b)).then((buf) => {
      if (this.buffers.get(url) === p) this.sizes.set(url, buf.length * buf.numberOfChannels * 4);
      return buf;
    });
    this.buffers.set(url, p);
    p.catch(() => { if (this.buffers.get(url) === p) { this.buffers.delete(url); this.sizes.delete(url); } });
    return p;
  }

  /** Lets go of the least recently used files, never `keep`'s, until the cap holds (or nothing else is left). */
  private evict(keep: Set<string>) {
    for (const url of [...this.buffers.keys()]) {
      if (this.decodedBytes <= this.maxDecodedBytes) return;
      if (keep.has(url) || !this.sizes.has(url)) continue;
      this.buffers.delete(url); this.sizes.delete(url);
    }
  }

  /**
   * Plays a score with these stems sounding. The same score already playing: only the mix changes (on its grid).
   * `at`: when it starts on the audio clock (default: as soon as its stems are decoded); `fadeMs`: its fade-in.
   * `offset`: where in the file it starts (seconds; a save's phase, 3.6). `transition` (3.6): with a score playing,
   * the new one starts where the old reaches `at` on its grid, after `bridge` (a file played once) if any, the old
   * fading out over `fadeBeats` of its beats (0: cut on the downbeat).
   * Resolves once it is scheduled, or once a later request has made it stale (then nothing is played). Rejects when a
   * stem does not load and this request is still the latest.
   */
  async play(id: Id, score: ScoreDef, urls: Record<Id, string>, stems: Id[], opts: { at?: number; fadeMs?: number; offset?: number; transition?: { at?: Landing; bridge?: string; fadeBeats?: number } } = {}): Promise<void> {
    const g = ++this.gen;
    if (this.playing?.id === id) { this.want = null; this.mix(stems); return; }
    // Too large to keep, by its declared weight: not even downloaded.
    if (score.pcmBytes !== undefined && score.pcmBytes > this.maxDecodedBytes) { this.want = null; throw new ScoreTooLarge(id, score.pcmBytes, this.maxDecodedBytes); }
    this.want = id;
    let buffers: (readonly [string, AudioBuffer])[], bridge: AudioBuffer | null;
    try {
      [buffers, bridge] = await Promise.all([
        Promise.all(Object.keys(score.stems).map(async (s) => [s, await this.buffer(urls[s])] as const)),
        opts.transition?.bridge ? this.buffer(opts.transition.bridge) : Promise.resolve(null),
      ]);
    } catch (e) {
      if (g !== this.gen) return;
      this.want = null;
      throw e;
    }
    if (g !== this.gen) return;
    this.want = null;
    if (this.playing?.id === id) { this.mix(stems); return; }
    // The other scores make room; a score that alone is over the cap plays as its mix.
    const mine = new Set([...Object.keys(score.stems).map((s) => urls[s]), ...(opts.transition?.bridge ? [opts.transition.bridge] : [])]);
    this.evict(mine);
    const bytes = buffers.reduce((n, [, b]) => n + b.length * b.numberOfChannels * 4, 0);
    if (bytes > this.maxDecodedBytes) { for (const u of mine) { this.buffers.delete(u); this.sizes.delete(u); } throw new ScoreTooLarge(id, bytes, this.maxDecodedBytes); }
    const ctx = this.ctx;
    const prev = this.playing;
    let start = opts.at ?? ctx.currentTime + this.lead;
    let fade = (opts.fadeMs ?? 600) / 1000;
    if (prev && opts.transition) {
      // On the old score's grid: it plays on to the landing, then fades (or stops on the downbeat), and the bridge then
      // the new score take over from there.
      const t = landing(prev.score, prev.start, ctx.currentTime, opts.transition.at ?? 'bar', this.lead, prev.duration);
      const out = Math.max((opts.transition.fadeBeats ?? 0) * beatSec(prev.score), 0.02);
      this.playing = null;
      const now = ctx.currentTime;
      prev.bus.gain.cancelScheduledValues(now); prev.bus.gain.setValueAtTime(prev.bus.gain.value, now);
      prev.bus.gain.setValueAtTime(prev.bus.gain.value, t); prev.bus.gain.linearRampToValueAtTime(0, t + out);
      for (const s of prev.sources) { try { s.stop(t + out + 0.02); } catch { /* not started */ } }
      if (bridge) { const b = ctx.createBufferSource(); b.buffer = bridge; b.connect(this.master); b.start(t); }
      start = t + (bridge?.duration ?? 0);
      fade = bridge ? 0 : out > 0.02 ? out : 0;
      this.lastTransition = { from: prev.id, to: id, at: t, start };
    } else this.fadeOut(600);
    const offset = opts.offset ?? 0;
    const bus = ctx.createGain();
    bus.connect(this.master);
    if (fade > 0) { bus.gain.setValueAtTime(0, start); bus.gain.linearRampToValueAtTime(1, start + fade); }
    const gains = new Map<Id, GainNode>(), sources: AudioBufferSourceNode[] = [];
    for (const [stem, buf] of buffers) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(stems.includes(stem) ? 1 : 0, 0);
      g.connect(bus);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const [a, b] = loopWindow(score, buf.duration);
      src.loop = true; src.loopStart = a; src.loopEnd = b;
      src.connect(g);
      src.start(start, Math.min(offset, buf.duration));
      gains.set(stem, g); sources.push(src);
    }
    // The grid counts from where the file's 0 would have been: an offset inside the first pass keeps the bars in place.
    this.playing = { id, score, start: start - offset, duration: Math.min(...buffers.map(([, b]) => b.duration)), sources, gains, bus, stems: [...stems], ramps: new Map() };
  }

  /**
   * Changes the mix on the score's grid (its `quantize`), crossfading over its `fadeBeats`. `now`: the instant the
   * change is asked for (default: the audio clock). Returns the boundary it lands on, or null (nothing to change).
   */
  mix(stems: Id[], now = this.ctx.currentTime): number | null {
    const p = this.playing;
    if (!p) return null;
    const same = stems.length === p.stems.length && stems.every((s) => p.stems.includes(s));
    if (same) return null;
    const at = nextBoundary(p.score, p.start, now, p.score.quantize ?? 'bar', this.lead, p.duration);
    for (const step of crossfade(p.score, p.stems, stems, at)) {
      const g = p.gains.get(step.stem)!;
      const from = gainAt(p.ramps.get(step.stem), p.stems.includes(step.stem) ? 1 : 0, at);
      g.gain.cancelScheduledValues(at);
      g.gain.setValueAtTime(from, at);
      g.gain.linearRampToValueAtTime(step.to, step.until);
      p.ramps.set(step.stem, { ...step, from });
    }
    p.stems = [...stems];
    return at;
  }

  /** A one-off cue on the next beat of the playing score (at once without one). Returns when it starts. */
  async stinger(url: string, now = this.ctx.currentTime, gain = 0.9): Promise<number> {
    const buf = await this.buffer(url);
    const p = this.playing;
    const at = p ? nextBoundary(p.score, p.start, Math.max(now, this.ctx.currentTime), 'beat', this.lead, p.duration) : Math.max(now, this.ctx.currentTime) + this.lead;
    const g = this.ctx.createGain(); g.gain.value = gain; g.connect(this.master);
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.connect(g); src.start(at);
    return at;
  }

  /** The score steps back (a voice, a one-off track) to `level`, then `undo()` brings it back. */
  duck(level: number, ms = 150): () => void {
    const p = this.playing;
    if (!p) return () => {};
    const t = this.ctx.currentTime;
    p.bus.gain.cancelScheduledValues(t); p.bus.gain.setValueAtTime(p.bus.gain.value, t); p.bus.gain.linearRampToValueAtTime(level, t + ms / 1000);
    return () => { if (this.playing !== p) return; const u = this.ctx.currentTime; p.bus.gain.cancelScheduledValues(u); p.bus.gain.setValueAtTime(p.bus.gain.value, u); p.bus.gain.linearRampToValueAtTime(1, u + 0.4); };
  }

  /** Fades the score out and releases it; a score still loading will not start. */
  stop(ms = 500) {
    this.gen++;
    this.want = null;
    this.fadeOut(ms);
  }

  private fadeOut(ms: number) {
    const p = this.playing;
    if (!p) return;
    this.playing = null;
    const t = this.ctx.currentTime, end = t + ms / 1000;
    p.bus.gain.cancelScheduledValues(t); p.bus.gain.setValueAtTime(p.bus.gain.value, t); p.bus.gain.linearRampToValueAtTime(0, end);
    for (const s of p.sources) { try { s.stop(end + 0.02); } catch { /* not started */ } }
  }

  /** Music volume (settings × the game's level), ramped so a change never clicks. */
  volume(v: number) {
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t); this.master.gain.setValueAtTime(this.master.gain.value, t); this.master.gain.linearRampToValueAtTime(v, t + 0.05);
  }
}

/** Decoded stems a device of unknown memory is trusted with (3.5.1): the demo's theme is 101 MB. */
export const UNKNOWN_MEMORY_PCM = 128 * 1024 * 1024;

/**
 * Whether the director plays stems here, or the single mix does (the same music in one file): Web Audio present, no
 * Save-Data, not a low-end device (2 GB of memory or less, or 2 cores or less). A browser that does not tell its
 * memory (Safari, iOS included) gets the stems only when the scores' decoded weight is known (`ScoreDef.pcmBytes`,
 * the largest) and at most `UNKNOWN_MEMORY_PCM`.
 */
export function directorFits(pcmBytes?: number, nav: Navigator = navigator): boolean {
  const n = nav as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  if (typeof AudioContext === 'undefined') return false;
  if (n.connection?.saveData) return false;
  if ((n.hardwareConcurrency ?? 8) <= 2) return false;
  if (n.deviceMemory === undefined) return pcmBytes !== undefined && pcmBytes <= UNKNOWN_MEMORY_PCM;
  return n.deviceMemory > 2;
}
