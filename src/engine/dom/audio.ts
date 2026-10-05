import { Howl, Howler } from 'howler';
import type { AssetBank } from './assets';
import type { Cond, Id, ScoreDef } from '../core/types';
import { stemsFor, transitionFor, type TransitionRule } from '../core/score';
import { MusicDirector, ScoreTooLarge, directorFits } from './director';

/**
 * Music (one track at a time, crossfade, a stack for minigames, a one-off track on top)
 * and sound effects. Files are loaded on demand. A track with a score (`audio.scores`, 3.5) is played by the music
 * director in stems where it fits (dom/director.ts), its single mix elsewhere.
 */
export class Audio {
  private tracks = new Map<string, Howl>();
  /** The playing track: its Howl (a single mix), or none when the director plays its stems. */
  private current: { id: string; howl?: Howl } | null = null;
  private director: MusicDirector | null = null;
  /** Reads the game's state for a score's mix (set by the app). */
  holds: (c: Cond) => boolean = () => false;
  private stack: string[] = [];
  musicOn = true;
  sfxOn = true;
  private volume = 0.55;
  /** Settings multipliers (0 to 1). */
  private vol = { music: 1, sfx: 1, voice: 1 };
  private speaking: Howl | null = null;

  /** The browser only allows sound after a gesture: we wait for the first one, and replay whatever was requested before. */
  private unlocked = false;
  private pending: string | null = null;

  constructor(private bank: AssetBank, private files: { music?: Record<string, string>; sfx?: Record<string, string>; voice?: Record<string, string>; scores?: Record<Id, ScoreDef>; maxDecodedMB?: number; transitions?: TransitionRule[] }, opts: { stems?: boolean } = {}) {
    const pcm = Object.values(files.scores ?? {}).map((s) => s.pcmBytes);
    if (opts.stems ?? directorFits(pcm.includes(undefined) ? undefined : Math.max(0, ...(pcm as number[])))) this.stemsWanted = true;
    const unlock = () => {
      if (this.unlocked) return;
      this.unlocked = true;
      try { Howler.ctx?.resume?.(); } catch { /* no context */ }
      const id = this.pending; this.pending = null;
      if (id) this.play(id);
    };
    for (const ev of ['pointerdown', 'touchend', 'keydown']) document.addEventListener(ev, unlock, { capture: true, passive: true });
    const wake = () => { const c = this.director?.ctx as AudioContext | undefined; if (c?.state === 'suspended') void c.resume().catch(() => {}); };
    for (const ev of ['pointerdown', 'touchend', 'keydown']) document.addEventListener(ev, wake, { capture: true, passive: true });
  }

  /** Volume set "by hand": Howler's fade gets lost when the file isn't loaded yet, and the track would play silently. */
  private fadeIn(h: Howl, ms = 600) {
    const steps = 12; let i = 0;
    h.volume(0);
    const t = setInterval(() => { i++; if (this.current?.howl !== h || !this.musicOn) { clearInterval(t); return; } h.volume(this.volume * this.vol.music * i / steps); if (i >= steps) clearInterval(t); }, ms / steps);
  }

  /** Playback refused (missing gesture): restart from the beginning on the next gesture. */
  private retryOnGesture(h: Howl) {
    const again = () => { if (this.current?.howl === h && this.musicOn) { h.seek(0); h.play(); } };
    for (const ev of ['pointerdown', 'touchend', 'keydown']) document.addEventListener(ev, again, { once: true, capture: true, passive: true });
  }

  private howl(kind: 'music' | 'sfx' | 'voice', id: string, loop: boolean): Howl | null {
    const key = `${kind}:${id}`;
    const file = this.files[kind]?.[id];
    if (!file) return null;
    let h = this.tracks.get(key);
    if (!h) {
      h = new Howl({ src: [kind === 'music' ? this.bank.music(file) : kind === 'voice' ? this.bank.voice(file) : this.bank.sfx(file)], loop, html5: kind === 'music', preload: true });
      this.tracks.set(key, h);
    }
    return h;
  }

  hasVoice(id: string) { return !!this.files.voice?.[id]; }

  /** Plays a voice clip; resolves when it ends (right away if sound is off or the clip is missing). */
  voice(id: string): Promise<void> {
    this.speaking?.stop(); this.speaking = null;
    if (!this.sfxOn || !this.unlocked || this.vol.voice <= 0) return Promise.resolve();
    const h = this.howl('voice', id, false);
    if (!h) return Promise.resolve();
    this.speaking = h;
    // The music steps back while someone speaks, and comes back after (3.4).
    const m = this.current?.howl;
    if (m && this.musicOn) m.fade(m.volume(), this.volume * 0.35, 150);
    const undo = !m && this.musicOn ? this.director?.duck(0.35) : undefined;
    const back = () => { const c = this.current?.howl; if (c && this.musicOn && this.speaking === null) c.fade(c.volume(), this.volume, 400); if (this.speaking === null) undo?.(); };
    return new Promise((res) => {
      h.off('end'); h.off('playerror'); h.off('loaderror');
      h.once('end', () => { if (this.speaking === h) this.speaking = null; back(); res(); });
      h.once('playerror', () => { if (this.speaking === h) this.speaking = null; back(); res(); }); h.once('loaderror', () => { if (this.speaking === h) this.speaking = null; back(); res(); });
      h.volume(0.9 * this.vol.voice); h.seek(0); h.play();
    });
  }

  /** Settings: multipliers on music, sound effects and voice. */
  setVolumes(music: number, sfx: number, voice: number) {
    this.vol = { music, sfx, voice };
    const c = this.current?.howl;
    if (c && this.musicOn) c.volume(this.volume * music);
    this.director?.volume(this.musicOn ? this.volume * music : 0);
  }

  private stemsWanted = false;
  /** Scores the director cannot keep in memory (dom/director.ts `ScoreTooLarge`): played as their single mix. */
  private mixOnly = new Set<string>();
  /** Whether a score plays as stems here (the asset graph's preload follows it). */
  get stemsOn() { return this.stemsWanted; }
  /** The director, made on the first score played after a gesture (an AudioContext needs one). */
  private directorFor(): MusicDirector | null {
    if (!this.stemsWanted) return null;
    if (!this.director) {
      const ctx = Howler.usingWebAudio && Howler.ctx ? Howler.ctx : new AudioContext();
      this.director = new MusicDirector(ctx);
      if (this.files.maxDecodedMB) this.director.maxDecodedBytes = this.files.maxDecodedMB * 1024 * 1024;
      this.director.volume(this.musicOn ? this.volume * this.vol.music : 0);
    }
    return this.director;
  }

  /** The score's stems, as URLs. */
  private stemUrls(score: ScoreDef) { return Object.fromEntries(Object.entries(score.stems).map(([k, f]) => [k, this.bank.music(f)])); }

  /** The game's state changed: the playing score's mix follows it (on its grid). */
  remix() {
    const id = this.current?.id;
    const score = id ? this.files.scores?.[id] : undefined;
    const d = this.director;
    if (score && d && !this.current?.howl && d.current === id) d.mix(stemsFor(score, this.holds));
  }

  /**
   * A short cue on the next beat of the playing score: `{ music: { stinger } }`, a track of `audio.music` or a sound
   * of `audio.sfx`. With a single mix (no director), at once: a track over the ducked music, a sound as a sound.
   */
  stinger(id: string) {
    if (!this.unlocked) return;
    const track = this.files.music?.[id], sound = this.files.sfx?.[id];
    const d = this.director;
    if (d?.current && !this.current?.howl && this.musicOn && (track || sound)) {
      // On the music's bus: a stinger is part of the score (its level follows the music volume). One that does not fit
      // in the decoded audio beside the score (null, 3.7.1) is streamed instead: not decoded, so the cap holds.
      void d.stinger(track ? this.bank.music(track) : this.bank.sfx(sound!))
        .then((at) => { if (at === null) { if (track) this.once(id); else this.sfx(id); } }).catch(() => {});
      return;
    }
    if (track) this.once(id); else if (sound) this.sfx(id);
  }

  /** Where the music is (3.6): its id and its position in the file, in seconds (a save keeps it). */
  musicPhase(): { id: string; at: number } | null {
    const c = this.current;
    if (!c) return null;
    if (c.howl) { const at = c.howl.seek(); return { id: c.id, at: typeof at === 'number' ? at : 0 }; }
    const at = this.director?.current === c.id ? this.director.position : null;
    return at === null || at === undefined ? null : { id: c.id, at };
  }

  /**
   * A loaded save's music (3.6.1), the third intent besides `play` (the story's, with its transitions) and `stop`:
   * whatever plays or is scheduled stops at once, then the saved track starts at its saved point, even when it is the
   * one playing. No transition and no bridge until `restored()`, which the app calls once the save is in place (the
   * room it enters then asks for this same track: only its mix follows). `null`: a save without music, only the cut.
   */
  restore(phase: { id: string; at: number } | null) {
    this.restoring = true;
    this.resume = phase;
    const c = this.current;
    // The same track as a single mix: only its position moves.
    if (phase && c?.howl && c.id === phase.id && this.unlocked) { c.howl.seek(phase.at); this.resume = null; return; }
    this.current = null;
    this.pending = null;
    if (c?.howl) { const h = c.howl; h.fade(h.volume(), 0, 150); setTimeout(() => h.stop(), 200); }
    if (!phase) { this.director?.stop(150); return; }
    if (!this.unlocked) { this.director?.stop(150); this.pending = phase.id; return; }
    this.start(phase.id, phase.at, 'restore');
  }
  /** The save is in place: `play` takes transitions again. */
  restored() { this.restoring = false; }
  private restoring = false;
  /** What a save made now should keep: a phase not resumed yet, else where the music is. */
  phaseToSave(): { id: string; at: number } | null { return this.resume ?? this.musicPhase(); }
  /** A saved phase not started yet (before the first gesture, or while the director decodes): kept until it plays. */
  private resume: { id: string; at: number } | null = null;

  play(id: string) {
    if (this.current?.id === id) { this.remix(); return; }
    if (!this.unlocked) { this.pending = id; return; }
    this.start(id, this.resume?.id === id ? this.resume.at : 0, this.restoring ? 'restore' : 'play');
  }

  /**
   * The only way a track starts. `play`: from a score the director plays, the game's transition rule if one names both
   * (3.6). `restore`: at `offset` at once, no transition. A score that fails falls back to its single mix at the same
   * `offset` (3.6.1: the phase is kept until something actually plays).
   */
  private start(id: string, offset: number, mode: 'play' | 'restore') {
    const prev = this.current;
    this.current = null;
    if (prev?.howl) { const ph = prev.howl; ph.fade(ph.volume(), 0, 600); setTimeout(() => ph.stop(), 650); }
    const score = this.files.scores?.[id];
    const d = score && !this.mixOnly.has(id) ? this.directorFor() : null;
    if (score && d) {
      this.current = { id };
      const urls = this.stemUrls(score), stems = stemsFor(score, this.holds);
      let done: Promise<void>;
      if (mode === 'restore') done = d.restore(id, score, urls, stems, offset);
      else {
        const rule = prev && !prev.howl && d.current === prev.id ? transitionFor(this.files.transitions, prev.id, id) : undefined;
        const bridge = rule?.bridge && this.files.music?.[rule.bridge] ? this.bank.music(this.files.music[rule.bridge]) : undefined;
        const transition = rule ? { at: rule.at, fadeBeats: rule.fadeBeats, bridge } : undefined;
        done = d.play(id, score, urls, stems, { offset, transition });
      }
      void done.then(() => { if (this.resume?.id === id && d.current === id) this.resume = null; }, (e) => {
        // A score too large for the director's memory: its single mix from now on (the others keep their stems). A
        // stem that does not load: the single mix instead, for every score. Either way from the same point.
        if (e instanceof ScoreTooLarge) this.mixOnly.add(id); else this.stemsWanted = false;
        if (this.current?.id === id && !this.current.howl) { this.current = null; this.start(id, offset, 'restore'); }
      });
      return;
    }
    this.director?.stop(mode === 'restore' ? 150 : 600);
    const h = this.howl('music', id, true);
    if (!h) return;
    this.current = { id, howl: h };
    if (this.resume?.id === id) this.resume = null;
    if (!this.musicOn) return;
    h.off('playerror'); h.once('playerror', () => this.retryOnGesture(h));
    h.volume(0); h.play(); if (offset) h.seek(offset); this.fadeIn(h);
    // If playback had to wait on loading, make sure the volume is right once it has actually started.
    h.once('play', () => { if (this.current?.howl === h && this.musicOn && h.volume() < this.volume * 0.5) this.fadeIn(h, 300); });
  }

  push(id: string) { const cur = this.current?.id ?? this.pending; if (cur) this.stack.push(cur); this.play(id); }
  pop() { const id = this.stack.pop(); if (id) this.play(id); else this.stop(); }
  stop() {
    this.pending = null; this.resume = null; const c = this.current; this.current = null;
    if (c?.howl) { const h = c.howl; h.fade(h.volume(), 0, 500); setTimeout(() => h.stop(), 550); }
    this.director?.stop(500);
  }

  /** A one-off track on top: the music ducks then comes back. */
  once(id: string) {
    if (!this.unlocked) return;
    const h = this.howl('music', id, false);
    if (!h || !this.musicOn) return;
    const c = this.current?.howl;
    c?.fade(c.volume(), 0.08, 300);
    const undo = !c ? this.director?.duck(0.08, 300) : undefined;
    h.volume(0.8); h.seek(0); h.play();
    h.off('end'); h.once('end', () => { if (this.current?.howl === c) c?.fade(c.volume(), this.volume, 600); undo?.(); });
  }

  sfx(id: string) {
    if (!this.sfxOn || this.vol.sfx <= 0) return;
    const h = this.howl('sfx', id, false);
    h?.volume(0.8 * this.vol.sfx); h?.play();
  }

  /** Looping sound effect, stopped by the returned function. */
  loop(id: string): () => void {
    if (!this.sfxOn) return () => {};
    const h = this.howl('sfx', id, false);
    if (!h) return () => {};
    h.loop(true); const n = h.play();
    return () => h.stop(n);
  }

  setMusic(on: boolean) {
    this.musicOn = on;
    this.director?.volume(on ? this.volume * this.vol.music : 0);
    const c = this.current?.howl;
    if (!c) return;
    if (on) { if (!c.playing()) c.play(); this.fadeIn(c, 400); } else c.pause();
  }
  setSfx(on: boolean) { this.sfxOn = on; }
  muteAll(m: boolean) { Howler.mute(m); if (this.director && this.director.ctx !== Howler.ctx) this.director.master.gain.value = m ? 0 : this.musicOn ? this.volume * this.vol.music : 0; }
}
