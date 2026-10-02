import { App } from '@engine/dom/app';
import { FONT_PIXEL, FONT_UI } from '@engine/dom/fonts';
import { game, layouts, manifest, minigames } from '@game';

// Game fonts (skin.fonts): wait for them to load so text measurements are accurate.
const fonts = (document as any).fonts;
const families = [game.skin.fonts?.ui ?? FONT_UI, game.skin.fonts?.pixel ?? FONT_PIXEL];
const ready = fonts?.load ? Promise.all(families.map((f) => fonts.load(`12px "${f}"`))).catch(() => undefined) : Promise.resolve();

ready.then(async () => {
  const app = new App({ root: document.getElementById('app')!, game, layouts, manifest, minigames, version: __ASSETS_VERSION__ });
  (window as any).__game = app; // debugging from the console, and driving e2e tests
  const q = new URLSearchParams(location.search);
  if (import.meta.env.DEV && (q.has('dev') || q.has('edit'))) {
    const { startDev } = await import('@engine/dev');
    await startDev(app, { edit: q.get('edit'), checkpoint: q.get('at') });
    return;
  }
  await app.showTitle();
});
