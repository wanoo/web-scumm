// Offline and updates: the warm-up of nearby and of every asset, the offline status, the update offered after a verified save.
// Part of the player (4.1.0 "Clarity"): App's methods of the same name forward here.
import type { Id } from '../core/types';
import { assetGraph, splitKey, type AssetKind } from '../core/asset-graph';
import { offlinePlan, offlineFinish, offlineFold, offlineStart, type OfflineStatus } from './offline';
import { el, esc } from './app-shared';
import type { App } from './app';

/** Offers a service-worker update and activates it only after a verified autosave. */
export function offerUpdate(app: App, activate: () => Promise<void>) {
  if (app.root.querySelector('.update-banner')) return;
  const box = el('div', 'update-banner');
  box.setAttribute('role', 'status');
  const text = el('span', '', esc(app.t('updateAvailable')));
  const button = el('button', '', esc(app.t('updateNow')));
  button.onclick = async () => {
    button.disabled = true;
    app.saveError = null;
    try {
      // On the untouched title screen there is no progress to persist; do not create a misleading Continue save.
      if (app.engine.hasSave()) {
        app.engine.save();
        await app.engine.store.whenIdle?.();
      }
      if (app.saveError) throw new Error(app.saveError);
      await activate();
    } catch (e) {
      app.reportStorageError(e instanceof Error ? e : new Error(String(e)));
      button.disabled = false;
    }
  };
  box.append(text, button);
  app.root.append(box);
}

/**
 * Background preload scoped to the current room and immediately reachable rooms. The room renderer itself still
 * blocks on exactly what it needs; this only fills the runtime cache during idle time and respects constrained links.
 */
export async function warmAround(app: App, roomId: Id, initial = false) {
  const b = app.bank;
  const budget = app.game.assetBudgets ?? {};
  // The asset graph's scopes (core/asset-graph.ts): the current room, the title at boot, then the rooms one exit or
  // one unlocked map place away. The same keys the weight budgets count and the offline plan caches.
  const g = (app.assets ??= assetGraph(app.game, {
    stems: app.audio.stemsOn,
    manifest: b.manifest,
    bindings: Object.fromEntries(Object.entries(app.mg).map(([k, m]) => [k, m.bindings ?? {}])),
    layouts: Object.fromEntries(app.game.rooms.map((r) => [r.id, app.engine.layout(r.id)])),
  }));
  const rooms = new Map(app.game.rooms.map((r) => [r.id, r]));
  const current = rooms.get(roomId);
  if (!current) return;
  const urls = (keys: string[]) => {
    const by: Record<AssetKind, string[]> = { img: [], sfx: [], music: [], voice: [], video: [] };
    for (const k of keys) {
      const [kind, id] = splitKey(k);
      by[kind].push(
        kind === 'img'
          ? b.img(id)
          : kind === 'sfx'
            ? b.sfx(id)
            : kind === 'voice'
              ? b.voice(id)
              : kind === 'music'
                ? b.music(id)
                : b.video(id),
      );
    }
    return by;
  };
  const imageLimit = budget.initialImages ?? 120,
    audioLimit = budget.audioFiles ?? 16;
  const here = urls([...(g.rooms[roomId] ?? []), ...(initial ? g.title : [])]);
  await b.warm(here.img.slice(0, imageLimit));
  const neighbors = new Set<Id>(Object.values(current.exits ?? {}).map((x) => x.to));
  for (const [id, place] of Object.entries(app.game.map?.places ?? {}))
    if (app.engine.state?.unlocked.includes(id)) neighbors.add(place.room);
  const near = urls([...neighbors].slice(0, budget.neighboringRooms ?? 3).flatMap((id) => g.rooms[id] ?? []));
  await b.warm(near.img.filter((u) => !here.img.includes(u)).slice(0, imageLimit));
  await b.warm([...new Set([...here.sfx, ...near.sfx])].slice(0, audioLimit));
  await b.warm([...new Set([...here.voice, ...near.voice])].slice(0, audioLimit));
  await b.warm([...new Set([...here.music, ...near.music])].slice(0, 4), 2);
  if (initial) await b.warm(here.video, 1);
}

/**
 * The rest of the game, for offline play (`GameDef.offline`, default `full`): once per page, after the room-scoped
 * warm-up, batch by batch during idle time, paused while the page is hidden. The room renderer never waits for it.
 */
export async function warmAll(app: App, retry = false) {
  if (app.warmedAll && !retry) return;
  if (app.offlineStatus.state === 'running') return;
  const first = !app.warmedAll;
  app.warmedAll = true;
  const set = (s: OfflineStatus) => {
    app.offlineStatus = s;
    app.offlineWatchers.forEach((w) => w(s));
  };
  try {
    if (app.game.offline === 'nearby') {
      set({ state: 'off', done: 0, total: 0, failed: [] });
      return;
    }
    const b = app.bank;
    const plan = offlinePlan(app.game, b.manifest);
    let estimate: { usage?: number; quota?: number } | undefined;
    try {
      estimate = await (
        navigator as unknown as { storage?: { estimate?: () => Promise<{ usage?: number; quota?: number }> } }
      ).storage?.estimate?.();
    } catch {
      /* no estimate: proceed */
    }
    let status = offlineStart(plan, estimate);
    set(status);
    if (status.state !== 'running') return; // quota too small: say so, download nothing
    const visible = () =>
      new Promise<void>((r) => {
        if (!document.hidden) return r();
        const on = () => {
          if (!document.hidden) {
            document.removeEventListener('visibilitychange', on);
            r();
          }
        };
        document.addEventListener('visibilitychange', on);
      });
    for (const batch of plan) {
      await visible();
      const r = await b.warm(
        batch.ids.map((id) => app.offlineUrl(batch.kind, id)),
        batch.kind === 'img' ? 3 : 1,
        { heavy: batch.kind === 'music' || batch.kind === 'video' },
      );
      status = offlineFold(status, r, batch.ids.length);
      set(status);
    }
    status = offlineFinish(status);
    set(status);
    if (import.meta.env?.DEV)
      console.info(
        `offline: ${status.state}, ${status.done}/${status.total} files${status.reason ? ` (${status.reason})` : ''}`,
      );
  } catch (e) {
    set(offlineFinish({ ...app.offlineStatus, state: 'partial', reason: app.offlineStatus.reason ?? 'network' }));
    console.warn('offline warm-up stopped', e);
  } finally {
    if (first) app.offlineDone(app.offlineStatus);
  }
}

export function offlineUrl(app: App, kind: string, id: string) {
  const b = app.bank;
  return kind === 'img'
    ? b.img(id)
    : kind === 'sfx'
      ? b.sfx(id)
      : kind === 'voice'
        ? b.voice(id)
        : kind === 'music'
          ? b.music(id)
          : b.video(id);
}

/** Every URL the full warm-up caches (`scripts/e2e-pwa.mjs` checks each one against the cache, offline). */
export function offlineUrls(app: App): string[] {
  return offlinePlan(app.game, app.bank.manifest).flatMap((batch) =>
    batch.ids.map((id) => app.offlineUrl(batch.kind, id)),
  );
}

/** Watches the warm-up status (the pause menu's row); returns the unsubscribe. */
export function onOffline(app: App, w: (s: OfflineStatus) => void): () => void {
  app.offlineWatchers.add(w);
  return () => app.offlineWatchers.delete(w);
}
