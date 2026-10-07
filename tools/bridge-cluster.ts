// Several Bridge processes on one store (4.1.10): what the `kill -9` test (tests/bridge-fanout.test.ts) and the load
// tool (tools/bridge-load.ts) start. A directory initialised by the Bridge's own `init` (a SQLite store unless
// BRIDGE_STORE names another), a connector token from its `grant`, then `serve` processes on ephemeral ports, each
// saying its URL and pid on its first line. Nothing here is a shortcut: the processes are the packaged command line.
import { type ChildProcess, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RealityManifest } from '../src/engine/reality/manifest';
import type { Limits } from '../bridge/src/config';
import { main } from '../bridge/src/cli';

const ROOT = resolve(import.meta.dirname, '..');

/** Runs the Bridge's command line in this process, its output kept (not printed). */
async function quietly(args: string[], manifest?: RealityManifest | null): Promise<{ code: number; out: string }> {
  const out: string[] = [];
  const log = console.log;
  const write = process.stdout.write;
  console.log = (x: unknown) => void out.push(`${String(x)}\n`);
  process.stdout.write = ((s: string) => (out.push(s), true)) as typeof process.stdout.write;
  try {
    const code = await main(args, manifest === undefined ? undefined : { manifest });
    return { code, out: out.join('') };
  } finally {
    console.log = log;
    process.stdout.write = write;
  }
}

/** A Bridge directory with its store, limits and a connector token that may pair (one tenant). */
export async function initCluster(
  dir: string,
  manifest: RealityManifest,
  o: { store?: string; limits?: Partial<Limits>; tenantId?: string } = {},
): Promise<{ token: string; admin: string }> {
  const init = await quietly(
    [
      'init',
      `--dir=${dir}`,
      `--store=${o.store ?? 'sqlite'}`,
      '--no-demo-webhooks',
      ...(o.tenantId ? [`--tenant=${o.tenantId}`] : []),
    ],
    manifest,
  );
  if (init.code !== 0) throw new Error(`init failed: ${init.out}`);
  const cfg = resolve(dir, 'config.json');
  const file = JSON.parse(readFileSync(cfg, 'utf8')) as Record<string, unknown>;
  writeFileSync(cfg, `${JSON.stringify({ ...file, ...(o.limits ? { limits: o.limits } : {}) }, null, 1)}\n`, {
    mode: 0o600,
  });
  const signals = manifest.signals.filter((s) => s.source === 'mail').map((s) => s.id);
  const grant = await quietly([
    'grant',
    `--dir=${dir}`,
    '--connector=load',
    '--source=mail',
    `--signals=${signals.join(',')}`,
    '--pair',
    '--days=1',
  ]);
  if (grant.code !== 0) throw new Error(`grant failed: ${grant.out}`);
  return { token: grant.out.trim(), admin: readFileSync(resolve(dir, 'admin-token'), 'utf8').trim() };
}

export interface Instance {
  child: ChildProcess;
  url: string;
  pid: number;
}

/** One `serve` process on an ephemeral port; resolves once it listens. */
export function startInstance(dir: string, env: NodeJS.ProcessEnv = process.env): Promise<Instance> {
  const child = spawn(
    process.execPath,
    ['--no-warnings', resolve(ROOT, 'bridge/bin.mjs'), 'serve', `--dir=${dir}`, '--port=0', '--host=127.0.0.1'],
    { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return new Promise((ok, ko) => {
    let out = '';
    let err = '';
    const t = setTimeout(() => ko(new Error(`the Bridge did not start: ${out}${err}`)), 30_000);
    child.stderr?.on('data', (d) => (err += String(d)));
    child.stdout?.on('data', (d) => {
      out += String(d);
      const line = out.split('\n').find((l) => l.includes('"bridge.listening"'));
      if (!line) return;
      clearTimeout(t);
      const { url, pid } = JSON.parse(line) as { url: string; pid: number };
      ok({ child, url, pid });
    });
    child.once('exit', (code) => {
      clearTimeout(t);
      ko(new Error(`the Bridge exited (${code}): ${out}${err}`));
    });
  });
}

/** Pairs a player through the routes a game and a connector use; returns its id and capability. */
export async function pairOver(url: string, token: string): Promise<{ playerId: string; capability: string }> {
  const start = await fetch(new URL('v1/pairings', url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'signals' }),
  });
  const { code } = (await start.json()) as { code: string };
  const confirm = await fetch(new URL(`v1/pairings/${code}/confirm`, url), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!confirm.ok) throw new Error(`confirm: ${confirm.status} ${await confirm.text()}`);
  const claim = (await (await fetch(new URL(`v1/pairings/${code}`, url))).json()) as {
    playerId: string;
    capability: string;
  };
  return { playerId: claim.playerId, capability: claim.capability };
}

/** Proposes one signal; the HTTP status (0 when the instance did not answer: killed, refused) and the sequence. */
export async function proposeOver(
  url: string,
  token: string,
  body: { playerId: string; signal: string; dedupeKey: string },
): Promise<number> {
  return (await proposeWithSequence(url, token, body)).status;
}
export async function proposeWithSequence(
  url: string,
  token: string,
  body: { playerId: string; signal: string; dedupeKey: string },
): Promise<{ status: number; sequence?: number }> {
  try {
    const r = await fetch(new URL('v1/signals', url), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, source: 'mail' }),
    });
    const text = await r.text();
    let sequence: number | undefined;
    try {
      sequence = (JSON.parse(text) as { sequence?: number }).sequence;
    } catch {
      /* not JSON: an error page */
    }
    return { status: r.status, ...(sequence !== undefined ? { sequence } : {}) };
  } catch {
    return { status: 0 };
  }
}

/** A player's whole journal as delivered: each sequence and the payload it carries. */
export async function journalOver(
  url: string,
  capability: string,
): Promise<{ sequence: number; dedupeKey: string; id: string }[]> {
  const r = await fetch(new URL('v1/signals?after=0', url), { headers: { Authorization: `Bearer ${capability}` } });
  const { signals, sequences } = (await r.json()) as { signals: string[]; sequences: number[] };
  return signals.map((jws, i) => {
    const p = JSON.parse(Buffer.from(jws.split('.')[1] ?? '', 'base64url').toString()) as {
      dedupeKey: string;
      id: string;
    };
    return { sequence: sequences[i] ?? -1, dedupeKey: p.dedupeKey, id: p.id };
  });
}

/**
 * Reads a player's event stream (SSE) from `url`, after `after`: the sequences in the order they arrive, until
 * `stop()` or the instance goes away (`ended`).
 */
export function streamOver(
  url: string,
  capability: string,
  after = 0,
): { seen: number[]; stop: () => void; ended: () => boolean } {
  let over = false;
  const seen: number[] = [];
  const ctrl = new AbortController();
  void (async () => {
    try {
      const r = await fetch(new URL(`v1/events?after=${after}`, url), {
        headers: { Authorization: `Bearer ${capability}` },
        signal: ctrl.signal,
      });
      const reader = r.body?.getReader();
      let buf = '';
      for (;;) {
        const chunk = await reader?.read();
        if (!chunk || chunk.done) return;
        buf += Buffer.from(chunk.value).toString();
        let i = buf.indexOf('\n\n');
        while (i >= 0) {
          const id = /^id: (\d+)$/m.exec(buf.slice(0, i))?.[1];
          if (id) seen.push(Number(id));
          buf = buf.slice(i + 2);
          i = buf.indexOf('\n\n');
        }
      }
    } catch {
      /* aborted, or the instance went away */
    } finally {
      over = true;
    }
  })();
  return { seen, stop: () => ctrl.abort(), ended: () => over };
}
