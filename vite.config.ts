/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { VitePWA } from 'vite-plugin-pwa';
import { GAME, GAME_DIR, PROJECT, WORK } from './tools/game';
import { studioPlugin } from './tools/studio/plugin';
import { writeSnapshot } from './tools/studio/snapshot';
import { authorizeStudioRequest } from './tools/studio/security';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** Dev server only: the placement editor (?edit=<room>) saves games/<GAME>/layout/<room>.json. */
function layoutWriter(): Plugin {
  return {
    name: 'layout-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__layout', (req, res) => {
        if (!authorizeStudioRequest(req, res)) return;
        const room = (req.url ?? '').replace(/^\//, '').split('?')[0];
        if (req.method !== 'POST' || !/^[a-z0-9_-]+$/i.test(room)) {
          res.statusCode = 400;
          res.end('invalid request');
          return;
        }
        let body = '',
          tooLarge = false;
        req.on('data', (c) => {
          if (tooLarge) return;
          body += c;
          if (body.length > 1024 * 1024) {
            tooLarge = true;
            res.statusCode = 413;
            res.end('layout body too large');
            req.destroy();
          }
        });
        req.on('end', async () => {
          if (tooLarge) return;
          try {
            const json = JSON.parse(body);
            await writeFile(resolve(GAME_DIR, 'layout', `${room}.json`), JSON.stringify(json, null, 2) + '\n');
            res.end('ok');
          } catch (e) {
            res.statusCode = 500;
            res.end(String(e));
          }
        });
      });
    },
  };
}

/**
 * Builds with STUDIO=1: the Studio page enters the build (see `build.rollupOptions.input`) with its demo snapshot,
 * public/studio-demo/snapshot.json, regenerated from the game first (copied to dist/ with the public files).
 * Without STUDIO=1: neither the page nor a snapshot left in public/ by an earlier build reach dist/.
 */
function studioDemo(): Plugin {
  let outDir = 'dist';
  return {
    name: 'studio-demo',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    async buildStart() {
      if (process.env.STUDIO !== '1') return;
      const s = await writeSnapshot();
      this.info(`Studio snapshot: ${Object.keys(s.rooms).length} rooms of "${s.game.id}"`);
    },
    closeBundle() {
      if (process.env.STUDIO !== '1') rmSync(join(outDir, 'studio-demo'), { recursive: true, force: true });
    },
  };
}

/**
 * After every build (3.7.1): dist/ holds this game's files only, with their notices. public/ is shared by the games of
 * the repository, so Vite copies the other games' assets too: `tools/dist.ts seal` removes them and writes
 * dist/licenses/ (the engine and asset licences, the credits, the notices of the packages the bundle took code from,
 * listed here from the chunks' modules, and the assets manifest). `npm run verify:dist` then checks every file.
 */
function sealBuild(): Plugin {
  let outDir = 'dist';
  const packages = new Set<string>();
  return {
    name: 'seal-build',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    generateBundle(_o, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const id of chunk.moduleIds) {
          const m = id
            .split('\\')
            .join('/')
            .match(/\/node_modules\/((?:@[^/]+\/)?[^/]+)\//g);
          const last = m?.at(-1);
          if (last) packages.add(last.slice('/node_modules/'.length, -1));
        }
      }
    },
    closeBundle() {
      mkdirSync(resolve(WORK, '.cache'), { recursive: true });
      writeFileSync(resolve(WORK, '.cache', `bundle-packages-${GAME}.json`), JSON.stringify([...packages].sort()));
      execFileSync(process.execPath, [tsxCli(), '--tsconfig', tsconfig(), r('./tools/dist.ts'), 'seal', outDir], {
        stdio: 'inherit',
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
      if (e.isDirectory()) walk(p);
      else {
        h.update(e.name);
        h.update(readFileSync(p));
      }
    }
  };
  try {
    walk(resolve(WORK, 'public', 'assets'));
  } catch {
    /* no assets yet */
  }
  return h.digest('hex').slice(0, 10);
}

/** games/<id>/site.json: game title, description and color, injected into index.html and the PWA manifest. */
function sitePlugin(): Plugin {
  const site = () => {
    try {
      return JSON.parse(readFileSync(resolve(GAME_DIR, 'site.json'), 'utf8'));
    } catch {
      return {};
    }
  };
  const manifest = () => {
    const s = site();
    return JSON.stringify(
      {
        name: s.title ?? GAME,
        short_name: s.shortName ?? s.title ?? GAME,
        description: s.description ?? '',
        start_url: BASE,
        display: 'standalone',
        orientation: 'landscape',
        background_color: s.themeColor ?? '#0a0a12',
        theme_color: s.themeColor ?? '#0a0a12',
        icons: [
          { src: `${BASE}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${BASE}icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
        ],
      },
      null,
      2,
    );
  };
  return {
    name: 'site',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const s = site();
        const esc = (v: unknown) =>
          String(v ?? '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;');
        return html
          .replace(/%LANG%/g, esc(s.lang ?? 'en'))
          .replace(/%TITLE%/g, esc(s.title ?? GAME))
          .replace(/%DESCRIPTION%/g, esc(s.description))
          .replace(/%THEME%/g, esc(s.themeColor ?? '#0a0a12'))
          .replace(/%BASE%/g, BASE);
      },
    },
    configureServer(server) {
      server.middlewares.use('/manifest.webmanifest', (_req, res) => {
        res.setHeader('content-type', 'application/manifest+json');
        res.end(manifest());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: manifest() });
    },
  };
}

/**
 * A module only the Studio (src/studio, the repository's tools/) or the dev tools (src/engine/dev, tweakpane) load:
 * its chunks go under assets/tools/, which the service worker does not precache. Everything the game itself can
 * import must stay out of this set, or the game breaks offline: src/engine/tools/i18n (locales at runtime) and zod
 * (the save envelope). A chunk shared by the game and the Studio is only moved when every module in it is a tool.
 */
const TOOLS_DIR = r('./tools/');
const isToolModule = (id: string) => {
  if (id.startsWith(TOOLS_DIR)) return true;
  if (/[\\/]src[\\/]engine[\\/]tools[\\/](i18n|replay)\.ts$/.test(id)) return false; // the game's locales, the player's session export
  return /[\\/](src[\\/]studio|src[\\/]engine[\\/]dev|src[\\/]engine[\\/]tools|node_modules[\\/](@tweakpane|tweakpane))[\\/]/.test(
    id,
  );
};

/** tsx's command line, wherever npm put it (this repository, or a game project that installed the engine). */
const tsxCli = () => createRequire(import.meta.url).resolve('tsx/cli');
/** The tsconfig the tools run with: the project's (its `@engine` paths point into the package), else this repository's. */
const tsconfig = () =>
  PROJECT && existsSync(resolve(PROJECT, 'tsconfig.json')) ? resolve(PROJECT, 'tsconfig.json') : r('./tsconfig.json');

/** The Reality Bridge's player code (4.1.1): its own chunk, under assets/reality/. */
const isRealityModule = (id: string) =>
  /[\\/]src[\\/]engine[\\/](reality[\\/]|dom[\\/]reality-ui\.ts|core[\\/]reality-runtime\.ts)/.test(id);
/**
 * Whether the game declares `reality` (a `reality:` key in its sources): a game that does not never downloads the
 * Reality chunk, not even into the offline cache. A false positive (the word in a comment) only precaches it.
 */
const gameUsesReality = (() => {
  const walk = (d: string): string[] =>
    existsSync(d)
      ? readdirSync(d, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory()
            ? e.name === 'tests'
              ? []
              : walk(join(d, e.name))
            : e.name.endsWith('.ts')
              ? [join(d, e.name)]
              : [],
        )
      : [];
  return walk(GAME_DIR).some((f) => /\breality\s*:/.test(readFileSync(f, 'utf8')));
})();

/** Deploy under a sub-path (GitHub Pages: /<repo>/) with BASE_PATH=/<repo>/ ; default '/'. */
const BASE = process.env.BASE_PATH ?? '/';

export default defineConfig({
  // The engine's pages (index.html, studio.html) are next to this file, wherever it is installed.
  root: r('.'),
  base: BASE,
  define: { __ASSETS_VERSION__: JSON.stringify(assetsVersion()), __GAME__: JSON.stringify(GAME) },
  plugins: [
    sitePlugin(),
    layoutWriter(),
    studioPlugin(),
    studioDemo(),
    sealBuild(),
    // Service worker: the app is cached on install, images and sounds on first use (then served without network).
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,ttf,webmanifest}', 'icons/*.png'],
        // assets/tools/: the Studio and the dev tools (STUDIO=1 builds), never needed by a player offline.
        globIgnores: [
          'assets/img/**',
          'assets/audio/**',
          'assets/video/**',
          'data/**',
          'assets/tools/**',
          'studio-demo/**',
          'fonts/**',
          ...(gameUsesReality ? [] : ['assets/reality/**']),
        ],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
        runtimeCaching: [
          {
            urlPattern: /\/assets\/img\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'jeu-images',
              expiration: { maxEntries: 2000, maxAgeSeconds: 90 * 86400 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\/assets\/audio\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'jeu-sons',
              rangeRequests: true,
              expiration: { maxEntries: 600, maxAgeSeconds: 90 * 86400 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: /\/assets\/video\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'jeu-videos',
              rangeRequests: true,
              expiration: { maxEntries: 10 },
              cacheableResponse: { statuses: [200] },
            },
          },
          // public/fonts: the full fonts behind a subset (DotGothic16), cached the first time a character needs them.
          {
            urlPattern: /\/fonts\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'jeu-polices',
              expiration: { maxEntries: 10 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: /\/data\//,
            handler: 'NetworkFirst',
            options: { cacheName: 'jeu-donnees', networkTimeoutSeconds: 4 },
          },
        ],
      },
    }),
  ],
  // File-writing Studio routes are intentionally loopback-only by default. `npm run dev:lan` / `studio:lan` opt in
  // to LAN access (the Studio adds an authentication token in that mode).
  server: { port: 5173, host: process.env.WEB_SCUMM_LAN === '1' ? true : '127.0.0.1' },
  // The current game (GAME, otherwise package.json → config.game, otherwise demo): `@game` → games/<GAME>/index.ts.
  resolve: {
    alias: [
      // The public API (4.0, src/engine/api): `web-scumm/content`, `/player`, `/minigames`, `/testing`.
      { find: /^web-scumm\/(content|player|minigames|testing)$/, replacement: r('./src/engine/api/$1.ts') },
      { find: '@engine', replacement: r('./src/engine') },
      { find: /^@game$/, replacement: resolve(GAME_DIR, 'index.ts') },
      { find: /^@game\//, replacement: GAME_DIR + '/' },
    ],
  },
  // A game project (3.9): its public/ and dist/, the engine's pages and code from the installed package.
  ...(PROJECT
    ? {
        publicDir: resolve(PROJECT, 'public'),
        cacheDir: resolve(PROJECT, 'node_modules', '.vite'),
        server: {
          port: 5173,
          host: process.env.WEB_SCUMM_LAN === '1' ? true : '127.0.0.1',
          fs: { allow: [r('.'), PROJECT] },
        },
      }
    : {}),
  // The Studio page (studio.html, dev server: /__studio/) only enters a build with STUDIO=1.
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    ...(PROJECT ? { outDir: resolve(PROJECT, 'dist'), emptyOutDir: true } : {}),
    rollupOptions: {
      input: { index: r('./index.html'), ...(process.env.STUDIO === '1' ? { studio: r('./studio.html') } : {}) },
      // Code only the Studio or the dev tools use goes to assets/tools/ (left out of the service worker's precache).
      output: {
        entryFileNames: (c: { name: string }) =>
          c.name === 'studio' ? 'assets/tools/[name]-[hash].js' : 'assets/[name]-[hash].js',
        chunkFileNames: (c: { moduleIds: string[] }) =>
          c.moduleIds.length && c.moduleIds.every(isToolModule)
            ? 'assets/tools/[name]-[hash].js'
            : c.moduleIds.length && c.moduleIds.every(isRealityModule)
              ? 'assets/reality/[name]-[hash].js'
              : 'assets/[name]-[hash].js',
      },
    },
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts', `games/${GAME}/tests/**/*.test.ts`] },
});
