// npm run reality:spike (4.1.1 "Reality Bridge", lot A): the measures the protocol's decisions rest on, reproducible.
// Ed25519 in WebCrypto (Node, Chromium, WebKit: present, verify time, a flipped byte refused), a compact JWS (EdDSA)
// verified on its exact bytes, gzipped size of that verifier as the player would ship it, Biscuit (the Bridge's
// WebAssembly build) create, attenuate and authorise times. Prints a Markdown table (docs/dev/reality-spike.md).
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { tsImport } from 'tsx/esm/api';

/** The verifier the player needs: split, check the signature on the transported bytes, then decode. */
const VERIFY = `
const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
export async function verifyJws(jws, keys) {
  const [h, p, s] = jws.split('.');
  if (!h || !p || !s) throw new Error('not a compact JWS');
  const header = JSON.parse(new TextDecoder().decode(b64(h)));
  if (header.alg !== 'EdDSA') throw new Error('unknown algorithm ' + header.alg);
  const key = keys[header.kid];
  if (!key) throw new Error('unknown key ' + header.kid);
  const ok = await crypto.subtle.verify({ name: 'Ed25519' }, key, b64(s), new TextEncoder().encode(h + '.' + p));
  if (!ok) throw new Error('bad signature');
  return JSON.parse(new TextDecoder().decode(b64(p)));
}`;

const bench = async (verifySrc) => {
  const out = {};
  try {
    const mod = await import(`data:text/javascript,${encodeURIComponent(verifySrc)}`);
    const enc = (u) =>
      btoa(String.fromCharCode(...new Uint8Array(u)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const h = enc(new TextEncoder().encode(JSON.stringify({ alg: 'EdDSA', kid: 'k1' })));
    const p = enc(
      new TextEncoder().encode(
        JSON.stringify({
          format: 'web-scumm-world-signal',
          schema: 1,
          id: 'x',
          sequence: 1,
          signal: 'mail.answer.correct',
        }),
      ),
    );
    const sig = await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, new TextEncoder().encode(`${h}.${p}`));
    const jws = `${h}.${p}.${enc(sig)}`;
    const N = 200;
    const t = performance.now();
    for (let i = 0; i < N; i++) await mod.verifyJws(jws, { k1: kp.publicKey });
    out.verifyMs = +((performance.now() - t) / N).toFixed(3);
    const bad = `${h}.${p.slice(0, -2)}${p.at(-2) === 'A' ? 'B' : 'A'}${p.at(-1)}.${enc(sig)}`;
    out.flippedRefused = await mod.verifyJws(bad, { k1: kp.publicKey }).then(
      () => false,
      () => true,
    );
    out.unknownKeyRefused = await mod.verifyJws(jws, {}).then(
      () => false,
      () => true,
    );
  } catch (e) {
    out.error = String(e);
  }
  return out;
};

const rows = [];
rows.push(['Node ' + process.version, await bench(VERIFY)]);
const srv = createServer((_q, r) => r.end('<!doctype html><title>spike</title>')).listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
for (const [name, type] of [
  ['Chromium', chromium],
  ['WebKit', webkit],
]) {
  const browser = await type.launch();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${srv.address().port}/`);
  rows.push([`${name} ${browser.version()}`, await page.evaluate(`(${bench.toString()})(${JSON.stringify(VERIFY)})`)]);
  await browser.close();
}
srv.close();

const bundled = await build({
  stdin: { contents: VERIFY, loader: 'js' },
  bundle: true,
  minify: true,
  write: false,
  format: 'esm',
});
const gz = gzipSync(bundled.outputFiles[0].contents, { level: 9 }).length;

const { biscuitLib } = await tsImport('../bridge/src/biscuit.ts', import.meta.url);
const b = await biscuitLib();
const root = new b.KeyPair(b.SignatureAlgorithm.Ed25519);
let t = performance.now();
const builder = b.Biscuit.builder();
builder.addCode('right("game:demo", "player:p1", "source:mail", "signal:mail.answer.correct");');
const token = builder.build(root.getPrivateKey());
const block = b.Biscuit.block_builder();
block.addCode('check if time($t), $t <= 2030-01-01T00:00:00Z;');
const attenuated = token.appendBlock(block).toBase64();
const createMs = performance.now() - t;
const N = 300;
t = performance.now();
for (let i = 0; i < N; i++) {
  const a = new b.AuthorizerBuilder();
  a.addCode(
    'time(2026-10-06T00:00:00Z); allow if right("game:demo", "player:p1", "source:mail", "signal:mail.answer.correct");',
  );
  a.buildAuthenticated(b.Biscuit.fromBase64(attenuated, root.getPublicKey())).authorize();
}
const authMs = (performance.now() - t) / N;

console.log('| Where | Ed25519 present | verify a JWS (ms) | a flipped byte | an unknown key |');
console.log('|---|---|---|---|---|');
for (const [w, r] of rows)
  console.log(
    `| ${w} | ${r.error ? `no (${r.error})` : 'yes'} | ${r.verifyMs ?? '–'} | ${r.flippedRefused ? 'refused' : '–'} | ${r.unknownKeyRefused ? 'refused' : '–'} |`,
  );
console.log(`\nThe player's verifier: ${bundled.outputFiles[0].contents.length} bytes minified, ${gz} bytes gzipped.`);
console.log(
  `Biscuit (Node, WebAssembly): create and attenuate ${createMs.toFixed(1)} ms (first call, the module warm), token ${attenuated.length} characters; parse, verify and authorise ${authMs.toFixed(3)} ms.`,
);
