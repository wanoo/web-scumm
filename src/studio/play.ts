// Play tab: the game itself (with the dev tools) in a frame, next to a state inspector and a rule explainer: pick a
// verb and a target (and an item), see every rule that could answer, with each condition evaluated against the live
// state (✓ / ✗), and which answer wins. The frame is the same origin: the Studio reads `window.__game` in it.
import { explainCond, type Explained } from '@engine/core/cond';
import type { Engine } from '@engine/core/engine';
import type { GameDef, Id, Rule } from '@engine/core/types';
import { BASE, type GameInfo } from './api';
import { h, select } from './ui';

type GameWindow = Window & { __game?: { engine: Engine; game: GameDef } };

const asList = <T>(x: T | T[] | undefined): T[] => x === undefined ? [] : Array.isArray(x) ? x : [x];

export class PlayTab {
  readonly el = h('section', { class: 'tab play' });
  private frame = h('iframe', { class: 'playframe', title: 'The game', src: `${BASE}?dev` }) as HTMLIFrameElement;
  private state = h('div', { class: 'panel state' });
  private why = h('div', { class: 'panel why' });
  private verb = '';
  private target = '';
  private item = '';
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private info: GameInfo) {
    this.verb = info.verbs[0]?.id ?? '';
    this.el.append(
      h('div', { class: 'playgrid' },
        h('div', { class: 'playcol' }, this.frame,
          h('p', { class: 'muted small' }, 'The game with the dev tools (?dev): press D for the zone overlay, the DEV panel teleports and sets flags. ',
            h('a', { href: `${BASE}?dev`, target: '_blank', rel: 'noopener' }, 'Open in a new tab ↗'))),
        h('div', { class: 'playside' }, this.state, this.why)),
    );
    this.timer = setInterval(() => this.refresh(), 700);
  }

  private game(): { engine: Engine; game: GameDef } | null {
    try { return (this.frame.contentWindow as GameWindow | null)?.__game ?? null; } catch { return null; }
  }

  private refresh() {
    if (!this.el.isConnected) return;
    const g = this.game();
    const s = g?.engine.state;
    if (!g || !s) { this.state.replaceChildren(h('h3', null, 'State'), h('p', { class: 'muted' }, 'Waiting for the game…')); return; }
    const flags = Object.entries(s.flags).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('  ') || '—';
    const scripts = Object.entries(s.scripts ?? {}).map(([k, v]) => `${k}:${v.off ? 'off' : v.done ? 'done' : v.pc}`).join('  ') || '—';
    this.state.replaceChildren(
      h('h3', null, 'State ', h('span', { class: 'muted small' }, `${s.room}${s.active ? ` · ${s.active}` : ''}${g.engine.busy ? ' · busy' : ''}`)),
      h('dl', { class: 'facts' },
        h('dt', null, 'Bag'), h('dd', null, s.inventory.join(', ') || '—'),
        h('dt', null, 'Flags'), h('dd', null, flags),
        h('dt', null, 'Unlocked'), h('dd', null, s.unlocked.join(', ') || '—'),
        Object.keys(s.where ?? {}).length ? [h('dt', null, 'Where'), h('dd', null, Object.entries(s.where!).map(([c, r]) => `${c}@${r}`).join('  '))] : null,
        h('dt', null, 'Scripts'), h('dd', null, scripts),
        s.players ? [h('dt', null, 'Players'), h('dd', null, Object.entries(s.players).map(([p, v]) => `${p}@${v.room} [${v.inventory.join(', ')}]`).join('  '))] : null),
    );
    this.renderWhy(g);
  }

  /** "Why does this action answer that?": every candidate rule with its conditions explained. */
  private renderWhy(g: { engine: Engine; game: GameDef }) {
    const e = g.engine;
    const s = e.state;
    const room = e.room();
    const targets = e.targets(room);
    const items = s.inventory;
    if (this.target && !targets.includes(this.target) && !items.includes(this.target)) this.target = '';
    const verbs = this.info.verbs.map((v): [string, string] => [v.id, v.label]);
    const topts: [string, string][] = [['', '(target)'], ...targets.map((t): [string, string] => [t, `${e.nameOf(t, room)} (${t})`]), ...items.map((t): [string, string] => [t, `bag: ${t}`])];
    const iopts: [string, string][] = [['', '(no item)'], ...items.map((t): [string, string] => [t, t])];
    const bar = h('div', { class: 'bar' },
      select(verbs, this.verb, (v) => { this.verb = v; this.refresh(); }, { 'aria-label': 'Verb' }),
      select(iopts, this.item, (v) => { this.item = v; this.refresh(); }, { 'aria-label': 'Item' }),
      select(topts, this.target, (v) => { this.target = v; this.refresh(); }, { 'aria-label': 'Target' }));
    const out: Node[] = [h('h3', null, 'Why? ', h('span', { class: 'muted small' }, 'the rules that could answer, first ✓ wins')), bar];
    if (this.target) {
      const a = this.item || this.target;
      const b = this.item ? this.target : undefined;
      const has = (x: Id | Id[] | undefined, v: Id | undefined) => x === undefined ? v === undefined : v !== undefined && asList(x).includes(v);
      const lists: [Rule[], string][] = [[room.on ?? [], room.id], [g.game.rules.on ?? [], 'game']];
      let winner: Rule | null = null;
      for (const [list, scope] of lists) list.forEach((r, i) => {
        if (!asList(r.verb).includes(this.verb)) return;
        const match = (has(r.a, a) && has(r.b, b)) || (b && items.includes(a) && items.includes(b) && has(r.a, b) && has(r.b, a));
        if (!match) return;
        const x = explainCond(r.if, s, room.id);
        const wins = x.ok && !winner;
        if (wins) winner = r;
        out.push(h('div', { class: `rule ${x.ok ? 'ok' : 'bad'}` },
          h('div', { class: 'rulehead' }, h('b', null, wins ? '▶ ' : x.ok ? '✓ ' : '✗ '), h('code', null, `${scope}.on[${i}]${r.exit ? ' (exit)' : ''}`),
            h('span', { class: 'muted small' }, ` ${asList(r.verb).join('/')} ${asList(r.a).join('/')}${r.b ? ' → ' + asList(r.b).join('/') : ''}`)),
          this.explained(x)));
      });
      if (!winner) {
        const why = this.verb === 'look' && !b ? (room.look?.[a] || g.game.items[a]?.look ? 'the look line' : 'the look fallback')
          : this.verb === 'talk' && !b ? (room.talk?.[a] ? 'the conversation topics' : a === g.game.hintItem ? 'the hints' : 'the talk fallback')
          : 'a kind reaction, a refusal or the fallback line';
        out.push(h('p', { class: 'muted' }, `No rule answers: ${why}.`));
      }
    } else out.push(h('p', { class: 'muted' }, 'Pick a target.'));
    this.why.replaceChildren(...out);
  }

  private explained(x: Explained): HTMLElement {
    return h('div', { class: `cond ${x.ok ? 'ok' : 'bad'}` }, `${x.ok ? '✓' : '✗'} ${x.text}`, x.parts ? h('div', { class: 'nest' }, x.parts.map((p) => this.explained(p))) : null);
  }

  dispose() { clearInterval(this.timer); }
}
