// The Storyboard tab's editor blocks (4.1.8, programme §4.7: the Studio's biggest owners split into model / IO / view):
// a bound text input, a list of lines, a panel card, the hints, the talk topics and the reactions of a board. Each
// builder edits the document in place and tells the tab through a small host (what changed, what to focus), so the
// blocks know neither the API nor the tab's layout; `storyboard-preview.ts` draws the selected panel the same way.
import type { SbBoard, SbLine, SbPanel, SbReaction, SbTopic } from '../../tools/pages/storyboard-data';
import type { CoverageData, GameInfo } from './api';
import type { CoverStatus } from '@engine/tools/coverage';
import type { NotesStore } from './notes';
import {
  colorOf,
  type Doc,
  duplicatePanel,
  move,
  panelCov,
  panelIssues,
  speakerOptions,
  STAGE,
} from './storyboard-model';
import { autoGrow, h } from './ui';
import { must } from '../engine/core/must';

/** What the blocks need from the tab: the data, the selection, and the tab's reactions to an edit. */
export interface SbHost {
  readonly info: GameInfo;
  readonly notes: NotesStore;
  /** The document being edited (the blocks are only built when there is one). */
  readonly doc: Doc;
  /** The saved storyboard checked against the content, when known. */
  readonly cov: CoverageData | null;
  readonly board: SbBoard | undefined;
  readonly panel: SbPanel | undefined;
  /** The selected panel, and the selected line of the preview. */
  pi: number;
  li: number;
  /** After an edit. `structure`: lists changed (re-render the editor); otherwise only the state and the preview. */
  changed(structure?: boolean): void;
  /** The field to focus after the next re-render of the editor (its `data-fk`). */
  focus(key: string): void;
  /** Switches to the Rooms tab on that room. */
  openRoom(id: string): void;
  /** Selects panel `i` (and its line `li`) without re-rendering the editor; redraws the preview. */
  selectPanel(i: number, li?: number): void;
  renderList(): void;
  renderPreview(): void;
}

export function badge(status: CoverStatus, title: string): HTMLElement {
  return h('span', { class: `cov ${status}`, title }, { ok: '✓', partial: '~', missing: '✗', unknown: '?' }[status]);
}

/** A text input bound to `obj[key]` (an empty optional field is removed). */
export function input(
  host: SbHost,
  target: object,
  key: string,
  opts: {
    placeholder?: string;
    label: string;
    area?: boolean;
    optional?: boolean;
    fk?: string;
    cls?: string;
    onInput?: () => void;
  },
) {
  const obj = target as Record<string, unknown>;
  const el = opts.area
    ? autoGrow(
        h('textarea', {
          rows: 1,
          value: String(obj[key] ?? ''),
          placeholder: opts.placeholder,
          'aria-label': opts.label,
          class: opts.cls,
          dataset: { fk: opts.fk ?? '' },
        }),
      )
    : h('input', {
        type: 'text',
        value: String(obj[key] ?? ''),
        placeholder: opts.placeholder,
        'aria-label': opts.label,
        class: opts.cls,
        dataset: { fk: opts.fk ?? '' },
      });
  el.addEventListener('input', () => {
    if (opts.optional && !el.value) delete obj[key];
    else obj[key] = el.value;
    opts.onInput?.();
    host.changed();
  });
  return el;
}

/** Editable list of lines at `owner[field]` (created on the first added line). */
export function lines(
  host: SbHost,
  owner: object,
  field: string,
  fk: string,
  onLine?: (i: number) => void,
): HTMLElement {
  const rec = owner as Record<string, unknown>;
  const list = (rec[field] as SbLine[] | undefined) ?? [];
  const box = h('div', { class: 'sblines' });
  list.forEach((l, i) => {
    const who = h(
      'select',
      { 'aria-label': `Speaker of line ${i + 1}`, class: 'who' },
      speakerOptions(host.info, l.who).map(([v, t]) => h('option', { value: v, selected: v === l.who }, t)),
    );
    const paint = () => {
      who.style.color = colorOf(host.info, l.who) ?? '';
      row.classList.toggle('stage', STAGE.has(l.who));
    };
    const text = autoGrow(
      h('textarea', {
        rows: 1,
        value: l.text,
        placeholder: STAGE.has(l.who) ? 'What happens…' : 'Line…',
        'aria-label': `Line ${i + 1}`,
        dataset: { fk: `${fk}.${i}` },
      }),
    );
    text.addEventListener('input', () => {
      l.text = text.value;
      host.changed();
    });
    text.addEventListener('focus', () => onLine?.(i));
    who.addEventListener('change', () => {
      l.who = who.value;
      paint();
      host.changed();
    });
    const row = h(
      'div',
      { class: 'sbline' },
      who,
      text,
      h(
        'span',
        { class: 'lops' },
        h(
          'button',
          {
            class: 'icon',
            title: 'Move up',
            'aria-label': `Move line ${i + 1} up`,
            disabled: i === 0,
            onclick: () => {
              move(list, i, -1);
              host.focus(`${fk}.${i - 1}`);
              host.changed(true);
            },
          },
          '↑',
        ),
        h(
          'button',
          {
            class: 'icon',
            title: 'Move down',
            'aria-label': `Move line ${i + 1} down`,
            disabled: i === list.length - 1,
            onclick: () => {
              move(list, i, 1);
              host.focus(`${fk}.${i + 1}`);
              host.changed(true);
            },
          },
          '↓',
        ),
        h(
          'button',
          {
            class: 'icon del',
            title: 'Delete line',
            'aria-label': `Delete line ${i + 1}`,
            onclick: () => {
              list.splice(i, 1);
              host.changed(true);
            },
          },
          '✕',
        ),
      ),
    );
    paint();
    box.append(row);
  });
  box.append(
    h(
      'button',
      {
        class: 'add small',
        onclick: () => {
          const arr = (rec[field] ??= []) as SbLine[];
          arr.push({ who: arr.at(-1)?.who ?? 'hero', text: '' });
          host.focus(`${fk}.${arr.length - 1}`);
          onLine?.(arr.length - 1);
          host.changed(true);
        },
      },
      '+ line',
    ),
  );
  return box;
}

/** One panel of the board: its header (number, badge, title, id, moves), action, lines, sounds, issues and notes. */
export function panelCard(host: SbHost, b: SbBoard, p: SbPanel, i: number): HTMLElement {
  const on = i === host.pi;
  const sfx = p.sfx ?? [];
  const known = host.info.sfx ?? [];
  const addSfx = h(
    'select',
    { 'aria-label': 'Add a sound effect', class: 'addsfx' },
    h('option', { value: '' }, '+ sfx'),
    known.filter((s) => !sfx.includes(s)).map((s) => h('option', { value: s }, s)),
  );
  addSfx.addEventListener('change', () => {
    if (!addSfx.value) return;
    (p.sfx ??= []).push(addSfx.value);
    host.changed(true);
  });
  const idIn = input(host, p, 'id', { label: `Panel ${i + 1} id`, cls: 'pid', onInput: () => host.renderPreview() });
  const pc = panelCov(host.cov, p.id);
  const issues = panelIssues(pc);
  const card = h(
    'article',
    { class: `card${on ? ' on' : ''}`, onfocusin: () => host.selectPanel(i), onclick: () => host.selectPanel(i) },
    h(
      'header',
      null,
      h('span', { class: 'num' }, String(i + 1)),
      pc
        ? badge(
            pc.status,
            pc.status === 'ok'
              ? 'Everything in this panel is in the game'
              : `${Math.round(pc.score * 100)}% of this panel is in the game (saved version)`,
          )
        : null,
      input(host, p, 'title', {
        label: `Panel ${i + 1} title`,
        placeholder: 'Panel title',
        cls: 'ptitle',
        fk: `p${i}.title`,
      }),
      idIn,
      h(
        'span',
        { class: 'cops' },
        h(
          'button',
          {
            class: 'icon',
            title: 'Move panel up',
            'aria-label': `Move panel ${i + 1} up`,
            disabled: i === 0,
            onclick: (e: Event) => {
              e.stopPropagation();
              move(b.panels, i, -1);
              host.pi = i - 1;
              host.changed(true);
            },
          },
          '↑',
        ),
        h(
          'button',
          {
            class: 'icon',
            title: 'Move panel down',
            'aria-label': `Move panel ${i + 1} down`,
            disabled: i === b.panels.length - 1,
            onclick: (e: Event) => {
              e.stopPropagation();
              move(b.panels, i, 1);
              host.pi = i + 1;
              host.changed(true);
            },
          },
          '↓',
        ),
        h(
          'button',
          {
            class: 'icon',
            title: 'Duplicate panel',
            'aria-label': `Duplicate panel ${i + 1}`,
            onclick: (e: Event) => {
              e.stopPropagation();
              b.panels.splice(i + 1, 0, duplicatePanel(host.doc, p));
              host.pi = i + 1;
              host.changed(true);
            },
          },
          '⧉',
        ),
        h(
          'button',
          {
            class: 'icon del',
            title: 'Delete panel',
            'aria-label': `Delete panel ${i + 1}`,
            onclick: (e: Event) => {
              e.stopPropagation();
              const n = host.notes.about(p.id).length;
              if (
                !confirm(
                  `Delete panel ${p.id} "${p.title}"?${n ? ` Its ${n} note(s) stay in notes.json.` : ''} (Nothing is written until you save.)`,
                )
              )
                return;
              b.panels.splice(i, 1);
              host.pi = Math.max(0, Math.min(host.pi, b.panels.length - 1));
              host.changed(true);
            },
          },
          '✕',
        ),
      ),
    ),
    h(
      'label',
      { class: 'act' },
      h('span', null, 'Action'),
      input(host, p, 'action', {
        label: `Panel ${i + 1} action`,
        optional: true,
        placeholder: 'What the player does (empty: it just happens)',
      }),
    ),
    lines(host, p, 'lines', `p${i}`, (li) => host.selectPanel(i, li)),
    h(
      'div',
      { class: 'sfx' },
      h('span', { class: 'muted small' }, 'SFX'),
      sfx.map((s, k) =>
        h(
          'span',
          {
            class: `chipx${known.length && !known.includes(s) ? ' unknown' : ''}`,
            title: known.includes(s) ? s : `${s}: not in audio.sfx`,
          },
          s,
          h(
            'button',
            {
              class: 'icon',
              'aria-label': `Remove sound ${s}`,
              onclick: () => {
                sfx.splice(k, 1);
                host.changed(true);
              },
            },
            '✕',
          ),
        ),
      ),
      addSfx,
    ),
    issues.length
      ? h(
          'ul',
          { class: 'covlist' },
          issues.map((x) =>
            h(
              'li',
              { class: x.status, title: x.path ?? '' },
              `${x.status === 'missing' ? '✗' : '~'} ${x.what}${x.detail ? ` — ${x.detail}` : ''}`,
            ),
          ),
        )
      : null,
    host.notes.about(p.id).length
      ? h('span', { class: 'ncount', title: 'Notes about this panel' }, `✎ ${host.notes.about(p.id).length}`)
      : null,
  );
  return card;
}

/** The board's hints, from vague to precise. */
export function hintsBlock(host: SbHost, b: SbBoard): HTMLElement {
  const list = b.hints ?? [];
  return h(
    'div',
    { class: 'sblines' },
    list.map((t, i) => {
      const ta = autoGrow(
        h('textarea', { rows: 1, value: t, 'aria-label': `Hint ${i + 1}`, dataset: { fk: `hint.${i}` } }),
      );
      ta.addEventListener('input', () => {
        list[i] = ta.value;
        host.changed();
      });
      return h(
        'div',
        { class: 'sbline' },
        h('span', { class: 'num' }, String(i + 1)),
        ta,
        h(
          'span',
          { class: 'lops' },
          h(
            'button',
            {
              class: 'icon',
              'aria-label': `Move hint ${i + 1} up`,
              disabled: i === 0,
              onclick: () => {
                move(list, i, -1);
                host.changed(true);
              },
            },
            '↑',
          ),
          h(
            'button',
            {
              class: 'icon',
              'aria-label': `Move hint ${i + 1} down`,
              disabled: i === list.length - 1,
              onclick: () => {
                move(list, i, 1);
                host.changed(true);
              },
            },
            '↓',
          ),
          h(
            'button',
            {
              class: 'icon del',
              'aria-label': `Delete hint ${i + 1}`,
              onclick: () => {
                list.splice(i, 1);
                host.changed(true);
              },
            },
            '✕',
          ),
        ),
      );
    }),
    h(
      'button',
      {
        class: 'add small',
        onclick: () => {
          (b.hints ??= []).push('');
          host.focus(`hint.${b.hints.length - 1}`);
          host.changed(true);
        },
      },
      '+ hint',
    ),
  );
}

/** The board's talk topics per character, and a select to add a character's topics. */
export function talksBlock(host: SbHost, b: SbBoard): HTMLElement {
  const info = host.info;
  const talks = b.talks ?? {};
  const box = h('div', { class: 'talks' });
  for (const [c, topics] of Object.entries(talks)) {
    const ch = info.characters[c];
    box.append(
      h(
        'div',
        { class: 'talk' },
        h(
          'div',
          { class: 'talkhead' },
          h('b', { style: ch?.color ? { color: ch.color } : undefined }, ch?.name ?? c),
          h('code', null, c),
          h(
            'button',
            {
              class: 'icon del',
              title: `Remove ${c}'s topics`,
              'aria-label': `Remove the topics of ${c}`,
              onclick: () => {
                if (topics.length && !confirm(`Remove the ${topics.length} topic(s) of ${ch?.name ?? c}?`)) return;
                delete talks[c];
                host.changed(true);
              },
            },
            '✕',
          ),
        ),
        topics.map((t: SbTopic, i) =>
          h(
            'div',
            { class: 'topic' },
            h(
              'div',
              { class: 'inrow' },
              h('span', { class: 'muted small' }, '“'),
              input(host, t, 'topic', {
                label: `Topic ${i + 1} of ${c}`,
                placeholder: 'What the hero asks',
                fk: `talk.${c}.${i}`,
              }),
              h(
                'span',
                { class: 'lops' },
                h(
                  'button',
                  {
                    class: 'icon',
                    'aria-label': `Move topic ${i + 1} up`,
                    disabled: i === 0,
                    onclick: () => {
                      move(topics, i, -1);
                      host.changed(true);
                    },
                  },
                  '↑',
                ),
                h(
                  'button',
                  {
                    class: 'icon',
                    'aria-label': `Move topic ${i + 1} down`,
                    disabled: i === topics.length - 1,
                    onclick: () => {
                      move(topics, i, 1);
                      host.changed(true);
                    },
                  },
                  '↓',
                ),
                h(
                  'button',
                  {
                    class: 'icon del',
                    'aria-label': `Delete topic ${i + 1}`,
                    onclick: () => {
                      topics.splice(i, 1);
                      host.changed(true);
                    },
                  },
                  '✕',
                ),
              ),
            ),
            lines(host, t, 'lines', `talk.${c}.${i}.l`),
          ),
        ),
        h(
          'button',
          {
            class: 'add small',
            onclick: () => {
              topics.push({ topic: '', lines: [{ who: c, text: '' }] });
              host.focus(`talk.${c}.${topics.length - 1}`);
              host.changed(true);
            },
          },
          '+ topic',
        ),
      ),
    );
  }
  const free = Object.keys(info.characters).filter((c) => !(c in talks) && c !== info.hero);
  if (free.length) {
    const add = h(
      'select',
      { 'aria-label': 'Add topics for a character' },
      h('option', { value: '' }, '+ character…'),
      free.map((c) => h('option', { value: c }, `${must(info.characters[c], 'listed character').name} (${c})`)),
    );
    add.addEventListener('change', () => {
      if (!add.value) return;
      (b.talks ??= {})[add.value] = [{ topic: '', lines: [{ who: add.value, text: '' }] }];
      host.focus(`talk.${add.value}.0`);
      host.changed(true);
    });
    box.append(add);
  }
  return box;
}

/** The board's optional reactions: a player action and the lines it gets. */
export function reactionsBlock(host: SbHost, b: SbBoard): HTMLElement {
  const list: SbReaction[] = b.reactions ?? [];
  return h(
    'div',
    { class: 'reactions' },
    list.map((r, i) =>
      h(
        'div',
        { class: 'topic' },
        h(
          'div',
          { class: 'inrow' },
          input(host, r, 'action', {
            label: `Reaction ${i + 1} action`,
            placeholder: 'Player action, e.g. Push garden gnome',
            fk: `react.${i}`,
          }),
          h(
            'span',
            { class: 'lops' },
            h(
              'button',
              {
                class: 'icon',
                'aria-label': `Move reaction ${i + 1} up`,
                disabled: i === 0,
                onclick: () => {
                  move(list, i, -1);
                  host.changed(true);
                },
              },
              '↑',
            ),
            h(
              'button',
              {
                class: 'icon',
                'aria-label': `Move reaction ${i + 1} down`,
                disabled: i === list.length - 1,
                onclick: () => {
                  move(list, i, 1);
                  host.changed(true);
                },
              },
              '↓',
            ),
            h(
              'button',
              {
                class: 'icon del',
                'aria-label': `Delete reaction ${i + 1}`,
                onclick: () => {
                  list.splice(i, 1);
                  host.changed(true);
                },
              },
              '✕',
            ),
          ),
        ),
        lines(host, r, 'lines', `react.${i}.l`),
      ),
    ),
    h(
      'button',
      {
        class: 'add small',
        onclick: () => {
          (b.reactions ??= []).push({ action: '', lines: [{ who: 'hero', text: '' }] });
          host.focus(`react.${b.reactions.length - 1}`);
          host.changed(true);
        },
      },
      '+ reaction',
    ),
  );
}
