// "ending" module: the sealed ending. Decrypts the sealed file (npm run seal), has the ticket scratched, launches the confetti rain,
// then shows the final card. Everything specific to the game comes from GameDef.ending and GameDef.skin.
import type { GameDef, Id, Value } from '../core/types';
import { showCard } from './card';
import { unseal, type EndingPayload } from './seal';

export { DEFAULT_ACCENT, showCard, verdict } from './card';
export { seal, unseal, normalizePassword, type EndingPayload, type RevealPayload } from './seal';

export interface EndingHost {
  game: GameDef;
  scene: HTMLElement;
  img(id: Id): string;
  flags(): Record<string, Value>;
  minigame(id: Id, params: Record<string, unknown>): Promise<void>;
  toast(text: string): void;
  sfx(id: Id): void;
  /** Music played once (jingle). */
  once(id: Id): void;
  play(id: Id): void;
  stopMusic(): void;
  replay(): void;
  credits(): void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

export class Ending {
  private payload: EndingPayload | null = null;
  constructor(private h: EndingHost) {}

  /** Decryption, scratch ticket, confetti rain. With no readable sealed file: a simple "…". */
  async open(): Promise<void> {
    const E = this.h.game.ending;
    if (!E) return;
    let payload: EndingPayload | null = null;
    try {
      const buf = await (await fetch(`${import.meta.env?.BASE_URL ?? '/'}${E.file}`)).arrayBuffer();
      let pwd = 'given' in E.password ? E.password.given : '';
      if ('typed' in E.password) pwd = await this.askPassword(E.password.prompt);
      payload = await unseal(crypto.subtle, buf, pwd);
    } catch (e) {
      console.error(e);
    }
    if (!payload) {
      this.h.toast('…');
      return;
    }
    this.payload = payload;
    const S = this.h.game.skin.sounds ?? {};
    this.h.stopMusic();
    await this.h.minigame('scratch', { color: E.card?.accent, ...(E.scratch ?? {}), text: payload.ticket });
    if (S.confetti) this.h.sfx(S.confetti);
    if (S.jingle) this.h.once(S.jingle);
    this.celebrate();
    await sleep(1800);
  }

  /** The final card (after the celebration lines). */
  async card(): Promise<void> {
    if (!this.payload) return;
    const end = this.h.game.skin.sounds?.end;
    await showCard(
      {
        game: this.h.game,
        scene: this.h.scene,
        img: (i) => this.h.img(i),
        flags: () => this.h.flags(),
        replay: () => this.h.replay(),
        credits: () => this.h.credits(),
        endMusic: () => {
          if (end) this.h.play(end);
        },
      },
      this.payload,
    );
  }

  private askPassword(prompt: string): Promise<string> {
    return new Promise((res) => {
      const d = document.createElement('div');
      d.className = 'dim';
      const m = document.createElement('div');
      m.className = 'menu';
      m.innerHTML = `<h3>${esc(prompt)}</h3>`;
      const inp = document.createElement('input');
      inp.autocapitalize = 'characters';
      Object.assign(inp.style, { font: 'inherit', padding: '.3em', textAlign: 'center' });
      const ok = document.createElement('button');
      ok.innerHTML = `<span>${esc(this.h.game.ui.ok)}</span><span>▶</span>`;
      ok.onclick = () => {
        d.remove();
        res(inp.value);
      };
      m.append(inp, ok);
      d.append(m);
      this.h.scene.append(d);
      inp.focus();
    });
  }

  private celebrate() {
    const imgs = this.h.game.skin.icons.confetti ?? [];
    if (!imgs.length) return;
    for (let i = 0; i < 16; i++) {
      const c = document.createElement('img');
      c.alt = '';
      // two confetti out of three with the first image, the third with the following ones (round-robin)
      c.src = this.h.img(i % 3 || imgs.length < 2 ? imgs[0] : imgs[1 + (Math.floor(i / 3) % (imgs.length - 1))]);
      Object.assign(c.style, {
        position: 'absolute',
        left: `${10 + Math.random() * 80}%`,
        top: `${10 + Math.random() * 70}%`,
        width: `${12 + Math.random() * 14}%`,
        animation: `burst ${1 + Math.random()}s ease-out ${Math.random() * 1.2}s both`,
        zIndex: '1150',
        pointerEvents: 'none',
      });
      this.h.scene.append(c);
      setTimeout(() => c.remove(), 3500);
    }
  }
}
