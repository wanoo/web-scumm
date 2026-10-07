// node scripts/pack.mjs [--out=.cache/pack] [--publish-dry-run] (3.9): the engine as npm packages, from the files git tracks. 4.1.1:
// `web-scumm-bridge`, the reference Reality Bridge, a package of its own (a game that does not run one never installs it).
// 4.1.9: `web-scumm-connectors`, the connectors of the world outside, a fourth package (an operator's, never a game's).
// `web-scumm`: the engine (src/), its pages, its tools and the `web-scumm` command, the game template; never a game
// of this repository, a test, a doc page or a build. `create-web-scumm`: `npx create-web-scumm <folder>`, which runs
// `web-scumm create`. Both are packed (`npm pack`) into <out>/, ready for `npm install <tarball>` or `npm publish`.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const out = resolve(ROOT, process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? '.cache/pack');
const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** What the package ships, by tracked path. */
const SHIP = [
  /^src\//,
  /^tools\//,
  /^cli\//,
  /^games\/_template\//,
  /^public\/(icons|fonts)\//,
  /^public\/og\.png$/,
  /^(index|studio)\.html$/,
  /^vite\.config\.ts$/,
  /^tsconfig\.json$/,
  /^requirements\.txt$/,
  /^LICENSE$/,
];
// The Bridge's development tools (Biscuit's samples, the Rust cross-check) stay in the repository.
const SKIP = [
  /__pycache__|\.pyc$/,
  /^tools\/audit-assets\.ts$/,
  /^tools\/reality-(xcheck|fixtures)\.ts$/,
  // The connectors' fuzz harness reads the repository's corpus and sample game (4.1.9): a development tool.
  /^tools\/fuzz-connectors\.ts$/,
];
const shipped = (list) =>
  list.split('\n').filter((f) => f && SHIP.some((r) => r.test(f)) && !SKIP.some((r) => r.test(f)));
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
// Tracked files only (4.1.8): a package is what the repository holds, never a file of the machine that packs it. An
// untracked file under a shipped root is refused rather than left out silently: either commit it or ignore it.
const files = shipped(git(['ls-files', '--cached']));
const untracked = shipped(git(['ls-files', '--others', '--exclude-standard']));
if (untracked.length) {
  console.error(
    `✖  untracked file(s) under a shipped root: ${untracked.join(', ')} (git add or commit them, or add them to .gitignore)`,
  );
  process.exit(1);
}

// The tools, the dev server and the build run in the game project: what the repository has as devDependencies for
// them is a dependency of the package (tests, Playwright and the MCP SDK stay out).
const RUNTIME_DEV = [
  'vite',
  'vite-plugin-pwa',
  'tsx',
  // The compiler API the tools use (4.1.8): typescript@7 has none, so the package carries typescript6 instead.
  '@typescript/typescript6',
  '@types/node',
  '@types/howler',
  'tweakpane',
  '@tweakpane/core',
  '@modelcontextprotocol/sdk',
];
const pick = (names) =>
  Object.fromEntries(names.filter((n) => root.devDependencies?.[n]).map((n) => [n, root.devDependencies[n]]));

rmSync(out, { recursive: true, force: true });
const engine = join(out, 'web-scumm');
for (const f of files) {
  mkdirSync(dirname(join(engine, f)), { recursive: true });
  cpSync(join(ROOT, f), join(engine, f));
}
writeFileSync(
  join(engine, 'package.json'),
  JSON.stringify(
    {
      name: 'web-scumm',
      version: root.version,
      description:
        'An engine for point-and-click adventure games in the browser: content as typed data, a solver that proves the game can be finished, a Studio.',
      license: 'MIT',
      type: 'module',
      engines: root.engines,
      repository: { type: 'git', url: 'git+https://github.com/wanoo/web-scumm.git' },
      bin: { 'web-scumm': 'cli/web-scumm.mjs' },
      // The public API (4.0, docs/en/API.md): four entry modules, the command line. Anything else is internal.
      exports: {
        './content': './src/engine/api/content.ts',
        './player': './src/engine/api/player.ts',
        './minigames': './src/engine/api/minigames.ts',
        './testing': './src/engine/api/testing.ts',
        './reality': './src/engine/api/reality.ts',
        './cli/*': './cli/*',
        './package.json': './package.json',
      },
      dependencies: {
        ...Object.fromEntries(Object.entries(root.dependencies).filter(([n]) => n !== 'sirv-cli')),
        ...pick(RUNTIME_DEV),
      },
    },
    null,
    2,
  ) + '\n',
);
writeFileSync(
  join(engine, 'README.md'),
  `# web-scumm\n\nAn engine for point-and-click adventure games in the browser. Start a game:\n\n\`\`\`bash\nnpx create-web-scumm my-game\ncd my-game && npm install\nnpm run assets && npm run dev\n\`\`\`\n\nThen \`npx web-scumm help\`. Documentation: https://github.com/wanoo/web-scumm (docs/en/PACKAGE.md).\n`,
);

const create = join(out, 'create-web-scumm');
mkdirSync(create, { recursive: true });
writeFileSync(
  join(create, 'index.mjs'),
  `#!/usr/bin/env node\n// npx create-web-scumm <folder> ["Title"]: runs \`web-scumm create\` from the engine this package depends on.\nimport 'web-scumm/cli/create.mjs';\n`,
);
writeFileSync(
  join(create, 'package.json'),
  JSON.stringify(
    {
      name: 'create-web-scumm',
      version: root.version,
      description: 'Creates a web-scumm game project: npx create-web-scumm my-game',
      license: 'MIT',
      type: 'module',
      bin: { 'create-web-scumm': 'index.mjs' },
      dependencies: { 'web-scumm': root.version },
    },
    null,
    2,
  ) + '\n',
);
cpSync(join(ROOT, 'LICENSE'), join(create, 'LICENSE'));

// The Reality Bridge (4.1.1; compiled since 4.1.2): bridge/src and the protocol it shares with the player, bundled
// into one JavaScript module by esbuild, so the package runs on Node alone (no tsx, no TypeScript at run time); the
// Datalog policies beside it, where `new URL('../policy/…', import.meta.url)` finds them from src/cli.mjs; Biscuit's
// WebAssembly and zod stay dependencies.
const bridge = join(out, 'web-scumm-bridge');
mkdirSync(join(bridge, 'src'), { recursive: true });
execFileSync(
  join(ROOT, 'node_modules', '.bin', 'esbuild'),
  [
    'bridge/src/cli.ts',
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--target=node22',
    '--log-level=warning',
    `--outfile=${join(bridge, 'src', 'cli.mjs')}`,
    '--external:@biscuit-auth/biscuit-wasm',
    '--external:zod',
    '--external:zod/*',
    // Optional (4.1.10): loaded by name only when the distributed profile or OpenTelemetry is used.
    '--external:pg',
    '--external:@opentelemetry/*',
  ],
  { cwd: ROOT, stdio: 'inherit' },
);
for (const f of readdirSync(join(ROOT, 'bridge', 'policy')).filter((f) => f.endsWith('.datalog'))) {
  mkdirSync(join(bridge, 'policy'), { recursive: true });
  cpSync(join(ROOT, 'bridge', 'policy', f), join(bridge, 'policy', f));
}
// The store's schema (4.1.10), where `new URL('../migrations/', import.meta.url)` finds it from src/cli.mjs.
for (const f of readdirSync(join(ROOT, 'bridge', 'migrations')).filter((f) => f.endsWith('.sql'))) {
  mkdirSync(join(bridge, 'migrations'), { recursive: true });
  cpSync(join(ROOT, 'bridge', 'migrations', f), join(bridge, 'migrations', f));
}
writeFileSync(
  join(bridge, 'bin.mjs'),
  `#!/usr/bin/env node\n// web-scumm-bridge <init|serve|grant|rotate|revoke|doctor|compact|migrate|tenant|backup|restore>: the reference Reality Bridge on its own, for a\n// game that is already built: \`init --manifest=<game>/dist/reality-manifest.json\`, then \`serve\`. docs/en/REALITY-OPS.md.\nconst { main } = await import('./src/cli.mjs');\nprocess.exitCode = await main(process.argv.slice(2));\n`,
);
writeFileSync(
  join(bridge, 'package.json'),
  JSON.stringify(
    {
      name: 'web-scumm-bridge',
      version: root.version,
      description:
        'The reference Reality Bridge for web-scumm games: signals from the world outside, signed, delivered at least once.',
      license: 'MIT',
      type: 'module',
      engines: root.engines,
      repository: { type: 'git', url: 'git+https://github.com/wanoo/web-scumm.git' },
      bin: { 'web-scumm-bridge': 'bin.mjs' },
      exports: { './cli': './src/cli.mjs', './package.json': './package.json' },
      dependencies: {
        '@biscuit-auth/biscuit-wasm': root.devDependencies['@biscuit-auth/biscuit-wasm'],
        zod: root.dependencies.zod,
      },
      // Optional (4.1.10): `pg` for the distributed profile (Postgres), OpenTelemetry's API for the measures. npm does
      // not install an optional peer: the `local` profile (SQLite, node:sqlite) needs neither.
      peerDependencies: { pg: root.devDependencies.pg, '@opentelemetry/api': '^1.9.0' },
      peerDependenciesMeta: { pg: { optional: true }, '@opentelemetry/api': { optional: true } },
    },
    null,
    2,
  ) + '\n',
);
cpSync(join(ROOT, 'LICENSE'), join(bridge, 'LICENSE'));
writeFileSync(
  join(bridge, 'README.md'),
  `# web-scumm-bridge\n\nThe reference Reality Bridge for a web-scumm game. \`npx web-scumm-bridge init --manifest=dist/reality-manifest.json\`, then \`npx web-scumm-bridge serve\`; \`doctor\` and \`compact\` for the journal. Documentation: https://github.com/wanoo/web-scumm (docs/en/REALITY-OPS.md).\n`,
);

// The connectors (4.1.9, docs/en/CONNECTORS.md): the SDK, `web-scumm-connector` and the four connectors bundled into
// one module (src/run.mjs), the MIME reader's worker beside it (src/mime-worker.mjs, where `new URL('./mime-worker.mjs',
// import.meta.url)` finds it), `ssh2` a dependency. A game never installs it; an operator runs it next to a Bridge.
const connectors = join(out, 'web-scumm-connectors');
mkdirSync(join(connectors, 'src'), { recursive: true });
for (const [entry, outfile] of [
  ['connectors/src/run.ts', 'run.mjs'],
  ['connectors/src/email/mime-worker.ts', 'mime-worker.mjs'],
])
  execFileSync(
    join(ROOT, 'node_modules', '.bin', 'esbuild'),
    [
      entry,
      '--bundle',
      '--platform=node',
      '--format=esm',
      '--target=node22',
      '--log-level=warning',
      `--outfile=${join(connectors, 'src', outfile)}`,
      '--external:ssh2',
    ],
    { cwd: ROOT, stdio: 'inherit' },
  );
writeFileSync(
  join(connectors, 'bin.mjs'),
  `#!/usr/bin/env node\n// web-scumm-connector <email|telnet|ssh|open-badge> --config <file.json>: one connector of the world outside, as its own\n// process, beside a web-scumm-bridge. docs/en/CONNECTORS.md.\nconst { main } = await import('./src/run.mjs');\nprocess.exitCode = await main(process.argv.slice(2));\n`,
);
writeFileSync(
  join(connectors, 'package.json'),
  JSON.stringify(
    {
      name: 'web-scumm-connectors',
      version: root.version,
      description:
        'Connectors of the world outside for web-scumm games (email, Telnet, SSH, Open Badges): each its own process, proposing signals to a web-scumm-bridge. Experimental.',
      license: 'MIT',
      type: 'module',
      engines: root.engines,
      repository: { type: 'git', url: 'git+https://github.com/wanoo/web-scumm.git' },
      bin: { 'web-scumm-connector': 'bin.mjs' },
      exports: { './run': './src/run.mjs', './package.json': './package.json' },
      dependencies: { ssh2: root.devDependencies.ssh2 },
    },
    null,
    2,
  ) + '\n',
);
cpSync(join(ROOT, 'LICENSE'), join(connectors, 'LICENSE'));
writeFileSync(
  join(connectors, 'README.md'),
  `# web-scumm-connectors\n\nConnectors of the world outside for a web-scumm game: email, Telnet, SSH and Open Badges, each its own process, each proposing the signals its game declares to a \`web-scumm-bridge\` under its own Biscuit. Experimental (4.1.9). Install without native code: \`npm install --omit=optional --ignore-scripts web-scumm-connectors\`. Then \`npx web-scumm-connector <email|telnet|ssh|open-badge> --config connector.json\`. Documentation: https://github.com/wanoo/web-scumm (docs/en/CONNECTORS.md).\n`,
);

for (const d of [engine, create, bridge, connectors])
  execFileSync('npm', ['pack', '--pack-destination', out, '--silent'], {
    cwd: d,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
console.log(
  `packed into ${out}: web-scumm ${root.version} (${files.length} files), create-web-scumm, web-scumm-bridge (one module, its policies), web-scumm-connectors (one module, its MIME worker)`,
);
// --publish-dry-run (4.1.8): what `npm publish` would send, for each package, without sending it (release-check).
if (process.argv.includes('--publish-dry-run'))
  for (const dir of [engine, create, bridge, connectors]) {
    execFileSync('npm', ['publish', '--dry-run', '--ignore-scripts'], {
      cwd: dir,
      stdio: 'inherit',
    });
  }
