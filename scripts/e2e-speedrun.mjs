// npm run e2e:speedrun [-- --browsers=chromium,webkit,firefox] [--allow-skip] [--bundle-only] (4.1.14 "Time Attack",
// ADR 0016): the speedrun's determinism in three browsers. One module, bundled once with esbuild (the engine, the
// reference chapter, the verifier, the recorder, IndexedDB's run store), served from a local origin (IndexedDB needs
// one) and evaluated in Node first, then in Chromium (also with its CPU slowed four times), WebKit and Firefox:
// 1. the generator's vectors (tests/fixtures/prng-vectors.json) drawn the same;
// 2. the committed reference run (tests/fixtures/speedrun/reference-any.wsrun) replayed: the same final state hash,
//    the same IGT and active IGT, the same final proof as the file and as Node;
// 3. a run recorded with IndexedDB, the page closed after its first chunk, a new page resuming from the last chunk
//    that checks, the run finished and sealed, and verified valid.
// Exit codes: 0 every browser agrees, 1 a difference, 3 a browser Playwright cannot launch here (`--allow-skip` makes
// that 0, said on the output), never a silent pass. `--bundle-only` builds the module and stops (a quick check).
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const names = (args.find((a) => a.startsWith('--browsers='))?.slice(11) ?? 'chromium,webkit,firefox').split(',');
const allowSkip = args.includes('--allow-skip');

// The reference chapter's layouts, read here (the game's index uses import.meta.glob, which esbuild does not have).
const LAYOUT_DIR = resolve(ROOT, 'games/reference/layout');
const layouts = Object.fromEntries(
  readdirSync(LAYOUT_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(resolve(LAYOUT_DIR, f), 'utf8'))]),
);
const envelopeText = readFileSync(resolve(ROOT, 'tests/fixtures/speedrun/reference-any.wsrun'), 'utf8').trim();
const vectors = JSON.parse(readFileSync(resolve(ROOT, 'tests/fixtures/prng-vectors.json'), 'utf8'));

const entry = `
import { derive, Prng } from './src/engine/core/prng.ts';
import { Engine } from './src/engine/core/engine.ts';
import { FakePresenter, MemoryStore } from './src/engine/core/ports.ts';
import { readRun } from './src/engine/core/journal-chunks.ts';
import { game } from './games/reference/game.ts';
import { verifyRun } from './src/engine/tools/speedrun/verify.ts';
import { SpeedrunRecorder } from './src/engine/tools/speedrun/recorder.ts';
import { IndexedDbRunStore } from './src/engine/dom/run-store.ts';
const LAYOUTS = ${JSON.stringify(layouts)};
const ENVELOPE = ${JSON.stringify(envelopeText)};
const VECTORS = ${JSON.stringify(vectors)};
const ctx = () => {
  const env = JSON.parse(ENVELOPE);
  // The approved fingerprint is the file's (the fingerprint itself is checked in Node); here: the replay's determinism.
  return { game: structuredClone(game), layouts: LAYOUTS, fingerprint: env.fingerprint, engineVersion: env.engineVersion };
};
globalThis.__prng = () => {
  const out = [];
  const p = new Prng('x');
  p.restore(VECTORS.reference.state);
  out.push({ name: 'reference', got: VECTORS.reference.u32.map(() => p.nextU32()), expected: VECTORS.reference.u32 });
  for (const v of VECTORS.vectors) {
    const s = derive(v.seed, v.stream);
    out.push({ name: v.seed + '/' + v.stream, got: v.u32.map(() => s.nextU32()), expected: v.u32 });
  }
  return out;
};
globalThis.__replay = async () => {
  const r = await verifyRun(ENVELOPE, ctx());
  return { verdict: r.verdict, code: r.code, recomputed: r.recomputed ?? null };
};
const recorder = (engine, store, runId) => {
  const c = ctx();
  return {
    engine, gameId: c.game.id, manifest: c.game.speedrun, category: c.game.speedrun.categories[0], store,
    fingerprint: c.fingerprint, engineVersion: c.engineVersion, runId, now: () => 0,
  };
};
// Phase 1: a run with IndexedDB, past its first chunk; the page is then closed without sealing.
globalThis.__phase1 = async (runId) => {
  const store = await IndexedDbRunStore.open('web-scumm-runs-e2e');
  const engine = new Engine(structuredClone(game), LAYOUTS, new FakePresenter(), new MemoryStore());
  const rec = new SpeedrunRecorder(recorder(engine, store, runId));
  await rec.start();
  for (let i = 0; i < 520 && !engine.state.done; i++) await engine.act({ verb: 'look', a: engine.targets()[0] });
  await rec.flushed();
  const run = await readRun(store, runId);
  return { chunks: run ? run.chunks.length : 0 };
};
// Phase 2, in a new page: resume from the last chunk that checks, finish with the solver's route, verify.
globalThis.__phase2 = async (runId, route) => {
  const store = await IndexedDbRunStore.open('web-scumm-runs-e2e');
  const engine = new Engine(structuredClone(game), LAYOUTS, new FakePresenter(), new MemoryStore());
  const rec = await SpeedrunRecorder.resume({ ...recorder(engine, store, runId), runId });
  if (!rec) return { resumed: false };
  // The committed run's inputs after its new game, with the answers they gave (choices), played as a player would.
  engine.ui.picks = route.flatMap((e) => e.picks ?? []);
  for (const e of route) {
    if (engine.state.done) break;
    if (e.act) await engine.act(e.act);
    else if (e.travel) await engine.travel(e.travel);
    else if (e.switch) await engine.switchTo(e.switch);
    else if (e.step) await engine.advance(e.step);
  }
  if (!rec.tracker.finished) return { resumed: true, finished: false };
  const env = await rec.seal();
  const r = await verifyRun(env, ctx());
  return { resumed: true, finished: true, verdict: r.verdict, code: r.code };
};`;
const bundle = await build({
  stdin: { contents: entry, resolveDir: ROOT, loader: 'ts', sourcefile: 'e2e-speedrun-entry.ts' },
  bundle: true,
  format: 'iife',
  target: 'es2022',
  write: false,
  charset: 'utf8',
  define: { 'import.meta.env': 'undefined' },
  loader: { '.json': 'json' },
});
const code = bundle.outputFiles[0].text;
console.log(`bundle: ${(code.length / 1024).toFixed(0)} KB`);
if (args.includes('--bundle-only')) process.exit(0);

// The committed run's inputs after its new game: what phase 2 plays once resumed (the looks of phase 1 change nothing
// the chapter needs).
const env = JSON.parse(envelopeText);
const route = env.chunks.flatMap((c) => c.entries).filter((e) => !e.start);

const { chromium, firefox, webkit } = await import('playwright');
const server = createServer((req, res) => {
  if (req.url === '/bundle.js') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(code);
  res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><meta charset="utf-8"><title>speedrun</title><script src="/bundle.js"></script>');
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const origin = `http://127.0.0.1:${server.address().port}/`;

let failed = 0;
const fail = (who, msg) => {
  console.error(`✖  ${who}: ${msg}`);
  failed++;
};
const check = (who, prng, rep) => {
  const bad = prng.filter((r) => JSON.stringify(r.got) !== JSON.stringify(r.expected));
  for (const b of bad) fail(who, `generator vector ${b.name} differs`);
  if (rep.verdict !== 'valid') fail(who, `the reference run is ${rep.verdict} (${rep.code})`);
  else if (rep.recomputed.finalProof !== env.finalProof || rep.recomputed.logicalTime !== env.timing.logicalTime)
    fail(who, `another proof or IGT: ${rep.recomputed.finalProof.slice(0, 12)} ${rep.recomputed.logicalTime}`);
  else if (!bad.length)
    console.log(`✔  ${who}: ${prng.length} generator vectors, the reference run replayed: IGT ${rep.recomputed.logicalTime} µt, proof ${env.finalProof.slice(0, 12)}…`);
};

// Node first: the same bundle, so a difference in a browser is the browser's.
const node = new Function(`${code}; return globalThis;`)();
check('node', node.__prng(), await node.__replay());

let skipped = 0;
const types = { chromium, webkit, firefox };
for (const name of names) {
  const type = types[name];
  if (!type) {
    fail(name, 'unknown browser (chromium, webkit or firefox)');
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
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(origin);
    check(name, await page.evaluate(() => globalThis.__prng()), await page.evaluate(() => globalThis.__replay()));
    if (name === 'chromium') {
      // The machine's speed never changes the verdict: the CPU four times slower, the same proof.
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      check('chromium (CPU ÷4)', await page.evaluate(() => globalThis.__prng()), await page.evaluate(() => globalThis.__replay()));
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    }
    // Resume after the tab is closed.
    const runId = `e2e-${name}-${Date.now()}`;
    const p1 = await page.evaluate((id) => globalThis.__phase1(id), runId);
    await page.close();
    if (p1.chunks < 1) fail(name, `no chunk was stored before the tab closed (${p1.chunks})`);
    const again = await context.newPage();
    await again.goto(origin);
    const p2 = await again.evaluate(([id, r]) => globalThis.__phase2(id, r), [runId, route]);
    if (!p2.resumed) fail(name, 'the run did not resume after the tab closed');
    else if (!p2.finished) fail(name, 'the resumed run did not reach its finish');
    else if (p2.verdict !== 'valid') fail(name, `the resumed run is ${p2.verdict} (${p2.code})`);
    else console.log(`✔  ${name}: a run closed after its first chunk resumed, finished and verified valid`);
  } catch (e) {
    fail(name, e.message.split('\n')[0]);
  } finally {
    await browser.close();
  }
}
server.close();
if (failed) process.exit(1);
if (skipped) {
  console.log(`${allowSkip ? 'ℹ' : '✖'}  ${skipped} browser(s) not run${allowSkip ? ' (--allow-skip)' : ''}`);
  process.exit(allowSkip ? 0 : 3);
}
