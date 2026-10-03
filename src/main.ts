import { App } from '@engine/dom/app';
import type { SaveStore } from '@engine/core/ports';
import { FONT_PIXEL, FONT_UI } from '@engine/dom/fonts';
import { game, layouts, manifest, minigames } from '@game';

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
  if (dev && import.meta.env.VITE_STUDIO_DEMO === '1') {
    // The edited game never touches the player's saved game (same origin as the game on a static host).
    store = new (await import('@engine/core/ports')).MemoryStore();
    // The Studio demo's edits (kept in this browser) on top of the compiled game: texts, added entities, layouts.
    const { patchGame, readPatches } = await import('./studio/demo-patch');
    let ls: Storage | undefined;
    try { ls = localStorage; } catch { /* storage blocked */ }
    ({ game: g, layouts: L } = patchGame(game, layouts, readPatches(ls, __GAME__)));
  }
  const app = new App({ root: document.getElementById('app')!, game: g, layouts: L, manifest, minigames, store, version: __ASSETS_VERSION__ });
  (window as any).__game = app; // debugging from the console, and driving e2e tests
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
});
