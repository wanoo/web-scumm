// The engine's Vite plugins (4.1.6: out of vite.config.ts, which kept 412 lines of them): the placement editor's
// layout writer, the Studio's demo snapshot, the sealed build, the assets' version, the game's site.json.
import type { Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { GAME, GAME_DIR, PROJECT, WORK } from '../game';
import { writeSnapshot } from '../studio/snapshot';
import { engineVersion, trustedExtensionsHash } from '../extensions';
import { authorizeStudioRequest } from '../studio/security';

/** A path next to the engine's pages (index.html, studio.html), wherever it is installed. */
const r = (p: string) => fileURLToPath(new URL('../../' + p.replace(/^\.\//, ''), import.meta.url));

/** tsx's command line, wherever npm put it (this repository, or a game project that installed the engine). */
const tsxCli = () => createRequire(r('./package.json')).resolve('tsx/cli');
/** The tsconfig the tools run with: the project's (its `@engine` paths point into the package), else this repository's. */
const tsconfig = () =>
  PROJECT && existsSync(resolve(PROJECT, 'tsconfig.json')) ? resolve(PROJECT, 'tsconfig.json') : r('./tsconfig.json');

/** Deploy under a sub-path (GitHub Pages: /<repo>/) with BASE_PATH=/<repo>/ ; default '/'. */
export const BASE = process.env.BASE_PATH ?? '/';

/** Dev server only: the placement editor (?edit=<room>) saves games/<GAME>/layout/<room>.json. */
export function layoutWriter(): Plugin {
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
 * Builds with STUDIO=1: the Studio page enters the build (see `build.rolldownOptions.input`) with its demo snapshot,
 * public/studio-demo/snapshot.json, regenerated from the game first (copied to dist/ with the public files).
 * Without STUDIO=1: neither the page nor a snapshot left in public/ by an earlier build reach dist/.
 */
export function studioDemo(): Plugin {
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
 * It also writes `site.json` (4.1.12, ADR 0013): the game's `site.json` with the build's `trustedExtensions` (the hash of
 * the game's code beside its content, `tools/extensions.ts`) and the engine's version, the two parts of the game's
 * fingerprint a player's copy cannot compute from the content; the player receives the same values as
 * `__TRUSTED_EXTENSIONS__` and `__ENGINE_VERSION__` (vite.config.ts).
 */
export function sealBuild(): Plugin {
  let outDir = 'dist';
  const packages = new Set<string>();
  return {
    name: 'seal-build',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    generateBundle(_o, bundle) {
      let site: Record<string, unknown> = {};
      try {
        site = JSON.parse(readFileSync(resolve(GAME_DIR, 'site.json'), 'utf8'));
      } catch {
        /* no site.json: the fingerprint's parts alone */
      }
      this.emitFile({
        type: 'asset',
        fileName: 'site.json',
        source: `${JSON.stringify({ ...site, trustedExtensions: trustedExtensionsHash(GAME_DIR), engine: engineVersion() }, null, 2)}\n`,
      });
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
export function assetsVersion(): string {
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
export function sitePlugin(): Plugin {
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
