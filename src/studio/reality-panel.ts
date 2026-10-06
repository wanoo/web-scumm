// The Play tab's Reality panel (4.1.1, plan §8): for a game that declares `reality`, the signals of its manifest with
// a button each, faults to add (a delay, a duplicate, a bad signature, expired), the queue reversed, the connection
// cut and resumed, and what happened to each delivery. It drives the simulated Bridge of the game in the frame
// (`?dev`): the signal goes through the same verification, session, save and deduplication as a real one.
import type { SignalSimulator } from '@engine/reality/simulator';
import type { RealityClient } from '@engine/reality/client';
import type { GameDef } from '@engine/core/types';
import { h } from './ui';

type Frame = {
  __game?: {
    game: GameDef;
    engine: { state: { reality?: { cursor: number } } };
    reality?: { simulator?: SignalSimulator; client?: RealityClient };
  };
};

export class RealityPanel {
  readonly el = h('div', { class: 'panel reality', hidden: true });
  private faults = { delayMs: false, duplicate: false, badSignature: false, expired: false };
  private shown = '';

  constructor(private frame: () => Window | null) {}

  private get game() {
    return (this.frame() as (Window & Frame) | null)?.__game;
  }

  /** Called on the Play tab's refresh: draws once per game, then updates the history. */
  refresh(): void {
    const g = this.game;
    const sim = g?.reality?.simulator;
    if (!g?.game.reality || !sim) {
      this.el.hidden = true;
      this.shown = '';
      return;
    }
    this.el.hidden = false;
    const key = `${g.game.id}:${sim.playerId}`;
    if (this.shown !== key) this.draw(sim);
    this.shown = key;
    const hist = this.el.querySelector('.reality-history');
    if (hist) {
      const refused = Object.entries(g.reality?.client?.refused ?? {})
        .map(([k, n]) => `${k} ×${n}`)
        .join(', ');
      hist.replaceChildren(
        h(
          'li',
          {},
          `cursor ${g.engine.state.reality?.cursor ?? 0} · acknowledged ${sim.acknowledged}${refused ? ` · refused: ${refused}` : ''}`,
        ),
        ...sim.history
          .slice(-12)
          .reverse()
          .map((d) => h('li', {}, `#${d.sequence} ${d.signal}${d.fault !== 'none' ? ` (${d.fault})` : ''}`)),
      );
    }
  }

  private draw(sim: SignalSimulator) {
    const box = (k: keyof typeof this.faults, label: string) => {
      const c = h('input', { type: 'checkbox', checked: this.faults[k] }) as HTMLInputElement;
      c.addEventListener('change', () => (this.faults[k] = c.checked));
      return h('label', { class: 'small' }, c, ` ${label} `);
    };
    this.el.replaceChildren(
      h('h4', {}, 'Reality (simulated Bridge)'),
      h(
        'p',
        { class: 'muted small' },
        'A signal goes through verification, the session, the save and deduplication, as from a real Bridge.',
      ),
      h(
        'div',
        { class: 'bar' },
        ...sim.signals.map((s) =>
          h(
            'button',
            {
              onclick: () =>
                void sim.inject(s, {
                  ...(this.faults.delayMs ? { delayMs: 2000 } : {}),
                  duplicate: this.faults.duplicate,
                  badSignature: this.faults.badSignature,
                  expired: this.faults.expired,
                }),
            },
            s,
          ),
        ),
      ),
      h(
        'div',
        { class: 'bar' },
        box('delayMs', 'delay 2 s'),
        box('duplicate', 'duplicate'),
        box('badSignature', 'bad signature'),
        box('expired', 'expired'),
      ),
      h(
        'div',
        { class: 'bar' },
        h('button', { onclick: () => sim.reverse() }, 'Reverse the queue'),
        h('button', { onclick: () => sim.cut() }, 'Cut'),
        h('button', { onclick: () => sim.resume() }, 'Resume'),
      ),
      h('ul', { class: 'reality-history small' }),
    );
  }
}
