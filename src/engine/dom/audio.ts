import { Howl, Howler } from 'howler';
import type { AssetBank } from './assets';

/**
 * Music (one track at a time, crossfade, a stack for minigames, a one-off track on top)
 * and sound effects. Files are loaded on demand.
 */
export class Audio {
  private tracks = new Map<string, Howl>();
  private current: { id: string; howl: Howl } | null = null;
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

  constructor(private bank: AssetBank, private files: { music?: Record<string, string>; sfx?: Record<string, string>; voice?: Record<string, string> }) {
    const unlock = () => {
      if (this.unlocked) return;
      this.unlocked = true;
      try { Howler.ctx?.resume?.(); } catch { /* no context */ }
      const id = this.pending; this.pending = null;
      if (id) this.play(id);
    };
    for (const ev of ['pointerdown', 'touchend', 'keydown']) document.addEventListener(ev, unlock, { capture: true, passive: true });
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
    return new Promise((res) => {
      h.off('end'); h.off('playerror'); h.off('loaderror');
      h.once('end', () => { if (this.speaking === h) this.speaking = null; res(); });
      h.once('playerror', () => res()); h.once('loaderror', () => res());
      h.volume(0.9 * this.vol.voice); h.seek(0); h.play();
    });
  }

  /** Settings: multipliers on music, sound effects and voice. */
  setVolumes(music: number, sfx: number, voice: number) {
    this.vol = { music, sfx, voice };
    const c = this.current?.howl;
    if (c && this.musicOn) c.volume(this.volume * music);
  }

  play(id: string) {
    if (this.current?.id === id) return;
    if (!this.unlocked) { this.pending = id; return; }
    const prev = this.current;
    this.current = null;
    if (prev) { prev.howl.fade(prev.howl.volume(), 0, 600); setTimeout(() => prev.howl.stop(), 650); }
    const h = this.howl('music', id, true);
    if (!h) return;
    this.current = { id, howl: h };
    if (!this.musicOn) return;
    h.off('playerror'); h.once('playerror', () => this.retryOnGesture(h));
    h.volume(0); h.play(); this.fadeIn(h);
    // If playback had to wait on loading, make sure the volume is right once it has actually started.
    h.once('play', () => { if (this.current?.howl === h && this.musicOn && h.volume() < this.volume * 0.5) this.fadeIn(h, 300); });
  }

  push(id: string) { const cur = this.current?.id ?? this.pending; if (cur) this.stack.push(cur); this.play(id); }
  pop() { const id = this.stack.pop(); if (id) this.play(id); else this.stop(); }
  stop() { this.pending = null; const c = this.current; this.current = null; if (c) { c.howl.fade(c.howl.volume(), 0, 500); setTimeout(() => c.howl.stop(), 550); } }

  /** A one-off track on top: the music ducks then comes back. */
  once(id: string) {
    if (!this.unlocked) return;
    const h = this.howl('music', id, false);
    if (!h || !this.musicOn) return;
    const c = this.current?.howl;
    c?.fade(c.volume(), 0.08, 300);
    h.volume(0.8); h.seek(0); h.play();
    h.off('end'); h.once('end', () => { if (this.current?.howl === c) c?.fade(c.volume(), this.volume, 600); });
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
    const c = this.current?.howl;
    if (!c) return;
    if (on) { if (!c.playing()) c.play(); this.fadeIn(c, 400); } else c.pause();
  }
  setSfx(on: boolean) { this.sfxOn = on; }
  muteAll(m: boolean) { Howler.mute(m); }
}
