// The Storyboard tab's preview (4.1.8, programme §4.7: the Studio's biggest owners split into model / IO / view): the
// selected panel composed like a storyboard frame (room decor, speakers' portraits, the current line as the game shows
// it), a stepper through its lines, the script, the sounds and the notes about the panel. Reads the tab through the
// same host as the editor blocks (`storyboard-view.ts`); the tab owns the element it fills.
import { imgUrl } from './api';
import { composer, liveBlock, newestFirst, noteItem } from './notes';
import { charOf, colorOf, speakerName, STAGE } from './storyboard-model';
import type { SbHost } from './storyboard-view';
import { h } from './ui';
import { must } from '../engine/core/must';

/** The children of the preview pane for the selected panel (an empty note when the board has no panel). */
export function previewContent(host: SbHost): (Node | string)[] {
  const b = host.board;
  const p = host.panel;
  if (!b || !p) return [h('p', { class: 'muted pad' }, b ? 'This board has no panel yet.' : '')];
  const info = host.info;
  const room = info.rooms.find((r) => r.id === b.room);
  const lines = p.lines ?? [];
  host.li = Math.max(0, Math.min(host.li, lines.length - 1));
  const cur = lines[host.li];
  const speakers = [...new Set(lines.filter((l) => !STAGE.has(l.who)).map((l) => charOf(info, l.who)))];
  const curId = cur && !STAGE.has(cur.who) ? charOf(info, cur.who) : '';

  const frame = h(
    'div',
    { class: 'sbframe' },
    room
      ? h('img', { class: 'decor', src: imgUrl(room.decor), alt: room.name })
      : h('div', { class: 'nodecor' }, 'no room'),
    h(
      'div',
      { class: 'portraits' },
      speakers.map((id) => {
        const c = info.characters[id];
        return c?.portrait
          ? h(
              'figure',
              { class: `pt${id === curId ? ' on' : ''}`, title: c.name },
              h('img', { src: imgUrl(c.portrait), alt: c.name }),
              h('figcaption', { style: { color: c.color } }, c.name),
            )
          : null;
      }),
    ),
    cur
      ? STAGE.has(cur.who)
        ? h('div', { class: 'stagecap' }, cur.who === 'action' ? '▶ ' : '', cur.text || '…')
        : h('div', { class: 'speech', style: { color: colorOf(info, cur.who) ?? '#ddd' } }, cur.text || '…')
      : null,
    p.action ? h('div', { class: 'sbaction' }, h('b', null, p.action)) : null,
  );

  const step = (d: number) => {
    host.li = Math.max(0, Math.min(lines.length - 1, host.li + d));
    host.renderPreview();
  };
  const notes = liveBlock(host.notes, 'pnotes', (el) => {
    const list = host.notes.about(p.id).sort(newestFirst);
    const c = composer(host.notes, p.id, `A note about ${p.id}…`);
    el.replaceChildren(
      h('h3', null, 'Notes ', h('span', { class: 'muted' }, `about ${p.id} · ${list.length}`)),
      list.length
        ? h(
            'ul',
            { class: 'notes' },
            list.map((n) => noteItem(n, host.notes, { onReply: () => c.text.focus() })),
          )
        : h('p', { class: 'muted small' }, 'No notes about this panel yet.'),
      c.el,
    );
  });

  return [
    h(
      'header',
      { class: 'pvhead' },
      h(
        'div',
        null,
        h('div', { class: 'muted small' }, `${b.title} · panel ${host.pi + 1}/${b.panels.length}`),
        h('h2', null, p.title || p.id),
        h('code', null, p.id),
      ),
      b.room
        ? h(
            'button',
            { class: 'small', onclick: () => host.openRoom(must(b.room, 'room of the previewed board')) },
            `Open in Rooms ›`,
          )
        : null,
    ),
    frame,
    lines.length > 1
      ? h(
          'div',
          { class: 'stepper' },
          h(
            'button',
            { class: 'small', 'aria-label': 'Previous line', disabled: host.li === 0, onclick: () => step(-1) },
            '‹',
          ),
          h('span', { class: 'muted small' }, `line ${host.li + 1} / ${lines.length}`),
          h(
            'button',
            {
              class: 'small',
              'aria-label': 'Next line',
              disabled: host.li >= lines.length - 1,
              onclick: () => step(1),
            },
            '›',
          ),
        )
      : '',
    h(
      'ol',
      { class: 'script' },
      lines.map((l, i) =>
        h(
          'li',
          {
            class: `${i === host.li ? 'on' : ''}${STAGE.has(l.who) ? ' stage' : ''}`,
            onclick: () => {
              host.li = i;
              host.renderPreview();
            },
          },
          STAGE.has(l.who)
            ? h('i', null, `${l.who.toUpperCase()}: ${l.text}`)
            : [
                h('b', { style: { color: colorOf(info, l.who) } }, speakerName(info, l.who)),
                ' ',
                h('span', null, l.text),
              ],
        ),
      ),
    ),
    p.sfx?.length
      ? h(
          'div',
          { class: 'sfx' },
          h('span', { class: 'muted small' }, 'SFX'),
          p.sfx.map((s) => h('span', { class: 'chipx' }, s)),
        )
      : '',
    notes,
  ];
}
