// npm run e2e:canonical [-- --browsers=chromium,webkit,firefox] [--allow-skip] (4.1.12, ADR 0013): the same
// `canonicalJson` (src/engine/core/canonical.ts) on the fifty edge values of tests/fixtures/canonical-values.ts, in
// Chromium, WebKit and Firefox, against the texts the fixture writes out (which tests/canonical-json.test.ts holds Node
// to). One module, bundled once with esbuild, evaluated in a blank page of each browser: a browser that writes one text
// differently fails, with the case named. Exit codes: 0 every browser agrees, 1 a difference, 3 a browser Playwright
// cannot launch here (`--allow-skip` makes that 0, said on the output), never a silent pass.
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const names = (args.find((a) => a.startsWith('--browsers='))?.slice(11) ?? 'chromium,webkit,firefox').split(',');
const allowSkip = args.includes('--allow-skip');

// The page's script: every case run through canonicalJson, a refusal as null.
const entry = `
import { canonicalJson } from './src/engine/core/canonical.ts';
import { CANONICAL_CASES } from './tests/fixtures/canonical-values.ts';
globalThis.__canonical = () => CANONICAL_CASES.map((c) => {
  try { return { name: c.name, got: canonicalJson(c.make()), expected: c.expected }; }
  catch { return { name: c.name, got: null, expected: c.expected }; }
});`;
const bundle = await build({
  stdin: { contents: entry, resolveDir: ROOT, loader: 'ts', sourcefile: 'e2e-canonical-entry.ts' },
  bundle: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  charset: 'utf8',
});
const code = bundle.outputFiles[0].text;

// Node first: the same bundle, so a difference in a browser is the browser's, not the bundler's.
const run = new Function(`${code}; return globalThis.__canonical();`);
const report = (who, rows) => {
  const bad = rows.filter((r) => r.got !== r.expected);
  for (const r of bad)
    console.error(`✖  ${who}: ${r.name}: got ${JSON.stringify(r.got)}, expected ${JSON.stringify(r.expected)}`);
  if (!bad.length) console.log(`✔  ${who}: ${rows.length} values, the same text`);
  return bad.length;
};
let failed = report('node', run());
let skipped = 0;
const types = { chromium, webkit, firefox };
for (const name of names) {
  const type = types[name];
  if (!type) {
    console.error(`✖  unknown browser "${name}" (chromium, webkit or firefox)`);
    failed++;
    continue;
  }
  let browser;
  try {
    browser = await type.launch();
  } catch (e) {
    console.error(`⚠  ${name}: cannot launch (${e.message.split('\n')[0]})`);
    skipped++;
    continue;
  }
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><meta charset="utf-8"><title>canonical</title>');
    await page.addScriptTag({ content: code });
    failed += report(name, await page.evaluate(() => globalThis.__canonical()));
  } finally {
    await browser.close();
  }
}
if (failed) process.exit(1);
if (skipped) {
  console.log(`${allowSkip ? 'ℹ' : '✖'}  ${skipped} browser(s) not run${allowSkip ? ' (--allow-skip)' : ''}`);
  process.exit(allowSkip ? 0 : 3);
}
