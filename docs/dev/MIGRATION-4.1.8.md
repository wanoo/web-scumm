# Migration notes for 4.1.8: TypeScript 7, Vite 8, vite-plugin-pwa 2, Vitest 5

Read before any of them is touched (programme §4.2: document the known incompatibilities first). Researched on
7 October 2026 against the v4.1.7 tree (`typescript` 5.9.3, `vite` 6.4.3, `vite-plugin-pwa` 1.3.0, `vitest` 5.0.3,
`happy-dom` 20.14.5, `playwright` 1.63.0, `tsx` 4.23.15, `esbuild` 0.28.2, `rollup` 4.63.5, `workbox-build` 7.4.1),
the npm registry and the official release notes; what could not be confirmed is marked "unverified". The Dependabot
pull requests of 4.0 said why they were closed: TypeScript 7.0.2 removes `baseUrl` and non-relative `paths` (TS5102,
TS5090), which the repository and the generated project use, "and the PWA build breaks with it"; Vite 8.3.2's bundler
breaks a CommonJS default import in the built game (`TypeError: Bn.default is not a constructor`).

## 1. TypeScript 7 (the native compiler)

**What ships.** `typescript@7.0.2` (2026-07-08). The native compiler is `tsc` in the `typescript` package (`tsgo` was
the preview package's command). `bin` is only `tsc` (no `tsserver`), the platform binaries are optional dependencies,
`engines.node >= 16.20`. **The package ships without a programmatic API**: `exports` are `./lib/version.cjs` and
`./unstable/*` (ast, scanner, visitor, fs…), no `lib/typescript.js`, no types; the 7.0 announcement says "we expect
TypeScript 7.1 to ship with a new (and different) API". The 7.1 iteration plan schedules beta 2026-10-06, RC
2026-11-10, stable 2026-11-24, with a Content Mapper, Emit and Language Service API to stabilise. To keep the old API
Microsoft publishes `@typescript/typescript6` (6.0.2, bin `tsc6`, `main: lib/typescript.js`), installable as
`typescript@npm:@typescript/typescript6`.

**Removed or changed options** (the 6.0 deprecations, hard errors in 7.0): `target: es5`, `downlevelIteration`,
`moduleResolution: node|node10|classic`, `module: amd|umd|systemjs|none`, **`baseUrl`** (TS5102 "has been removed"),
`outFile`, `esModuleInterop: false`, `allowSyntheticDefaultImports: false`, `alwaysStrict: false`, namespaces with
the `module` keyword, import `asserts`, `/// <reference no-default-lib />`. `paths` values must be relative or
absolute (TS5090 "Non-relative paths are not allowed when 'baseUrl' is not set"), relative to the tsconfig. New
defaults: `strict: true`, `module: esnext`, `target` = the current ES year, `types: []`, `rootDir` = the tsconfig's
folder, `noUncheckedSideEffectImports: true`, `libReplacement: false`, `stableTypeOrdering: true` (cannot be turned
off). `--build` gains `--builders N`, `--checkers N`, `--singleThreaded`; file paths on the CLI need `--ignoreConfig`
when a tsconfig exists. `noUncheckedIndexedAccess` is untouched (`tsconfig.strictest.json` keeps working); `types`
is explicit in the repo (`vite/client`, `node`), so the `types: []` default changes nothing.

**What the repository asks of the compiler API** (five files `import ts from 'typescript'`, all broken by 7.0):
`tools/api-doc.ts` (`readConfigFile`, `parseJsonConfigFileContent`, `createProgram`, `getTypeChecker`, `SymbolFlags`,
`TypeFormatFlags.NoTruncation`: it needs the type checker, which `unstable/*` does not give); `tools/ids/codemod.ts`,
`tools/mutate.ts`, `tools/studio/core.ts`, `tools/studio/source.ts` (syntax only: `createSourceFile`, `forEachChild`,
`createScanner`, `SyntaxKind`, the `is*` guards, `flattenDiagnosticMessageText`; the Studio's parsing of a game's
sources depends on them). `tsc --noEmit` itself would fail on these files (no types for `'typescript'` in 7.0).
Tooling: `tsx`, `vitest`, `vite` and `knip` do not depend on `typescript` (knip parses with `oxc-parser`);
`tsx` reads `paths` through `get-tsconfig`, which already implements the no-`baseUrl` rule (relative `paths` work);
Vitest type-strips with Vite's transformer (esbuild under Vite 6, Oxc under Vite 8).

**Decision for 4.1.8 (taken in `refactor/418-typescript-7`, LOG #108: the first option, with `tsc` 7 reached by `npm run tsc` because `@typescript/typescript6` pulls a renamed `typescript@6.0.3` whose bin link `tsc` wins):** the exit criterion "TypeScript 7 active" is reachable only as
*`tsc` 7 for the type checks, `@typescript/typescript6` for the five tools* (named `@typescript/typescript6` in their
imports, documented in TOOLS.md as the compiler API the tools use until 7.1), or by deferring the compiler itself to
the lot after 7.1 is stable (end of November 2026, 4.1.12 or later) while 4.1.8 does everything else TS 7 requires
(paths without `baseUrl`, the generated project's tsconfig, the `types` and `strict` defaults). Both are said here,
neither is a hidden shim.

## 2. Vite 8 (Rolldown)

Guides: the v8 migration page (vite.dev/guide/migration), the v7 one (v7.vite.dev/guide/migration), the Rolldown
integration page and the Vite 8.0 announcement (2026-03-12). Registry: `vite@8.3.3` (2026-10-06), `engines.node
^20.19.0 || >=22.12.0`, dependencies `rolldown`, `lightningcss`, `postcss`, `picomatch`, `tinyglobby` (no `rollup`,
no `esbuild`); `rolldown-vite@7.3.1` is the Vite-7-based stepping stone the team recommends for complex projects.

**6 → 7.** Node 18 dropped. Default `build.target` becomes `baseline-widely-available` (the repo pins `es2020`:
unaffected). Removed: the Sass legacy API, `splitVendorChunkPlugin`, hook-level `enforce`/`transform` on
`transformIndexHtml` (the repo's `sitePlugin` already uses `order: 'pre'` + `handler`), old HMR types;
`optimizeDeps.entries` are globs; middlewares run before `configureServer`.

**7 → 8.** Rolldown and Oxc replace Rollup and esbuild. Browser floor: Chrome 111, Firefox 114, Safari 16.4.
`build.rollupOptions` → `build.rolldownOptions` (alias kept, deprecated), `worker.rollupOptions` →
`worker.rolldownOptions`, `optimizeDeps.esbuildOptions` → `optimizeDeps.rolldownOptions`, `esbuild` → `oxc`
(auto-converted; Oxc does not lower native decorators); JS minified by Oxc, CSS by Lightning CSS. Removed:
format-sniffing module resolution, `rollupOptions.watch.chokidar`, **the object form of `manualChunks`**, AMD/System
output, the hooks `shouldTransformCachedModule`, `resolveImportMeta`, `renderDynamicImport`; `build()` throws a
`BundleError` with an `errors` array; native plugins on by default (`experimental.enableNativePlugin: 'v1'`);
`transformWithEsbuild` needs `esbuild` installed. "Default imports from CommonJS modules now follow consistent rules
across development and production builds." `import.meta.glob` with `{ eager: true, import: 'default' }` (the repo's
`games/*/index.ts` for layouts and locales) is unchanged. `vite preview` and the environment API: nothing listed
that touches this repo.

**The CommonJS default import that breaks.** `src/engine/dom/walk.ts`: `import earcut from 'earcut'` (3.2.4 is ESM,
fine) and `import NavMesh from 'navmesh'`, then `new NavMesh(polys)`. **`navmesh` 2.3.1 is CommonJS/UMD only** (no
`type`, no `exports`, a webpack UMD bundle that defines `__esModule` and exposes both `default` and the named
`NavMesh`). Rolldown's rule: the default import is the whole `module.exports` when the importer is in a `"type":
"module"` package (this repo is), so `walk.ts` gets the namespace instead of the class, where Rollup's commonjs
plugin took `.default` (the exact path of `Bn.default is not a constructor`: unverified, but this is the only CJS
default import in `src/`). Fixes: `import { NavMesh } from 'navmesh'` (declared in its d.ts; confirm by a build) or
the guard `raw.__esModule ? raw.default : raw`. `howler` 2.2.4 is CJS/UMD too but imported by name; `zod/mini`,
`tweakpane`, `@tweakpane/core` are ESM.

**Plugin hooks the repo uses** (`tools/vite/plugins.ts`: `layoutWriter`, `studioDemo`, `sealBuild`, `sitePlugin`;
`tools/studio/plugin.ts`): `apply`, `configureServer`, `configResolved`, `buildStart`, `generateBundle` (iterates
`bundle`, `chunk.moduleIds`, `this.emitFile`), `closeBundle`, `transformIndexHtml { order: 'pre', handler }`. None of
the removed hooks. `vite.config.ts` reads `c.name` and `c.moduleIds` in `entryFileNames` / `chunkFileNames`:
Rolldown's `PreRenderedChunk` and `OutputChunk` expose `moduleIds`, so the `assets/tools/` and `assets/reality/`
routing can stay (renamed to `rolldownOptions`). `define`, `resolve.alias` (regex `find`), `publicDir`, `cacheDir`,
`server.fs.allow`, `assetsInlineLimit: 0` are unchanged.

## 3. vite-plugin-pwa 2

Releases: 1.0.0 (2025-03-29, workbox ^7.3), 1.0.1 (Vite 7 peer), 1.2.0 (2025-11-27, workbox ^7.4), **1.3.0
(2026-05-05: Vite 8 peer dependency, `onNeedReload`, workbox-build/window ^7.4.1)**, **2.0.0 (2026-10-03)**: its notes list one
change, the `@vite-pwa/assets-generator` peer now `^1.0.0 || ^2.0.0`; `engines.node` goes to `>=20.19.0`; peer
`vite` still `^3.1 … ^8.0`; workbox stays ^7.4.1. No change to `registerType`, `strategies`, `injectManifest` /
`generateSW`, `devOptions`, `manifest`, the virtual module names or `sw.js` in any 1.x / 2.0 note. The plugin "will
remain frozen in maintenance mode" (issue #933, 2026-05-16); a workbox fork `@vite-pwa/workbox` and a modular
`@vite-pwa/core` on Vite 8 / Rolldown are announced, not on npm today (unverified). The "PWA build breaks" of the
closed Dependabot PR is not explained by the plugin (it runs no `tsc`); the likely path is `npm run build` → `npm run
check` → `tsc --noEmit` failing on `baseUrl` (unverified).

**Options in use** (`vite.config.ts`): `registerType: 'prompt'`, `injectRegister: false`, `manifest: false` (the
manifest is `sitePlugin`'s), `workbox.globPatterns` / `globIgnores` (`assets/reality/**` unless the game declares
`reality`), `navigateFallback: 'index.html'`, `cleanupOutdatedCaches: true`, `clientsClaim: false`, `skipWaiting:
false`, five `runtimeCaching` entries (`jeu-images`, `jeu-sons`, `jeu-videos`, `jeu-polices` CacheFirst;
`jeu-donnees` NetworkFirst 4 s). Registration: `src/main.ts` → `src/engine/boot.ts` (`registerSW({ immediate: true,
onNeedRefresh })`, `updateSW(true)`); `src/env.d.ts` references `vite-plugin-pwa/client`. Caches are named
`<prefix>-<name>-<suffix>` by Workbox, the precache `workbox-precache-v2` + the scope (`setCacheNameDetails()` to
change); `scripts/e2e-pwa.mjs` asserts a cache starting with `workbox-precache`; entries are versioned by the content
hash in the file name or a `revision`; `cleanupOutdatedCaches` deletes older precache caches. `tools/weight.ts` reads
`dist/sw.js` and the `workbox-*.js` runtime (`tools/dist.ts` lists the workbox packages for the licences); `src/engine/tools/inventory.ts` classifies both as
code. A field report with Vite 8 + 1.3.0 (LibreChat #15654) says the plugin globs `dist/` from `closeBundle`, so
files other plugins write in `closeBundle` (`sealBuild` runs `tools/dist.ts seal` there) may be missed or precached
before removal: re-check the precache list after the upgrade.

## 4. Vitest 5, happy-dom, Playwright

Vitest 5.0 requires Vite ≥ 6.4 and Node ≥ 22.12; Vite is a **peer dependency** `^6.4.0 || ^7.0.0 || ^8.0.0`
(5.0.0 2026-09-03, 5.0.3 2026-09-30), so **the installed Vitest 5.0.3 supports Vite 8**; `@vitest/coverage-v8` must
match exactly. The Vitest 5 changes were absorbed at 4.1.7 (`clearMocks`, hoisted `vi.mock`, thresholds, `-t`,
`globalThis` propagation in happy-dom). Vitest does not depend on `typescript`. Eight tests use happy-dom;
`happy-dom` 20.14.5 and `playwright` 1.63.0 need Node ≥ 20 and nothing of TS 7 or Vite 8. Vitest issue #10610 asked
for a `vite >= 8.0.16` floor over an 8.0.0–8.0.15 advisory: pin `^8.0.16` or higher (8.3.3). `engines.node ">=22"`
should become `">=22.12"`.

## 5. What the repository touches

- `baseUrl` / non-relative `paths`: `tsconfig.json` (`baseUrl: "."`; `web-scumm/*`, `@engine/*`, `@game`, `@game/*`),
  `tsconfig.strictest.json` (extends it), `cli/create.mjs` lines 117–123 (the generated project's tsconfig). There is
  no `games/_template/tsconfig.json`. Fix: drop `baseUrl`, prefix every value with `./`.
- Aliases at runtime: `vite.config.ts` `resolve.alias`, `tools/select-game.ts` (`.cache/game`, "only `tsc` and the
  editor read tsconfig.json"); `tools/vite/plugins.ts` passes `--tsconfig` to `tsx`; `npm run assets|prompts|i18n|
  bench|page:*|import-layout` run `tsx --tsconfig tsconfig.json`.
- `typescript` importers: `tools/api-doc.ts`, `tools/ids/codemod.ts`, `tools/mutate.ts`, `tools/studio/core.ts`,
  `tools/studio/source.ts`; `scripts/` import none. `npm run check` runs `tsc --noEmit` once, `quality` twice (with `tsconfig.strictest.json`).
- Vite config: `build.rollupOptions` (input, `entryFileNames`, `chunkFileNames` by `moduleIds`), the plugins of §2,
  the `test` block, `define`, `base`.
- CommonJS: `src/engine/dom/walk.ts` (`navmesh`); `tools/dist.ts` notes "navmesh holds javascript-astar" for licences.

## 6. Order recommended, risk, what to measure

Baseline first (`docs/dev/baselines/4.1.7.md`): build time, `npm run weight` (app shell, `initialKB`, gzip),
`e2e:weight`, `e2e:perf`, the `dist/` file list and `sw.js` precache entries, `.cache/bundle-packages-<game>.json`.

1. **Paths without `baseUrl`** (TypeScript 5.9 accepts it; no runtime effect): `tsconfig.json`, `cli/create.mjs`;
   `tsc --noEmit`, the `tsx --tsconfig` tools, `npm run new-game` and the created project's `tsc`. Risk low.
2. **The `navmesh` import** (named import or the `__esModule` guard) under Vite 6, with `e2e:smoke` and the reference
   chapter: removes the known Vite 8 blocker before the bundler changes. Risk low.
3. **Vite 8** (`vite ^8.3`, `vite-plugin-pwa ^2`, `engines.node >=22.12`): `rollupOptions` → `rolldownOptions`, keep
   `build.target: 'es2020'`; `build`, `verify:dist`, `e2e:pwa`, `e2e:weight`, `e2e:visual`, `e2e:studio`,
   `audit:assets`. Watch the chunk routing to `assets/tools/` and `assets/reality/` (the precache list and `initialKB`
   can move either way), Lightning CSS output, the `closeBundle` order between `sealBuild` and the PWA glob,
   `optimizeDeps` warnings. Optional stepping stone: `rolldown-vite@7.3.1`. Risk medium; expect a faster build and a
   few KB of movement.
4. **vite-plugin-pwa 2.0.0** rides with step 3 (same workbox, same options; the Node floor only). Risk low.
5. **TypeScript 7**: blocked by the missing API until the five tools move to the 7.1 API (stable 2026-11-24 if the
   plan holds) or to `@typescript/typescript6` by name; also re-check `tsc --noEmit` under 7 for the `strict`, `types`
   and `stableTypeOrdering` diagnostics. Risk high today. Measure `tsc --noEmit` wall time before and after: the
   point of the upgrade.

Sources: the TypeScript 7.0, 7.0 beta and 6.0 announcements (devblogs.microsoft.com/typescript), the 7.1 iteration
plan (microsoft/TypeScript#63703), the tsconfig reference, microsoft/typescript-go (#1544), the Vite 8 and Vite 7
migration guides, the Vite 8 announcement, the Rolldown integration and CommonJS pages, the Rolldown reference
(`PreRenderedChunk`), the Vite features page, the vite-plugin-pwa releases (v2.0.0, #923, #933) and docs, the
Workbox core docs, the Vitest migration guide (#10610), LibreChat #15654, and the npm registry metadata of
typescript, @typescript/typescript6, vite, rolldown-vite, vitest, vite-plugin-pwa, happy-dom, playwright and tsx.
