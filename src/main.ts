import { App } from '@engine/dom/app';
import type { SaveStore } from '@engine/core/ports';
import { FONT_PIXEL, FONT_UI } from '@engine/dom/fonts';
import * as mod from '@game';
import type { GameModule } from '../tools/game';
import type { AssetManifest } from '@engine/dom/assets';
import { applyLocale } from '@engine/tools/i18n';

const { game: written, layouts, manifest, minigames, commands, locales } = mod as unknown as GameModule & { locales?: Record<string, Record<string, string>> };
// Language: ?lang=, then the player's choice (settings), then the browser's, if the game ships that translation.
const q0 = new URLSearchParams(location.search);
let lang = q0.get('lang') || undefined;
if (!lang) { try { lang = localStorage.getItem(`${written.id}.lang`) ?? undefined; } catch { /* no storage */ } }
if (!lang && locales) lang = Object.keys(locales).find((l) => navigator.language.toLowerCase().startsWith(l.toLowerCase()));
const game = lang && locales?.[lang] ? applyLocale(written, locales[lang], minigames) : written;
document.documentElement.lang = lang ?? written.lang ?? 'en';

// Game fonts (skin.fonts): wait for them to load so text measurements are accurate.
const fonts = (document as any).fonts;
const families = [game.skin.fonts?.ui ?? FONT_UI, game.skin.fonts?.pixel ?? FONT_PIXEL];
const ready = fonts?.load ? Promise.all(families.map((f) => fonts.load(`12px "${f}"`))).catch(() => undefined) : Promise.resolve();

ready.then(async () => {
  const q = new URLSearchParams(location.search);
  // The dev tools (?dev, ?edit=<room>): on the dev server, and in a Studio demo build (docs/en/STUDIO.md, "Demo
  // mode"). Without these query params, the player's game is the same in every build.
  const dev = (import.meta.env.DEV || import.meta.env.VITE_STUDIO_DEMO === '1') && (q.has('dev') || q.has('edit'));
  let g = game, L = layouts;
  let store: SaveStore | undefined;
  let pendingStorageError: Error | undefined;
  let pendingSaveWarning: string | undefined;
  let app: App | undefined;
  if (dev && import.meta.env.VITE_STUDIO_DEMO === '1') {
    // The edited game never touches the player's saved game (same origin as the game on a static host).
    store = new (await import('@engine/core/ports')).MemoryStore();
    // The Studio demo's edits (kept in this browser) on top of the compiled game: texts, added entities, layouts.
    const { patchGame, readPatches } = await import('./studio/demo-patch');
    let ls: Storage | undefined;
    try { ls = localStorage; } catch { /* storage blocked */ }
    ({ game: g, layouts: L } = patchGame(game, layouts, readPatches(ls, __GAME__)));
  }
  if (!store) {
    try {
      const { IndexedDbSaveStore } = await import('@engine/dom/save-store');
      store = await IndexedDbSaveStore.open(
        g,
        (error) => { if (app) app.reportStorageError(error); else pendingStorageError = error; },
        (message) => { if (app) app.reportSaveWarning(message); else pendingSaveWarning = message; },
      );
    } catch (e) {
      // App's verified localStorage adapter remains a compatibility fallback when IndexedDB itself is unavailable.
      console.warn('IndexedDB autosave unavailable; using localStorage fallback', e);
    }
  }
  app = new App({ root: document.getElementById('app')!, game: g, layouts: L, manifest: manifest as AssetManifest, minigames, commands, store, version: __ASSETS_VERSION__,
    languages: Object.keys(locales ?? {}).length ? { current: lang ?? written.lang ?? 'en', available: [written.lang ?? 'en', ...Object.keys(locales ?? {}).filter((l) => l !== (written.lang ?? 'en'))] } : undefined });
  if (pendingStorageError) app.reportStorageError(pendingStorageError);
  if (pendingSaveWarning) app.reportSaveWarning(pendingSaveWarning);
  (window as any).__game = app; // debugging from the console, and driving e2e tests
  if (dev) app.engine.traceOn = true;
  if (dev) {
    const { startDev } = await import('@engine/dev');
    await startDev(app, {
      edit: q.get('edit'), checkpoint: q.get('at'),
      // No dev server (a Studio demo build): a saved layout joins the demo's edits in this browser.
      saveOffline: async (room, layout) => {
        const { readPatches, writePatches } = await import('./studio/demo-patch');
        let store: Storage | undefined;
        try { store = localStorage; } catch { /* blocked */ }
        const patches = readPatches(store, __GAME__).filter((p) => !(p.kind === 'layout' && p.room === room));
        writePatches(store, __GAME__, [...patches, { kind: 'layout', room, layout }]);
      },
    });
    return;
  }
  await app.showTitle();
  if ('serviceWorker' in navigator) {
    const { registerSW } = await import('virtual:pwa-register');
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh: () => app!.offerUpdate(() => updateSW(true)),
    });
  }
});
