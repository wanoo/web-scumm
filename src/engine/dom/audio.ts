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

  /** The browser only allows sound after a gesture: we wait for the first one, and replay whatever was requested before. */
  private unlocked = false;
  private pending: string | null = null;

  constructor(private bank: AssetBank, private files: { music?: Record<string, string>; sfx?: Record<string, string> }) {
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
    const t = setInterval(() => { i++; if (this.current?.howl !== h || !this.musicOn) { clearInterval(t); return; } h.volume(this.volume * i / steps); if (i >= steps) clearInterval(t); }, ms / steps);
  }

  /** Playback refused (missing gesture): restart from the beginning on the next gesture. */
  private retryOnGesture(h: Howl) {
    const again = () => { if (this.current?.howl === h && this.musicOn) { h.seek(0); h.play(); } };
    for (const ev of ['pointerdown', 'touchend', 'keydown']) document.addEventListener(ev, again, { once: true, capture: true, passive: true });
  }

  private howl(kind: 'music' | 'sfx', id: string, loop: boolean): Howl | null {
    const key = `${kind}:${id}`;
    const file = this.files[kind]?.[id];
    if (!file) return null;
    let h = this.tracks.get(key);
    if (!h) {
      h = new Howl({ src: [kind === 'music' ? this.bank.music(file) : this.bank.sfx(file)], loop, html5: kind === 'music', preload: true });
      this.tracks.set(key, h);
    }
    return h;
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
    if (!this.sfxOn) return;
    const h = this.howl('sfx', id, false);
    h?.volume(0.8); h?.play();
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
