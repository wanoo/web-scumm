// The music director (3.5): a score's stems on Web Audio, from decoded buffers. Every stem of a score starts at the
// same instant of the audio clock and loops over the same window, so they stay sample-locked for as long as the score
// plays; a change of mix (the game's state: a flag, the room, the active character) moves stem gains on the next beat
// or bar, over a crossfade in beats (core/score.ts decides when, this file only schedules it). Entering another room
// with the same score changes nothing but the mix: the music goes on. A stinger plays on the next beat. Works on an
// OfflineAudioContext too (scripts/e2e-music.mjs renders thirty minutes of it and counts the samples).
import type { Id } from '../core/types';
import { beatSec, crossfade, landing, loopWindow, nextBoundary, positionAt, type GainStep, type Landing, type ScoreDef } from '../core/score';

/**
 * Something the director has scheduled (3.6.1): a score, a bridge, a stinger. It owns its sources until they are
 * stopped, so nothing it scheduled can sound after a `stop()` or a `restore()`.
 */
interface Voice {
  /** The files it plays (in use: never evicted while it is playing or planned). */
  urls: string[];
  sources: AudioBufferSourceNode[];
  bus: GainNode;
  /** Stops its sources once its fade-out is over (an outgoing score: a stop scheduled up front could not be undone). */
  timer?: ReturnType<typeof setTimeout>;
}

interface Playing extends Voice {
  id: Id;
  score: ScoreDef;
  start: number;
  /** The stems' length in seconds (they all have the same). */
  duration: number;
  gains: Map<Id, GainNode>;
  stems: Id[];
  /** The last ramp scheduled per stem: where its gain is at any instant. */
  ramps: Map<Id, GainStep>;
}

/** A transition scheduled and not landed yet: the old score plays on to `at`, then the bridge, then the new score. */
interface Plan { outgoing: Playing; bridge: Voice | null; incoming: Playing; at: number }

/** A stem's gain at `t`, from its last ramp. */
const gainAt = (r: GainStep | undefined, fallback: number, t: number) =>
  !r ? fallback : t <= r.at ? r.from : t >= r.until ? r.to : r.from + ((r.to - r.from) * (t - r.at)) / (r.until - r.at);

/** A score whose stems decode to more than the director's cap: it plays as its single mix (dom/audio.ts). */
export class ScoreTooLarge extends Error {
  constructor(readonly id: Id, readonly bytes: number, readonly cap: number) { super(`score "${id}" decodes to ${Math.round(bytes / 1048576)} MB, over the ${Math.round(cap / 1048576)} MB the director keeps`); }
}

const bytesOf = (b: AudioBuffer) => b.length * b.numberOfChannels * 4;

export class MusicDirector {
  readonly master: GainNode;
  /** Between the master and everything that sounds (3.6.1): a voice ducks scores, bridges and stingers alike, and never touches their fades. */
  readonly duckBus: GainNode;
  /** Decoded files, least recently used first (3.6): over `maxDecodedBytes`, the oldest not in use are let go. */
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private sizes = new Map<string, number>();
  /** The most decoded audio kept (default 160 MB: the demo's theme is 97 MB). */
  maxDecodedBytes = 160 * 1024 * 1024;
  /** The score heard, or, during a transition, the one that takes over at its landing. */
  private playing: Playing | null = null;
  private plan: Plan | null = null;
  /** What still sounds and is not the score: fading scores, bridges, stingers (3.6.1). */
  private tails = new Set<Voice>();
  /**
   * Counts the requests (`play`, `stop`, `restore`): a score whose stems finish decoding after a later request is
   * dropped, so a slow score asked first never replaces one asked after it, and `stop()` also cancels a score still
   * loading.
   */
  private gen = 0;
  private want: Id | null = null;
  private ducks = 0;
  /** How far ahead a change is scheduled at the least (the audio thread takes it from there). */
  lead = 0.05;

  constructor(readonly ctx: BaseAudioContext, private fetchBuffer: (url: string) => Promise<ArrayBuffer> = (u) => fetch(u).then((r) => r.arrayBuffer())) {
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.duckBus = ctx.createGain();
    this.duckBus.connect(this.master);
  }

  get current(): Id | null { return this.playing?.id ?? null; }
  /**
   * The last transition scheduled (tests, the Studio): when the old score let go, and when the new one starts. `cut`:
   * the decoded audio could not hold both, so the old one stopped at once; `bridge: false`: the bridge did not fit.
   */
  lastTransition: { from: Id; to: Id; at: number; start: number; cut?: true; bridge?: false } | null = null;
  /** The last stinger asked (tests, the Studio): when it starts, or `skipped: 'cap'` when it did not fit (3.7.1). */
  lastStinger: { url: string; at?: number; skipped?: 'cap' } | null = null;
  /** A transition scheduled that has not landed yet: from, to, and when (tests, the Studio). */
  get pending(): { from: Id; to: Id; at: number } | null {
    this.settle();
    return this.plan && { from: this.plan.outgoing.id, to: this.plan.incoming.id, at: this.plan.at };
  }

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
  /** Voices still sounding besides the score (tests): fading scores, bridges, stingers. */
  get tailCount(): number { this.settle(); return this.tails.size; }

  /** Decodes a file once (the same promise for every caller), and marks it as the most recently used. */
  buffer(url: string): Promise<AudioBuffer> {
    let p = this.buffers.get(url);
    if (p) { this.buffers.delete(url); this.buffers.set(url, p); return p; }
    p = this.fetchBuffer(url).then((b) => this.ctx.decodeAudioData(b)).then((buf) => {
      if (this.buffers.get(url) === p) this.sizes.set(url, bytesOf(buf));
      return buf;
    });
    this.buffers.set(url, p);
    p.catch(() => { if (this.buffers.get(url) === p) { this.buffers.delete(url); this.sizes.delete(url); } });
    return p;
  }

  /** The files the score, a planned transition or a bridge still needs: never evicted. */
  private inUse(): Set<string> {
    const s = new Set<string>(this.playing?.urls ?? []);
    if (this.plan) for (const v of [this.plan.outgoing, this.plan.bridge, this.plan.incoming]) for (const u of v?.urls ?? []) s.add(u);
    return s;
  }

  /** Lets go of the least recently used files, never `keep`'s, until the cap holds (or nothing else is left). */
  private evict(keep: Set<string>) {
    for (const url of [...this.buffers.keys()]) {
      if (this.decodedBytes <= this.maxDecodedBytes) return;
      if (keep.has(url) || !this.sizes.has(url)) continue;
      this.buffers.delete(url); this.sizes.delete(url);
    }
  }

  /** Fades a voice out over `ms` and stops its sources (one not started yet never sounds). */
  private release(v: Voice, ms: number) {
    clearTimeout(v.timer); v.timer = undefined;
    this.tails.delete(v);
    const t = this.ctx.currentTime, end = t + ms / 1000;
    v.bus.gain.cancelScheduledValues(t); v.bus.gain.setValueAtTime(v.bus.gain.value, t); v.bus.gain.linearRampToValueAtTime(0, end);
    for (const s of v.sources) { try { s.stop(end + 0.02); } catch { /* not started */ } }
  }

  /** A transition whose landing has passed: the new score is the one heard, the old one and the bridge are tails. */
  private settle(now = this.ctx.currentTime) {
    const pl = this.plan;
    if (!pl || pl.at > now) return;
    this.plan = null;
    this.tails.add(pl.outgoing);
    if (pl.bridge) this.tails.add(pl.bridge);
  }

  /**
   * Undoes a transition that has not landed: the bridge and the new score never sound, the old score plays on as if
   * nothing had been asked. Landed: it settles.
   */
  private cancelPlan(now = this.ctx.currentTime) {
    this.settle(now);
    const pl = this.plan;
    if (!pl) return;
    this.plan = null;
    for (const v of [pl.incoming, pl.bridge]) if (v) { clearTimeout(v.timer); for (const s of v.sources) { try { s.stop(now); } catch { /* not started */ } } }
    const o = pl.outgoing;
    clearTimeout(o.timer); o.timer = undefined;
    o.bus.gain.cancelScheduledValues(now); o.bus.gain.setValueAtTime(1, now);
    this.playing = o;
  }

  /** A voice that stops by itself: it leaves the tails when its last source ends. */
  private track(v: Voice) {
    this.tails.add(v);
    let left = v.sources.length;
    for (const s of v.sources) s.onended = () => { if (--left <= 0) this.tails.delete(v); };
  }

  /**
   * Plays a score with these stems sounding. The same score already playing: only the mix changes (on its grid).
   * `at`: when it starts on the audio clock (default: as soon as its stems are decoded); `fadeMs`: its fade-in.
   * `offset`: where in the file it starts (seconds; a save's phase, 3.6). `transition` (3.6): with a score playing,
   * the new one starts where the old reaches `at` on its grid, after `bridge` (a file played once) if any, the old
   * fading out over `fadeBeats` of its beats (0: cut on the downbeat). A transition asked while another has not landed
   * yet replaces it: the old score plays on toward the new request (3.6.1).
   * Resolves once it is scheduled, or once a later request has made it stale (then nothing is played). Rejects when a
   * stem does not load and this request is still the latest.
   */
  async play(id: Id, score: ScoreDef, urls: Record<Id, string>, stems: Id[], opts: { at?: number; fadeMs?: number; offset?: number; transition?: { at?: Landing; bridge?: string; fadeBeats?: number } } = {}): Promise<void> {
    const g = ++this.gen;
    this.settle();
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
    const ctx = this.ctx;
    this.settle();
    if (this.playing?.id === id) { this.mix(stems); return; }
    // A transition still waiting for its landing is forgotten: the old score is the one heard again.
    this.cancelPlan();
    if (this.playing?.id === id) { this.mix(stems); return; }
    const stemUrls = Object.keys(score.stems).map((s) => urls[s]);
    const bytes = buffers.reduce((n, [, b]) => n + bytesOf(b), 0);
    const drop = (us: Iterable<string>, keep: Set<string>) => { for (const u of us) if (!keep.has(u)) { this.buffers.delete(u); this.sizes.delete(u); } };
    if (bytes > this.maxDecodedBytes) { drop(stemUrls, this.inUse()); throw new ScoreTooLarge(id, bytes, this.maxDecodedBytes); }
    const prev = this.playing;
    // Every decoded file counts (3.6.1): the stems, the bridge, and the score heard until the landing.
    let bridgeUrl = bridge ? opts.transition!.bridge! : null;
    if (bridge && bridgeUrl && bytes + bytesOf(bridge) > this.maxDecodedBytes) { drop([bridgeUrl], new Set([...this.inUse(), ...stemUrls])); bridge = null; bridgeUrl = null; }
    let mine = new Set([...stemUrls, ...(bridgeUrl ? [bridgeUrl] : [])]);
    this.evict(new Set([...mine, ...this.inUse()]));
    let transition = prev && opts.transition ? opts.transition : null;
    let cut = false;
    if (transition && this.decodedBytes > this.maxDecodedBytes) {
      // Both scores cannot be held at once: the old one stops now (its files go), the new one starts without a bridge.
      cut = true; transition = null;
      if (bridgeUrl) { drop([bridgeUrl], new Set(stemUrls)); bridge = null; bridgeUrl = null; mine = new Set(stemUrls); }
    }
    let start = opts.at ?? ctx.currentTime + this.lead;
    let fade = (opts.fadeMs ?? 600) / 1000;
    let plan: Omit<Plan, 'incoming'> | null = null;
    if (prev && transition) {
      // On the old score's grid: it plays on to the landing, then fades (or stops on the downbeat), and the bridge then
      // the new score take over from there. Its sources stop once silent, by a timer a later request can clear.
      const t = landing(prev.score, prev.start, ctx.currentTime, transition.at ?? 'bar', this.lead, prev.duration);
      const out = Math.max((transition.fadeBeats ?? 0) * beatSec(prev.score), 0.02);
      const now = ctx.currentTime;
      prev.bus.gain.cancelScheduledValues(now); prev.bus.gain.setValueAtTime(prev.bus.gain.value, now);
      prev.bus.gain.setValueAtTime(prev.bus.gain.value, t); prev.bus.gain.linearRampToValueAtTime(0, t + out);
      const stopAt = t + out + 0.02;
      prev.timer = setTimeout(() => { prev.timer = undefined; for (const s of prev.sources) { try { s.stop(Math.max(stopAt, ctx.currentTime)); } catch { /* stopped */ } } }, (stopAt - now) * 1000 + 100);
      let bv: Voice | null = null;
      if (bridge && bridgeUrl) {
        const bus = ctx.createGain(); bus.connect(this.duckBus);
        const b = ctx.createBufferSource(); b.buffer = bridge; b.connect(bus); b.start(t);
        bv = { urls: [bridgeUrl], sources: [b], bus };
      }
      start = t + (bridge?.duration ?? 0);
      fade = bridge ? 0 : out > 0.02 ? out : 0;
      plan = { outgoing: prev, bridge: bv, at: t };
      this.lastTransition = { from: prev.id, to: id, at: t, start, ...(transition.bridge && !bridge ? { bridge: false as const } : {}) };
    } else if (prev) {
      this.playing = null;
      if (cut) {
        this.release(prev, 50);
        drop(prev.urls, mine);
        this.lastTransition = { from: prev.id, to: id, at: ctx.currentTime, start, cut: true, ...(opts.transition?.bridge ? { bridge: false as const } : {}) };
      } else { this.release(prev, 600); }
    }
    const offset = opts.offset ?? 0;
    const bus = ctx.createGain();
    bus.connect(this.duckBus);
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
    const incoming: Playing = { id, score, start: start - offset, duration: Math.min(...buffers.map(([, b]) => b.duration)), urls: stemUrls, sources, gains, bus, stems: [...stems], ramps: new Map() };
    this.playing = incoming;
    if (plan) { this.plan = { ...plan, incoming }; if (this.plan.at <= ctx.currentTime) this.settle(); }
    // A score let go is no longer in use: its files may go now if the cap needs it (one still heard until a landing is).
    this.evict(new Set([...mine, ...this.inUse()]));
  }

  /**
   * A save's music (3.6.1): everything scheduled stops at once (a transition, its bridge, a fading score), then this
   * score starts at `at` in its file, even when it is the one playing. No transition, no bridge. Rejects as `play`
   * does (the caller keeps the phase for its fallback).
   */
  restore(id: Id, score: ScoreDef, urls: Record<Id, string>, stems: Id[], at: number): Promise<void> {
    this.stop(150);
    return this.play(id, score, urls, stems, { offset: at, fadeMs: 300 });
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

  /**
   * A one-off cue on the next beat of the playing score (at once without one). Returns when it starts, or null when
   * it was not played. It counts in the decoded audio like the rest: past the cap, the least recently used files not
   * in use go (3.6.1); one that still does not fit beside the score is let go unplayed (3.7.1: the caller streams it,
   * dom/audio.ts), so the cap holds after every stinger.
   */
  async stinger(url: string, now = this.ctx.currentTime, gain = 0.9): Promise<number | null> {
    const g0 = this.gen;
    const buf = await this.buffer(url);
    this.evict(new Set([...this.inUse(), url]));
    if (this.decodedBytes > this.maxDecodedBytes && !this.inUse().has(url)) {
      this.buffers.delete(url); this.sizes.delete(url);
      this.lastStinger = { url, skipped: 'cap' };
      return null;
    }
    const p = this.playing;
    const at = p ? nextBoundary(p.score, p.start, Math.max(now, this.ctx.currentTime), 'beat', this.lead, p.duration) : Math.max(now, this.ctx.currentTime) + this.lead;
    // Asked before a stop or a restore: it does not sound after it.
    if (g0 !== this.gen) return null;
    this.lastStinger = { url, at };
    const bus = this.ctx.createGain(); bus.gain.value = gain; bus.connect(this.duckBus);
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.connect(bus); src.start(at);
    this.track({ urls: [url], sources: [src], bus });
    return at;
  }

  /** Everything the director plays steps back (a voice, a one-off track) to `level`, then `undo()` brings it back. */
  duck(level: number, ms = 150): () => void {
    if (!this.playing) return () => {};
    const k = ++this.ducks, gain = this.duckBus.gain;
    const t = this.ctx.currentTime;
    gain.cancelScheduledValues(t); gain.setValueAtTime(gain.value, t); gain.linearRampToValueAtTime(level, t + ms / 1000);
    return () => { if (k !== this.ducks) return; const u = this.ctx.currentTime; gain.cancelScheduledValues(u); gain.setValueAtTime(gain.value, u); gain.linearRampToValueAtTime(1, u + 0.4); };
  }

  /** Fades out the score and everything else scheduled (a transition, a bridge, a stinger); a score still loading will not start. */
  stop(ms = 500) {
    this.gen++;
    this.want = null;
    const pl = this.plan;
    this.plan = null;
    if (pl) {
      // Neither the bridge nor the new score has sounded yet: they never will. The old one fades from where it is.
      for (const v of [pl.incoming, pl.bridge]) if (v) { clearTimeout(v.timer); for (const s of v.sources) { try { s.stop(this.ctx.currentTime); } catch { /* not started */ } } }
      if (pl.at > this.ctx.currentTime) { this.playing = pl.outgoing; } else { this.tails.add(pl.outgoing); if (pl.bridge) this.tails.add(pl.bridge); }
    }
    const p = this.playing;
    this.playing = null;
    if (p) this.release(p, ms);
    for (const v of [...this.tails]) this.release(v, Math.min(ms, 150));
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
