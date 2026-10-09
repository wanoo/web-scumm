#!/usr/bin/env node
// npm run ops:qualify -- [--tarballs=<dir>] [--out=<dir>] [--keep] (4.1.18 "Dress Rehearsal", plan §8.3): the Bridge's
// qualification profile (ops/qualify/compose.yml) built from the candidate's `web-scumm-bridge` tarball, brought up
// behind HTTPS with three instances on one Postgres and two tenants, then driven the way an operator's bad day goes:
//
//   1. every image pinned by digest (compose and Dockerfile);
//   2. two tenants initialised by the package's own `init` and `grant`, three players each paired over HTTPS;
//   3. a stream held on one instance while proposals go through the proxy to all three;
//   4. an instance killed in the middle, then started again; a connector repeats what failed (its dedupeKey);
//   5. every player's sequence contiguous, each proposal applied once, duplicates said so, the stream in order;
//   6. a tenant's capability and token refused by the other tenant;
//   7. `backup`, the whole topology destroyed (its database volume too), brought up empty, `restore`, then every
//      player's signals compared and a new proposal continuing the sequence.
//
// Writes <out>/ops-qualify.json (format web-scumm-ops-qualify, schema 1: the commit, the images, each step and what
// it measured) and exits 1 when a step fails. Docker with Compose v2 on Linux; the human pass behind a real domain for
// 24-48 h (`bridge-postgres-https`) uses the same profile (ops/qualify/README.md).
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PROFILE = join(ROOT, 'ops', 'qualify');
const args = process.argv.slice(2);
const flag = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const out = resolve(flag('out') ?? '.cache/field/deployment');
mkdirSync(out, { recursive: true });
const base = mkdtempSync(join(tmpdir(), 'web-scumm-qualify-'));
const PORT = Number(flag('port') ?? 8443);
const steps = [];
const step = (name, ok, detail = {}) => {
  steps.push({ name, ok, ...detail });
  console.log(`${ok ? '✔' : '✖'}  ${name}${Object.keys(detail).length ? ` ${JSON.stringify(detail)}` : ''}`);
  return ok;
};
const sh = (cmd, a, o = {}) => {
  const r = spawnSync(cmd, a, { encoding: 'utf8', stdio: o.input !== undefined ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'], ...o });
  if (r.status !== 0 && !o.allowFail) throw new Error(`${cmd} ${a.join(' ')}: exit ${r.status}\n${r.stderr}`);
  return r;
};

// ---------------------------------------------------------------- 1. the images and the package
const compose = readFileSync(join(PROFILE, 'compose.yml'), 'utf8');
const images = [...compose.matchAll(/^\s+image:\s*(\S+)/gm)].map((m) => m[1]).filter((i) => !i.endsWith(':qualify'));
const from = [...readFileSync(join(PROFILE, 'Dockerfile.bridge'), 'utf8').matchAll(/^FROM\s+(\S+)/gm)].map((m) => m[1]);
step('every image pinned by digest', [...images, ...from].every((i) => /@sha256:[0-9a-f]{64}$/.test(i)), {
  images: [...images, ...from],
});
let tarballs = flag('tarballs');
if (!tarballs) {
  tarballs = join(base, 'pack');
  sh(process.execPath, [join(ROOT, 'scripts', 'pack.mjs'), `--out=${tarballs}`], { stdio: 'inherit' });
}
const bridgeTgz = join(resolve(tarballs), `web-scumm-bridge-${version}.tgz`);
if (!existsSync(bridgeTgz)) throw new Error(`${bridgeTgz}: no Bridge archive of ${version}`);
const build = join(base, 'build');
mkdirSync(build);
copyFileSync(join(PROFILE, 'Dockerfile.bridge'), join(build, 'Dockerfile.bridge'));
copyFileSync(bridgeTgz, join(build, 'web-scumm-bridge.tgz'));

// ---------------------------------------------------------------- 2. the tenants, by the package's own commands
const host = join(base, 'host-bridge');
mkdirSync(host);
sh('tar', ['-xzf', bridgeTgz, '-C', host, '--strip-components=1']);
sh('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: host });
const BIN = join(host, 'bin.mjs');
const manifest = {
  format: 'web-scumm-reality-manifest',
  schema: 1,
  gameId: 'qualify',
  signals: [{ id: 'letter.unclear', source: 'email', availability: 'optional', replay: 'record', once: false }],
  connectors: { email: { answers: [], otherwise: 'letter.unclear' } },
};
writeFileSync(join(base, 'manifest.json'), JSON.stringify(manifest));
const data = join(base, 'data');
const tokens = {};
for (const t of ['a', 'b']) {
  sh(process.execPath, [BIN, 'init', `--dir=${join(data, t)}`, `--tenant=${t}`, '--environment=dev', `--manifest=${join(base, 'manifest.json')}`, '--no-demo-webhooks']);
  tokens[t] = sh(process.execPath, [BIN, 'grant', `--dir=${join(data, t)}`, '--connector=qualify', '--source=email', '--signals=letter.unclear', '--pair']).stdout.trim();
}
const secrets = join(base, 'secrets');
mkdirSync(secrets, { mode: 0o700 });
const pw = randomBytes(18).toString('hex');
// Postgres reads its file as its own user: 0644 inside a folder only the operator can open; the URL stays 0600.
writeFileSync(join(secrets, 'pg_password'), pw);
chmodSync(join(secrets, 'pg_password'), 0o644);
writeFileSync(join(secrets, 'store_url'), `postgres://bridge:${pw}@postgres:5432/bridge`, { mode: 0o600 });

const env = {
  ...process.env,
  QUALIFY_BUILD: build,
  QUALIFY_DATA: data,
  QUALIFY_SECRETS: secrets,
  QUALIFY_UID: String(process.getuid?.() ?? 1000),
  QUALIFY_GID: String(process.getgid?.() ?? 1000),
  QUALIFY_PORT: String(PORT),
  QUALIFY_PORT_1: String(PORT + 1),
  QUALIFY_PORT_2: String(PORT + 2),
  QUALIFY_PORT_3: String(PORT + 3),
};
const dc = (a, o = {}) => sh('docker', ['compose', '-f', join(PROFILE, 'compose.yml'), ...a], { env, ...o });
const up = () => dc(['up', '-d', '--build', '--wait', '--wait-timeout', '180'], { stdio: 'inherit' });

let ca = '';
const https = (port, method, path, { tenant, bearer, body } = {}) =>
  new Promise((ok, ko) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        host: '127.0.0.1',
        servername: 'localhost',
        port,
        method,
        path,
        ca,
        headers: {
          ...(tenant ? { 'x-web-scumm-tenant': tenant } : {}),
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
          host: `localhost:${port}`,
        },
        timeout: 10_000,
      },
      (res) => {
        let s = '';
        res.on('data', (c) => (s += c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(s);
          } catch {
            /* not JSON */
          }
          ok({ status: res.statusCode, json });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', ko);
    if (data) req.write(data);
    req.end();
  });
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
/** What a connector does: the same proposal again until the Bridge answers it (502/503/network), at most 30 times. */
async function insist(port, method, path, o) {
  for (let i = 0; ; i++) {
    try {
      const r = await https(port, method, path, o);
      if (r.status < 500 || i >= 30) return r;
    } catch (e) {
      if (i >= 30) throw e;
    }
    await sleep(300);
  }
}
async function readyCa() {
  for (let i = 0; i < 60; i++) {
    const r = dc(['exec', '-T', 'proxy', 'cat', '/data/caddy/pki/authorities/local/root.crt'], { allowFail: true });
    if (r.status === 0 && r.stdout.includes('BEGIN CERTIFICATE')) {
      ca = r.stdout;
      try {
        if ((await https(PORT, 'GET', '/readyz')).status === 200) return;
      } catch {
        /* the proxy's certificate not issued yet */
      }
    }
    await sleep(1000);
  }
  throw new Error('the proxy never answered /readyz over HTTPS');
}
/** Every signal of a player, by their capability: the sequences in order. */
const sequences = async (tenant, cap) =>
  (await insist(PORT, 'GET', '/v1/signals', { tenant, bearer: cap })).json?.sequences ?? null;

const report = { format: 'web-scumm-ops-qualify', schema: 1, version, commit: '', images: [...images, ...from], steps };
report.commit = sh('git', ['rev-parse', 'HEAD'], { cwd: ROOT, allowFail: true }).stdout.trim();
let failedHard = null;
try {
  up();
  await readyCa();
  step('three Bridges and Postgres up behind HTTPS', true);

  // Players, paired over HTTPS the way a game and a connector pair them.
  const players = { a: [], b: [] };
  for (const t of ['a', 'b'])
    for (let i = 0; i < 3; i++) {
      const code = (await insist(PORT, 'POST', '/v1/pairings', { tenant: t, body: { gameId: 'qualify' } })).json?.code;
      const conf = await insist(PORT, 'POST', `/v1/pairings/${code}/confirm`, { tenant: t, bearer: tokens[t] });
      const claim = await insist(PORT, 'GET', `/v1/pairings/${code}`, { tenant: t });
      players[t].push({ id: conf.json?.playerId, cap: claim.json?.capability });
    }
  step('six players paired over HTTPS, three per tenant', Object.values(players).flat().every((p) => p.id && p.cap));

  // A stream held on bridge-1 for the first player of tenant a.
  const streamed = [];
  const stream = request({
    host: '127.0.0.1',
    servername: 'localhost',
    port: PORT + 1,
    path: '/v1/events',
    ca,
    headers: { 'x-web-scumm-tenant': 'a', authorization: `Bearer ${players.a[0].cap}`, host: `localhost:${PORT + 1}` },
  });
  stream.on('response', (res) => {
    let buf = '';
    res.on('data', (c) => {
      buf += c;
      for (let i; (i = buf.indexOf('\n\n')) >= 0; ) {
        const id = /^id: (\d+)$/m.exec(buf.slice(0, i))?.[1];
        if (id) streamed.push(Number(id));
        buf = buf.slice(i + 2);
      }
    });
  });
  stream.on('error', () => {});
  stream.end();
  await sleep(1000);

  // Proposals through the proxy; bridge-2 killed a third of the way, started again two thirds of the way.
  const N = 20;
  const answers = { accepted: 0, duplicate: 0, other: [] };
  let sent = 0;
  const total = N * 6;
  for (let i = 0; i < N; i++)
    for (const t of ['a', 'b'])
      for (const p of players[t]) {
        if (sent === Math.floor(total / 3)) dc(['kill', 'bridge-2']);
        if (sent === Math.floor((2 * total) / 3)) dc(['start', 'bridge-2']);
        sent++;
        const body = { playerId: p.id, signal: 'letter.unclear', source: 'email', dedupeKey: `${t}-${p.id}-${i}` };
        const r = await insist(PORT, 'POST', '/v1/signals', { tenant: t, bearer: tokens[t], body });
        if (r.status === 202) answers.accepted++;
        else if (r.status === 200 && r.json?.duplicate) answers.duplicate++;
        else answers.other.push(`${r.status} ${JSON.stringify(r.json)}`);
        // Every fifth, the connector sends it again: applied once, said a duplicate.
        if (i % 5 === 0) {
          const again = await insist(PORT, 'POST', '/v1/signals', { tenant: t, bearer: tokens[t], body });
          if (again.status === 200 && again.json?.duplicate) answers.duplicate++;
          else answers.other.push(`again: ${again.status} ${JSON.stringify(again.json)}`);
        }
      }
  dc(['up', '-d', '--wait', 'bridge-2']);
  const expected = Array.from({ length: N }, (_, k) => k + 1);
  const before = {};
  for (const t of ['a', 'b']) for (const p of players[t]) before[`${t}/${p.id}`] = await sequences(t, p.cap);
  // A proposal whose answer was lost when its instance died, sent again, is a duplicate; none is applied twice.
  step('every proposal applied once across a killed instance', answers.other.length === 0 && answers.accepted <= total, {
    accepted: answers.accepted,
    duplicates: answers.duplicate,
    refused: answers.other.slice(0, 5),
  });
  step('every player sequence contiguous, 1 to N, nothing doubled', Object.values(before).every((s) => JSON.stringify(s) === JSON.stringify(expected)), {
    players: Object.keys(before).length,
    perPlayer: N,
  });
  for (let w = 0; w < 20 && streamed.length < N; w++) await sleep(500);
  stream.destroy();
  step('a stream held on bridge-1 received what the other instances accepted, in order, once', JSON.stringify(streamed) === JSON.stringify(expected), {
    received: streamed.length,
  });

  // Tenants: neither's capability nor token works on the other.
  const crossRead = await https(PORT, 'GET', '/v1/signals', { tenant: 'b', bearer: players.a[0].cap });
  const code = (await https(PORT, 'POST', '/v1/pairings', { tenant: 'b', body: { gameId: 'qualify' } })).json?.code;
  const crossToken = await https(PORT, 'POST', `/v1/pairings/${code}/confirm`, { tenant: 'b', bearer: tokens.a });
  step("a tenant's capability and connector token refused by the other tenant", crossRead.status >= 400 && crossToken.status >= 400, {
    read: crossRead.status,
    confirm: crossToken.status,
  });

  // Backup, the topology destroyed with its database, brought up empty, restore, compared.
  const backup = dc(['exec', '-T', 'bridge-1', 'sh', '-c', 'node /opt/bridge/bin.mjs backup --dir=/srv/bridge/a --out=/tmp/backup.json >&2 && cat /tmp/backup.json']).stdout;
  writeFileSync(join(out, 'backup.json'), backup, { mode: 0o600 });
  dc(['down', '-v'], { stdio: 'inherit' });
  up();
  await readyCa();
  dc(['exec', '-T', 'bridge-1', 'sh', '-c', 'cat > /tmp/backup.json'], { input: backup });
  dc(['exec', '-T', 'bridge-1', 'node', '/opt/bridge/bin.mjs', 'restore', '--dir=/srv/bridge/a', '--from=/tmp/backup.json'], { stdio: 'inherit' });
  const after = {};
  for (const t of ['a', 'b']) for (const p of players[t]) after[`${t}/${p.id}`] = await sequences(t, p.cap);
  step('backup, the topology and its database destroyed, restore: every player as before', JSON.stringify(after) === JSON.stringify(before), {
    players: Object.keys(after).length,
  });
  const next = await insist(PORT, 'POST', '/v1/signals', {
    tenant: 'a',
    bearer: tokens.a,
    body: { playerId: players.a[0].id, signal: 'letter.unclear', source: 'email', dedupeKey: 'after-restore' },
  });
  step('after the restore a new proposal continues the sequence', next.status === 202 && next.json?.sequence === N + 1, {
    status: next.status,
    sequence: next.json?.sequence,
  });
} catch (e) {
  failedHard = e;
  step('the qualification ran to its end', false, { error: String(e.message ?? e).slice(0, 400) });
  try {
    console.error(dc(['logs', '--no-color', '--tail', '60'], { allowFail: true }).stdout);
  } catch {
    /* no logs */
  }
} finally {
  if (!args.includes('--keep')) dc(['down', '-v'], { allowFail: true });
  writeFileSync(join(out, 'ops-qualify.json'), `${JSON.stringify(report, null, 1)}\n`);
  rmSync(join(out, 'backup.json'), { force: true });
  if (!args.includes('--keep')) rmSync(base, { recursive: true, force: true });
}
const bad = steps.filter((s) => !s.ok);
console.log(`\n${bad.length ? '✖' : '✔'}  ops:qualify: ${steps.length - bad.length}/${steps.length} steps; report ${join(out, 'ops-qualify.json')}`);
process.exit(bad.length || failedHard ? 1 : 0);
