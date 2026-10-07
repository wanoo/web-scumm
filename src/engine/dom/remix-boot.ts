// Which world a page starts in (4.1.15, after the second reading): the autosave's world comes first, so Continue never
// disappears and a New game never overwrites a save of another world without the player choosing it. A link
// (`?seed=`, `?daily=`, `?world=`) that names another world than the saved game's is not adopted silently: the title
// asks "continue the saved game in its world, or start the link's world (replacing it)". A link that names no world
// is said to the player once.
import type { WorldVariant } from '../core/remix/compile';
import { savedWorld } from '../core/save';
import { trapFocus } from './a11y';
import { el, esc } from './app-shared';

/** The same world for a save: two story worlds (whatever the manifest's hash), or the same hash. */
export function sameWorld(a: WorldVariant | undefined, b: WorldVariant | undefined): boolean {
  if (!a || !b) return !a && !b;
  return (a.mode === 'story' && b.mode === 'story') || a.hash === b.hash;
}

/** What the autosave names: its world (v4), `'story'` (a v3 save or a raw state), or nothing (no save). */
export type SavedWorld = WorldVariant | 'story' | undefined;

/** The raw autosave of a game, read without parsing it (IndexedDB first, the localStorage fallback next). */
export async function peekSavedWorld(gameId: string): Promise<SavedWorld> {
  const of = (raw: unknown): SavedWorld =>
    raw === undefined || raw === null ? undefined : (savedWorld(raw) ?? 'story');
  try {
    const idb = globalThis.indexedDB;
    if (idb) {
      const raw = await new Promise<unknown>((resolve) => {
        const open = idb.open('web-scumm-saves', 1);
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains('slots')) open.result.createObjectStore('slots');
        };
        open.onerror = () => resolve(undefined);
        open.onsuccess = () => {
          try {
            const get = open.result.transaction('slots', 'readonly').objectStore('slots').get(`${gameId}:auto`);
            get.onsuccess = () => {
              open.result.close();
              resolve(get.result);
            };
            get.onerror = () => resolve(undefined);
          } catch {
            resolve(undefined);
          }
        };
      });
      if (raw !== undefined) return of(raw);
    }
  } catch {
    /* no IndexedDB: the fallback below */
  }
  try {
    const raw = globalThis.localStorage?.getItem(`${gameId}.save`);
    return raw ? of(JSON.parse(raw)) : undefined;
  } catch {
    return undefined;
  }
}

/** The world a page starts in, and a link it must ask about. */
export interface BootWorld {
  /** The world to apply (undefined: the story). */
  world: WorldVariant | undefined;
  /** Keep this world in the browser (it became the chosen one). */
  keep: boolean;
  /** A link's world the saved game does not live in: the title asks before replacing the save. */
  conflict?: WorldVariant;
}

/**
 * Decides the world: the saved game's when there is one (a link to another world waits for the player's choice), else
 * the link's, else the one chosen before, else the story.
 */
export function decideWorld(o: {
  linked?: WorldVariant;
  stored?: WorldVariant;
  saved: SavedWorld;
  /** The player chose a world in the Remix menu and confirmed replacing the saved game: the page starts it. */
  start?: boolean;
}): BootWorld {
  if (o.start) return { world: o.stored, keep: false };
  const saved = o.saved === 'story' ? undefined : o.saved;
  if (o.saved !== undefined) {
    const conflict = o.linked && !sameWorld(o.linked, saved ?? storyLike(o.linked)) ? o.linked : undefined;
    return { world: saved, keep: !sameWorld(saved, o.stored), conflict };
  }
  if (o.linked) return { world: o.linked, keep: true };
  return { world: o.stored, keep: false };
}

/** A story marker comparable with `sameWorld` (a v3 save lives in the story world). */
const storyLike = (v: WorldVariant): WorldVariant => ({ ...v, mode: 'story', hash: '' });

/** The pending question and notice of this page (set by the boot, read once by the title screen). */
const pending: { conflict?: WorldVariant; notice?: string } = {};
export const setPendingConflict = (v: WorldVariant | undefined) => {
  pending.conflict = v;
};
export const setPendingNotice = (text: string | undefined) => {
  pending.notice = text;
};
export function takePending(): { conflict?: WorldVariant; notice?: string } {
  const out = { ...pending };
  pending.conflict = undefined;
  pending.notice = undefined;
  return out;
}

/** Texts of the conflict dialog. */
export interface ConflictTexts {
  title: string;
  keep: string;
  replace: string;
}

/**
 * "A saved game lives in another world": continue it (resolves false) or start the link's world, replacing the save
 * (resolves true). Escape keeps the save.
 */
export function askWorldConflict(
  parent: HTMLElement,
  saved: string,
  linked: string,
  t: ConflictTexts,
): Promise<boolean> {
  return new Promise((done) => {
    const d = el('div', 'dim');
    const m = el('div', 'menu', `<h3>${esc(t.title)}</h3>`);
    m.setAttribute('role', 'alertdialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-label', t.title);
    const off = trapFocus(m, { onEscape: () => finish(false), restore: true });
    const finish = (replace: boolean) => {
      off();
      d.remove();
      done(replace);
    };
    const keep = el('button', '', `<span>${esc(t.keep)}</span><span>${esc(saved)}</span>`) as HTMLButtonElement;
    const replace = el(
      'button',
      'warn',
      `<span>${esc(t.replace)}</span><span>${esc(linked)}</span>`,
    ) as HTMLButtonElement;
    keep.type = replace.type = 'button';
    keep.onclick = () => finish(false);
    replace.onclick = () => finish(true);
    m.append(keep, replace);
    d.append(m);
    parent.append(d);
    queueMicrotask(() => keep.focus({ preventScroll: true }));
  });
}
