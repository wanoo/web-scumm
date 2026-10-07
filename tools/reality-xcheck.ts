// npm run reality:xcheck [-- --require-rust] (4.1.1 "Reality Bridge"): Biscuit's official samples
// (bridge/test-vectors/biscuit) through the JavaScript implementation the Bridge runs and through the Rust crate
// (bridge/xcheck, when cargo is there; --require-rust: fail without it, as CI does). Every validation must give the
// verdict the specification expects (Ok, Format, FailedLogic, Execution), the same in both, with the same number of
// revocation ids. Excluded, with the reason: the samples that need host functions (FFI) the Bridge does not register.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { biscuitLib, errorClass } from '../bridge/src/biscuit';
import { importBridgeKey, verifySignal } from '../src/engine/reality/protocol';
import { authorize } from '../bridge/src/policy';
import { ROOT } from './game';
import { flushExit } from './flush';

const DIR = resolve(ROOT, 'bridge/test-vectors/biscuit');
const EXCLUDED: Record<string, string> = {
  'test035_ffi.bc': 'extern functions provided by the host (FFI): the Bridge registers none',
};
type Verdict = { file: string; validation: string; verdict: string; revocation: number };

interface Samples {
  root_public_key: string;
  testcases: {
    filename: string;
    validations: Record<
      string,
      { authorizer_code?: string; result: { Ok?: unknown; Err?: Record<string, unknown> }; revocation_ids: string[] }
    >;
  }[];
}
const samples = JSON.parse(readFileSync(join(DIR, 'samples.json'), 'utf8')) as Samples;
const expected = (r: { Ok?: unknown; Err?: Record<string, unknown> }) =>
  r.Ok !== undefined ? 'Ok' : (Object.keys(r.Err ?? {})[0] ?? '?');

async function javascript(): Promise<Verdict[]> {
  const b = await biscuitLib();
  const root = b.PublicKey.fromString(samples.root_public_key.replace(/^ed25519\//, ''), b.SignatureAlgorithm.Ed25519);
  const out: Verdict[] = [];
  for (const t of samples.testcases)
    for (const [validation, v] of Object.entries(t.validations)) {
      let verdict = 'Ok';
      let revocation = 0;
      try {
        const token = b.Biscuit.fromBytes(readFileSync(join(DIR, t.filename)), root);
        revocation = token.getRevocationIdentifiers().length;
        const a = new b.AuthorizerBuilder();
        a.addCode(v.authorizer_code ?? '');
        try {
          // 1 s, not the default millisecond: a slow CI runner must not turn a verdict into a timeout.
          a.buildAuthenticated(token).authorizeWithLimits({ max_time_micro: 1_000_000 });
        } catch (e) {
          verdict = errorClass(e);
        }
      } catch {
        verdict = 'Format';
      }
      out.push({ file: t.filename, validation, verdict, revocation });
    }
  return out;
}

function rust(): Verdict[] | null {
  const dir = resolve(ROOT, 'bridge/xcheck');
  try {
    execFileSync('cargo', ['--version'], { stdio: 'ignore' });
  } catch {
    return null;
  }
  const out = execFileSync('cargo', ['run', '--quiet', '--release', '--', DIR], {
    cwd: dir,
    encoding: 'utf8',
    maxBuffer: 1 << 24,
  });
  return out
    .trim()
    .split('\n')
    .map((l) => {
      const r = JSON.parse(l) as { file: string; validation: string; verdict: string; revocation: string[] };
      return { ...r, revocation: r.revocation.length };
    });
}

const js = await javascript();
const rs = existsSync(resolve(ROOT, 'bridge/xcheck/Cargo.toml')) ? rust() : null;
const problems: string[] = [];
let checked = 0;
for (const t of samples.testcases)
  for (const [validation, v] of Object.entries(t.validations)) {
    if (EXCLUDED[t.filename]) continue;
    checked++;
    const want = expected(v.result);
    const key = (x: Verdict) => x.file === t.filename && x.validation === validation;
    const j = js.find(key);
    const r = rs?.find(key);
    const tag = `${t.filename}${validation ? ` [${validation}]` : ''}`;
    if (j?.verdict !== want) problems.push(`${tag}: JavaScript says ${j?.verdict}, the specification ${want}`);
    if (rs && r?.verdict !== want) problems.push(`${tag}: Rust says ${r?.verdict}, the specification ${want}`);
    if (want !== 'Format' && j && j.revocation !== v.revocation_ids.length)
      problems.push(
        `${tag}: JavaScript gives ${j.revocation} revocation ids, the specification ${v.revocation_ids.length}`,
      );
    if (rs && r && j && r.revocation !== j.revocation)
      problems.push(`${tag}: revocation ids differ (JavaScript ${j.revocation}, Rust ${r.revocation})`);
  }
// The signed signal's conformance corpora (V1, and SignalV2 since 4.1.10): the player's verifier (JavaScript) and the
// Rust one give each case's verdict. A case's `expect` overrides the file's; a field set to null is left out.
type Corpus = {
  keys: { kid: string; raw: string; notBefore?: number; notAfter?: number; tenantId?: string }[];
  expect: Record<string, unknown> & { signals: string[] };
  cases: { name: string; jws: string; verdict: string; expect?: Record<string, unknown> }[];
};
const CORPORA = [
  resolve(ROOT, 'tests/fixtures/reality/conformance.json'),
  resolve(ROOT, 'bridge/test-vectors/signal-v2/conformance.json'),
];
let signalCases = 0;
for (const file of CORPORA) {
  const corpus = JSON.parse(readFileSync(file, 'utf8')) as Corpus;
  signalCases += corpus.cases.length;
  const keyring = await Promise.all(corpus.keys.map(({ kid, raw, ...w }) => importBridgeKey(kid, raw, w)));
  for (const c of corpus.cases) {
    const e: Record<string, unknown> = { ...corpus.expect, ...c.expect };
    for (const [k, v] of Object.entries(e)) if (v === null) delete e[k];
    const r = await verifySignal(c.jws, keyring, {
      ...(e as unknown as Parameters<typeof verifySignal>[2]),
      signals: new Set(corpus.expect.signals),
    });
    const got = r.ok ? 'ok' : r.code;
    if (got !== c.verdict) problems.push(`signal "${c.name}": JavaScript says ${got}, the corpus ${c.verdict}`);
  }
  if (rs) {
    const out = execFileSync('cargo', ['run', '--quiet', '--release', '--', 'conformance', file], {
      cwd: resolve(ROOT, 'bridge/xcheck'),
      encoding: 'utf8',
    });
    for (const l of out.trim().split('\n')) {
      const r = JSON.parse(l) as { name: string; verdict: string };
      const want = corpus.cases.find((c) => c.name === r.name)?.verdict;
      if (r.verdict !== want) problems.push(`signal "${r.name}": Rust says ${r.verdict}, the corpus ${want}`);
    }
  }
}

// The Bridge's policy: the same tokens and requests, authorised by both implementations.
const POLICY_CASES = resolve(ROOT, 'tests/fixtures/reality/policy.json');
const policy = JSON.parse(readFileSync(POLICY_CASES, 'utf8')) as {
  rootPublicKey: string;
  cases: { name: string; token: string; request: Parameters<typeof authorize>[2]; now: number; verdict: string }[];
};
for (const c of policy.cases) {
  const r = await authorize(c.token, policy.rootPublicKey, c.request, c.now);
  const got = r.ok ? 'ok' : r.code;
  if (got !== c.verdict) problems.push(`policy "${c.name}": JavaScript says ${got}, the fixture ${c.verdict}`);
}
if (rs) {
  const out = execFileSync(
    'cargo',
    ['run', '--quiet', '--release', '--', 'policy', POLICY_CASES, resolve(ROOT, 'bridge/policy/propose.datalog')],
    { cwd: resolve(ROOT, 'bridge/xcheck'), encoding: 'utf8' },
  );
  for (const l of out.trim().split('\n')) {
    const r = JSON.parse(l) as { name: string; verdict: string };
    const want = policy.cases.find((c) => c.name === r.name)?.verdict;
    if (r.verdict !== want) problems.push(`policy "${r.name}": Rust says ${r.verdict}, JavaScript ${want}`);
  }
}

for (const p of problems) console.log('  ✖ ' + p);
for (const [f, why] of Object.entries(EXCLUDED)) console.log(`  ℹ ${f} excluded: ${why}`);
if (!rs)
  console.log(`  ${process.argv.includes('--require-rust') ? '✖' : 'ℹ'} no cargo: the Rust implementation was not run`);
const fail = problems.length > 0 || (!rs && process.argv.includes('--require-rust'));
console.log(
  fail
    ? `✖  cross-check: ${problems.length} difference(s)`
    : `✔  cross-check: Biscuit's ${checked} validations, the signal's ${signalCases} cases and the policy's ${policy.cases.length}, the expected verdict in JavaScript${rs ? ' and in Rust' : ''}`,
);
await flushExit(fail ? 1 : 0);
