// The four connectors driven with hostile input in a process where V8 refuses any code made from a string (`eval`,
// `new Function`, a string timer): if a connector or its dependency needed one, it would throw here (4.1.9, plan §4
// branch 6). Offline: proposals and pairings are answered by a stub context. Prints one JSON line, exits 0 or 1.
import { createHmac } from 'node:crypto';
import { connect } from 'node:net';
import ssh2 from 'ssh2';
import { OpenBadgeConnector } from '../../../connectors/src/badges/connector';
import { EmailConnector } from '../../../connectors/src/email/connector';
import type { ConnectorContext } from '../../../connectors/src/sdk';
import { SshConnector } from '../../../connectors/src/ssh/connector';
import { TelnetConnector } from '../../../connectors/src/telnet/connector';
import { fuzz, FUZZ_TARGETS } from '../../../tools/fuzz-connectors';
import { MANIFEST } from './harness';

const ctx: ConnectorContext = {
  bridge: { url: 'http://127.0.0.1:9/', token: '' },
  gameId: 'signals',
  limits: { maxBytes: 4096, maxPerMinute: 60, timeoutMs: 100 },
  manifest: MANIFEST,
  log: () => {},
  propose: async () => ({ ok: true, sequence: 1, duplicate: false }),
  pair: async () => ({ ok: true, playerId: 'p-0123456789abcdef' }),
  reject: () => {},
  metrics: () => ({ proposed: 0, accepted: 0, duplicates: 0, refused: {}, rejectedInputs: 0, retries: 0 }),
};
const problems: string[] = [];
let evalRefused = false;
try {
  (0, eval)('1');
} catch {
  evalRefused = true;
}
if (!evalRefused) problems.push('the flag is not active');
const say = (s: { write(b: string | Buffer): void }, x: string | Buffer) => s.write(x);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const telnet = new TelnetConnector({ port: 0 });
await telnet.start(ctx);
const t = connect(telnet.port, '127.0.0.1');
t.on('error', () => {});
say(t, 'AAAAAAAA\r\nlamp on\r\n$(id)\r\n');
say(t, Buffer.from([255, 253, 1, 0, 0xff, 0xfe, 3, 13, 10]));
await wait(200);
t.destroy();
await telnet.stop();

const ssh = new SshConnector({ port: 0, hostKey: ssh2.utils.generateKeyPairSync('ed25519').private });
await ssh.start(ctx);
const client = new ssh2.Client();
await new Promise<void>((ok) => {
  client.on('ready', () =>
    client.shell({ cols: 80, rows: 24 }, (err, stream) => {
      if (err) return ok();
      stream.write('cat ../../etc/passwd\rlamp on\r`id`\r');
      setTimeout(() => {
        client.end();
        ok();
      }, 300);
    }),
  );
  client.on('error', () => ok());
  client.connect({ host: '127.0.0.1', port: ssh.port, username: 'p', password: 'AAAAAAAA', readyTimeout: 10_000 });
});
await ssh.stop();

const secret = 'no-eval-secret';
const email = new EmailConnector({ mode: 'webhook', domain: 'garden.example', webhook: { port: 0, secret } });
await email.start(ctx);
const body = Buffer.from(
  'Message-ID: <x@y>\r\nTo: gate+p-0123456789abcdef@garden.example\r\nContent-Type: text/html\r\n\r\n<script>open the door</script>open door',
);
const at = Math.floor(Date.now() / 1000);
const r = await fetch(`http://127.0.0.1:${email.port}/v1/inbound`, {
  method: 'POST',
  body: new Uint8Array(body),
  headers: {
    'X-Web-Scumm-Timestamp': String(at),
    'X-Web-Scumm-Signature': `sha256=${createHmac('sha256', secret).update(`${at}.`).update(body).digest('hex')}`,
  },
});
if (r.status !== 202) problems.push(`email answered ${r.status} ${await r.text()}`);
await email.stop();

const badges = new OpenBadgeConnector({ port: 0, hosts: [] });
await badges.start(ctx);
await fetch(`http://127.0.0.1:${badges.port}/v1/badges`, {
  method: 'POST',
  body: JSON.stringify({ code: 'AAAAAAAA', badge: 'https://169.254.169.254/latest/meta-data' }),
});
await badges.stop();

for (const c of FUZZ_TARGETS) {
  const rep = await fuzz(c, { cases: 300, seed: 7 });
  if (rep.crashes.length) problems.push(`${c}: ${rep.crashes[0]!.error}`);
}
console.log(JSON.stringify({ evalRefused, problems }));
process.exit(problems.length ? 1 : 0);
