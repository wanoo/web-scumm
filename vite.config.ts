import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { VitePWA } from 'vite-plugin-pwa';
import { GAME, GAME_DIR } from './tools/game';
import { studioPlugin } from './tools/studio/plugin';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** Dev server only: the placement editor (?edit=<room>) saves games/<GAME>/layout/<room>.json. */
function layoutWriter(): Plugin {
  return {
    name: 'layout-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__layout', (req, res) => {
        const room = (req.url ?? '').replace(/^\//, '').split('?')[0];
        if (req.method !== 'POST' || !/^[a-z0-9_-]+$/i.test(room)) { res.statusCode = 400; res.end('invalid request'); return; }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', async () => {
          try {
            const json = JSON.parse(body);
            await writeFile(r(`./games/${GAME}/layout/${room}.json`), JSON.stringify(json, null, 2) + '\n');
            res.end('ok');
          } catch (e) { res.statusCode = 500; res.end(String(e)); }
        });
      });
    },
  };
}

/** Version of images and sounds: a fingerprint of public/assets' content (stable across deploys, changes if a file changes). */
function assetsVersion(): string {
  const h = createHash('sha1');
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p); else { h.update(e.name); h.update(readFileSync(p)); }
    }
  };
  try { walk(r('./public/assets')); } catch { /* no assets yet */ }
  return h.digest('hex').slice(0, 10);
}

/** games/<id>/site.json: game title, description and color, injected into index.html and the PWA manifest. */
function sitePlugin(): Plugin {
  const site = () => {
    try { return JSON.parse(readFileSync(resolve(GAME_DIR, 'site.json'), 'utf8')); } catch { return {}; }
  };
  const manifest = () => {
    const s = site();
    return JSON.stringify({
      name: s.title ?? GAME, short_name: s.shortName ?? s.title ?? GAME, description: s.description ?? '',
      start_url: BASE, display: 'standalone', orientation: 'landscape',
      background_color: s.themeColor ?? '#0a0a12', theme_color: s.themeColor ?? '#0a0a12',
      icons: [{ src: `${BASE}icons/icon-192.png`, sizes: '192x192', type: 'image/png' }, { src: `${BASE}icons/icon-512.png`, sizes: '512x512', type: 'image/png' }],
    }, null, 2);
  };
  return {
    name: 'site',
    transformIndexHtml: { order: 'pre', handler(html) {
      const s = site();
      const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      return html.replace(/%LANG%/g, esc(s.lang ?? 'en')).replace(/%TITLE%/g, esc(s.title ?? GAME))
        .replace(/%DESCRIPTION%/g, esc(s.description)).replace(/%THEME%/g, esc(s.themeColor ?? '#0a0a12')).replace(/%BASE%/g, BASE);
    } },
    configureServer(server) {
      server.middlewares.use('/manifest.webmanifest', (_req, res) => { res.setHeader('content-type', 'application/manifest+json'); res.end(manifest()); });
    },
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: manifest() }); },
  };
}

/** Deploy under a sub-path (GitHub Pages: /<repo>/) with BASE_PATH=/<repo>/ ; default '/'. */
const BASE = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base: BASE,
  define: { __ASSETS_VERSION__: JSON.stringify(assetsVersion()) },
  plugins: [
    sitePlugin(),
    layoutWriter(),
    studioPlugin(),
    // Service worker: the app is cached on install, images and sounds on first use (then served without network).
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,ttf,webmanifest}', 'icons/*.png'],
        globIgnores: ['assets/img/**', 'assets/audio/**', 'assets/video/**', 'data/**'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          { urlPattern: /\/assets\/img\//, handler: 'CacheFirst',
            options: { cacheName: 'jeu-images', expiration: { maxEntries: 2000, maxAgeSeconds: 90 * 86400 }, cacheableResponse: { statuses: [0, 200] } } },
          { urlPattern: /\/assets\/audio\//, handler: 'CacheFirst',
            options: { cacheName: 'jeu-sons', rangeRequests: true, expiration: { maxEntries: 120, maxAgeSeconds: 90 * 86400 }, cacheableResponse: { statuses: [200] } } },
          { urlPattern: /\/assets\/video\//, handler: 'CacheFirst',
            options: { cacheName: 'jeu-videos', rangeRequests: true, expiration: { maxEntries: 10 }, cacheableResponse: { statuses: [200] } } },
          { urlPattern: /\/data\//, handler: 'NetworkFirst', options: { cacheName: 'jeu-donnees', networkTimeoutSeconds: 4 } },
        ],
      },
    }),
  ],
  server: { port: 5173, host: true },
  // The current game (GAME, otherwise package.json → config.game, otherwise demo): `@game` → games/<GAME>/index.ts.
  resolve: { alias: [
    { find: '@engine', replacement: r('./src/engine') },
    { find: /^@game$/, replacement: r(`./games/${GAME}/index.ts`) },
    { find: /^@game\//, replacement: r(`./games/${GAME}/`) },
  ] },
  // The Studio page (studio.html, dev server: /__studio/) only enters a build with STUDIO=1.
  build: { target: 'es2020', assetsInlineLimit: 0,
    rollupOptions: { input: { index: r('./index.html'), ...(process.env.STUDIO === '1' ? { studio: r('./studio.html') } : {}) } } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);
