// The sealed ending's final card: announcement, judged guess, photos (or fallback image), lines, short note,
// Replay and Credits buttons. Accent color: GameDef.ending.card.accent.
import type { GameDef, Value } from '../core/types';
import type { EndingPayload } from './seal';

const DEFAULT_ACCENT = '#d4145a';

import { esc } from '../dom/app-shared';

/** "Your guess: … Nice call!": only judged if the sealed file knows the outcome. */
export function verdict(game: GameDef, flags: Record<string, Value>, p: EndingPayload): string {
  const G = game.ending?.guess;
  if (!G) return '';
  const v = flags[G.flag];
  const label = typeof v === 'string' ? G.labels[v] : undefined;
  if (!label) return '';
  const text = !p.outcome ? G.none : v === p.outcome ? G.right : G.wrong;
  const ok = !!p.outcome && v === p.outcome;
  return `<div style="margin:.2em 0 .5em;padding:.3em .6em;border-radius:6px;background:${ok ? '#e4f6dc' : '#f3e6ee'};color:${ok ? '#2f6b1f' : '#7a3e5a'}">${esc(text.replace('{guess}', label))}</div>`;
}

export interface CardHost {
  game: GameDef;
  scene: HTMLElement;
  img(id: string): string;
  flags(): Record<string, Value>;
  /** "Replay": back to the title screen. */
  replay(): void;
  credits(): void;
  /** Ending music (skin.sounds.end), if the game has one. */
  endMusic(): void;
}

/** Shows the card; the promise resolves when "Replay" is chosen. */
export function showCard(h: CardHost, p: EndingPayload): Promise<void> {
  const accent = h.game.ending?.card?.accent ?? DEFAULT_ACCENT;
  const fallback = h.game.skin.icons.cardFallback;
  const el = (tag: string, cls?: string, html?: string) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  return new Promise((res) => {
    const ov = el('div', 'overlay');
    ov.style.background = 'rgba(10,6,18,.8)';
    const card = el('div');
    Object.assign(card.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%,-50%)',
      width: '66%',
      maxHeight: '92%',
      overflow: 'auto',
      background: '#fbf7ee',
      color: '#2b1d3a',
      borderRadius: '10px',
      padding: '3% 4%',
      boxShadow: '0 10px 30px rgba(0,0,0,.6)',
      textAlign: 'center',
      border: `4px double ${accent}`,
    });
    const photos = (p.photos ?? [])
      .map(
        (src) =>
          `<img src="${src}" alt="" style="max-width:40%;max-height:9em;margin:.3em;border-radius:4px;transform:rotate(-2deg)">`,
      )
      .join('');
    const lines = (p.lines ?? []).map((l) => `<div style="color:#6a5a7a">${esc(l)}</div>`).join('');
    const ver = verdict(h.game, h.flags(), p);
    const fb = fallback ? `<img src="${h.img(fallback)}" alt="" style="width:24%;transform:rotate(-3deg)">` : '';
    card.innerHTML = `<div style="font-size:1.25em;margin-bottom:.4em">${esc(p.headline)}</div>${ver}${photos || fb}${lines}${p.message ? `<p style="white-space:pre-line;margin:.6em 0">${esc(p.message)}</p>` : ''}`;
    const row = el('div');
    Object.assign(row.style, { display: 'flex', gap: '3%', justifyContent: 'center', marginTop: '.6em' });
    const again = el('button', 'bigbtn', esc(h.game.ui.replay));
    Object.assign(again.style, { color: '#7f5fb0', fontSize: '.5em', background: '#fff' });
    const cred = el('button', 'bigbtn', esc(h.game.ui.credits));
    Object.assign(cred.style, { color: '#2c6a9a', fontSize: '.5em', background: '#fff' });
    again.onclick = () => {
      ov.remove();
      res();
      h.replay();
    };
    cred.onclick = () => h.credits();
    row.append(again, cred);
    card.append(row);
    ov.append(card);
    h.scene.append(ov);
    h.endMusic();
  });
}
