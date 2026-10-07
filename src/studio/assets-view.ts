// Assets tab, shared view (4.1.8, programme §4.7: the Studio's biggest owners split into model / IO / view): the host
// the three domain views (assets-sheets.ts, assets-decors.ts, assets-sounds.ts) receive from the tab, which is the
// state and IO they need and not the tab itself, and the DOM pieces they share: the "Used by" list, the backups, the
// shared style block of the prompts.
import type { AssetsListing, GameInfo } from './api';
import { copy } from './assets-io';
import { fenced, type Sel } from './assets-model';
import { h } from './ui';

export interface AssetsHost {
  /** Demo mode: no uploads, previews from public/assets only. */
  readonly demo: boolean;
  readonly info: GameInfo;
  /** The listing (the views only render once it is loaded). */
  data(): AssetsListing;
  /** The current selection, read again after an await to drop a stale render. */
  sel(): Sel | null;
  /** Changes the selection, and the selected cell when `cell` is given, without rendering (the reload that follows renders). */
  select(sel: Sel | null, cell?: string | null): void;
  /** Preview URL of a file (assets-model.ts `assetUrl`). */
  url(x: { file: string; mtime: number; asset?: string }): string | null;
  /** Marks a write as ours (the file watcher's echo is not announced as an outside change). */
  ownWrite(): void;
  /** Lists again (`load(true)`), then renders. */
  reload(): Promise<void>;
  /** Renders the centre again for the current selection (a view-local state changed: the overlay, the filter). */
  renderCenter(): void;
  /** Opens a room in the Rooms tab. */
  openRoom?(id: string): void;
}

/** Children without the null / false placeholders. */
export const nodes = (...k: (Node | string | null | undefined | false)[]) => k.filter((x): x is Node | string => !!x);

/** Where an image or a sound is used, with "Open room" when a use starts with a room id. */
export function usedList(host: AssetsHost, used: string[]) {
  const open = host.openRoom;
  return used.length
    ? h(
        'ul',
        { class: 'as-used' },
        used.map((u) => {
          const room = host.info.rooms.find((r) => u.startsWith(`${r.id}.`));
          return h(
            'li',
            null,
            h('code', null, u),
            room && open ? h('button', { class: 'link', onclick: () => open(room.id) }, 'Open room') : null,
          );
        }),
      )
    : h('p', { class: 'muted small' }, 'Not used by the game.');
}

/** The earlier versions kept next to a file (`<name>_v<N>`), as links with a thumbnail for images. */
export function backupsList(host: AssetsHost, backups: string[], mtime: number) {
  if (!backups.length) return null;
  return h(
    'section',
    null,
    h('h3', null, `Backups (${backups.length})`),
    h(
      'div',
      { class: 'as-backups' },
      backups.map((f) => {
        const src = host.url({ file: f, mtime });
        return h(
          'a',
          { href: src ?? '#', target: '_blank', rel: 'noopener', title: f },
          src && /\.(png|jpe?g|webp|gif)$/i.test(f) ? h('img', { src, alt: f, loading: 'lazy' }) : null,
          h('span', null, f.split('/').pop()),
        );
      }),
    ),
  );
}

/** The style block every prompt shares, folded, with its Copy button. */
export function styleDetails(host: AssetsHost) {
  const style = host.data().prompts.style;
  return h(
    'details',
    { class: 'as-style' },
    h(
      'summary',
      null,
      'Style block (shared by every prompt) ',
      h(
        'button',
        {
          class: 'small',
          onclick: (e: Event) => {
            e.preventDefault();
            void copy(fenced(style), 'Style block');
          },
        },
        'Copy',
      ),
    ),
    h('pre', { class: 'as-md' }, style),
  );
}
