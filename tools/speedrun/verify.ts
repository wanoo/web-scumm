// npm run speedrun:verify -- <run.wsrun> [--keys=<bridge-keys.json>] [--json] [--timeout=<ms>] (4.1.14 "Time Attack",
// ADR 0017): verifies a speedrun envelope against the current game (GAME, or package.json's), prints the verdict, its
// code and its reason, and exits 0 for `valid` or `valid-unranked`, 1 otherwise (`inconclusive` included: never valid).
// `--keys`: the Bridge's public keys (GET /v1/keys) for a `recorded` or `live` category's signals.
import { readFileSync } from 'node:fs';
import { canonicalJson } from '../../src/engine/core/canonical';
import type { Keyring } from '../../src/engine/reality/protocol';
import { formatTime } from '../../src/engine/tools/speedrun/splits';
import { verifyRun } from '../../src/engine/tools/speedrun/verify';
import { flushExit } from '../flush';
import { approvedContext } from './package';

const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!file) {
  console.log('usage: npm run speedrun:verify -- <run.wsrun> [--keys=<bridge-keys.json>] [--json] [--timeout=<ms>]');
  process.exit(2);
}
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const ctx = await approvedContext();
const keys = arg('keys');
if (keys) {
  const k = JSON.parse(readFileSync(keys, 'utf8')) as { keys?: Keyring } | Keyring;
  ctx.keyring = Array.isArray(k) ? k : (k.keys ?? []);
}
const text = readFileSync(file, 'utf8');
// The player the signals were delivered to: what each signal's signature must name.
const player = /"playerId":"(p-[\w-]+)"/.exec(text)?.[1];
if (ctx.game.reality && player)
  ctx.signals = { gameId: ctx.game.id, playerId: player, signals: new Set(ctx.game.reality.signals.map((s) => s.id)) };
if (arg('timeout')) ctx.timeoutMs = Number(arg('timeout'));
const t0 = Date.now();
const r = await verifyRun(text, ctx);
if (process.argv.includes('--json')) {
  process.stdout.write(`${canonicalJson({ ...r, ms: Date.now() - t0 })}\n`);
} else {
  const ok = r.verdict === 'valid' || r.verdict === 'valid-unranked';
  console.log(`${ok ? '✔' : '✖'}  ${r.verdict} (${r.code}): ${r.reason}`);
  console.log(`   trust: ${r.trust} · game ${ctx.game.id} · engine ${ctx.engineVersion} · ${Date.now() - t0} ms`);
  if (r.recomputed)
    console.log(
      `   IGT ${formatTime(BigInt(r.recomputed.logicalTime))} · active ${formatTime(BigInt(r.recomputed.activeTime))} · ${r.recomputed.logicalSteps} steps · proof ${r.recomputed.finalProof.slice(0, 16)}…`,
    );
}
await flushExit(r.verdict === 'valid' || r.verdict === 'valid-unranked' ? 0 : 1);
