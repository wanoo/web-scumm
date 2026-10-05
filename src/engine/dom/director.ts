// The music director (3.5): a score's stems on Web Audio, from decoded buffers. Every stem of a score starts at the
// same instant of the audio clock and loops over the same window, so they stay sample-locked for as long as the score
// plays; a change of mix (the game's state: a flag, the room, the active character) moves stem gains on the next beat
// or bar, over a crossfade in beats (core/score.ts decides when, this file only schedules it). Entering another room
// with the same score changes nothing but the mix: the music goes on. A stinger plays on the next beat. Works on an
// OfflineAudioContext too (scripts/e2e-music.mjs renders thirty minutes of it and counts the samples).
import type { Id } from '../core/types';
import { crossfade, loopWindow, nextBoundary, type GainStep, type ScoreDef } from '../core/score';

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

export class MusicDirector {
  readonly master: GainNode;
  private buffers = new Map<string, Promise<AudioBuffer>>();
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
  /** The score asked for whose stems are still decoding (null: none). */
  get loading(): Id | null { return this.want; }
  /** When the playing score started, on the audio clock (tests, the Studio's mixer). */
  get startedAt(): number | null { return this.playing?.start ?? null; }
  get stems(): Id[] { return this.playing?.stems ?? []; }
  /** The playing score's file length (its stems'), in seconds. */
  get duration(): number | null { return this.playing?.duration ?? null; }

  /** Decodes a file once (the same promise for every caller). */
  buffer(url: string): Promise<AudioBuffer> {
    let p = this.buffers.get(url);
    if (!p) { p = this.fetchBuffer(url).then((b) => this.ctx.decodeAudioData(b)); this.buffers.set(url, p); this.buffers.get(url)!.catch(() => this.buffers.delete(url)); }
    return p;
  }

  /**
   * Plays a score with these stems sounding. The same score already playing: only the mix changes (on its grid).
   * `at`: when it starts on the audio clock (default: as soon as its stems are decoded); `fadeMs`: its fade-in.
   * Resolves once it is scheduled, or once a later request has made it stale (then nothing is played). Rejects when a
   * stem does not load and this request is still the latest.
   */
  async play(id: Id, score: ScoreDef, urls: Record<Id, string>, stems: Id[], opts: { at?: number; fadeMs?: number } = {}): Promise<void> {
    const g = ++this.gen;
    if (this.playing?.id === id) { this.want = null; this.mix(stems); return; }
    this.want = id;
    let buffers: (readonly [string, AudioBuffer])[];
    try {
      buffers = await Promise.all(Object.keys(score.stems).map(async (s) => [s, await this.buffer(urls[s])] as const));
    } catch (e) {
      if (g !== this.gen) return;
      this.want = null;
      throw e;
    }
    if (g !== this.gen) return;
    this.want = null;
    if (this.playing?.id === id) { this.mix(stems); return; }
    this.fadeOut(600);
    const ctx = this.ctx;
    const start = opts.at ?? ctx.currentTime + this.lead;
    const bus = ctx.createGain();
    bus.connect(this.master);
    const fade = (opts.fadeMs ?? 600) / 1000;
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
      src.start(start, 0);
      gains.set(stem, g); sources.push(src);
    }
    this.playing = { id, score, start, duration: Math.min(...buffers.map(([, b]) => b.duration)), sources, gains, bus, stems: [...stems], ramps: new Map() };
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

/**
 * Whether the director plays stems here, or the single mix does: Web Audio present, no Save-Data, not a low-end
 * device (2 GB of memory or less, or 2 cores or less). The mix is the same music in one file.
 */
export function directorFits(): boolean {
  const n = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  if (typeof AudioContext === 'undefined') return false;
  if (n.connection?.saveData) return false;
  if ((n.deviceMemory ?? 8) <= 2 || (n.hardwareConcurrency ?? 8) <= 2) return false;
  return true;
}
