// One driver per connector (4.1.9), so the SDK's contract runs the same on all four (tests/connectors-sdk.test.ts):
// start it on port 0, deliver one valid input for a pairing code (as a player would: an email, a line typed over
// Telnet or SSH, a badge posted), send one input over its limits, and name the strings its log must never hold.
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import ssh2 from 'ssh2';
import { OpenBadgeConnector } from '../../../connectors/src/badges/connector';
import type { Fetched } from '../../../connectors/src/badges/fetch';
import { BadgeVerifier } from '../../../connectors/src/badges/verify';
import { EmailConnector } from '../../../connectors/src/email/connector';
import type { ConnectorContext, RealityConnector } from '../../../connectors/src/sdk';
import { SshConnector } from '../../../connectors/src/ssh/connector';
import { TelnetConnector } from '../../../connectors/src/telnet/connector';
import type { badgeFixtures } from './badges';
import { sshKeyPair, type TestBridge } from './harness';

export interface Driver {
  id: 'email' | 'telnet' | 'ssh' | 'open-badge';
  start(ctx: ConnectorContext): Promise<RealityConnector & { port: number }>;
  /** One valid input for a fresh code (`n` makes it a different input); resolves with the player once handled. */
  deliver(t: TestBridge, c: { port: number }, n: number): Promise<string>;
  /** An input over the connector's limits: refused, the connector still up. Resolves with what the sender saw. */
  oversize(c: { port: number }): Promise<string>;
  /** Never in a log line. */
  secrets: string[];
}

const claim = async (t: TestBridge, code: string) =>
  ((await (await fetch(new URL(`v1/pairings/${code}`, t.url))).json()) as { playerId: string }).playerId;

const SECRET = 'driver-webhook-secret';
const eml = (name: string, vars: Record<string, string>) =>
  Buffer.from(
    readFileSync(`connectors/test-vectors/email/${name}`, 'utf8').replace(
      /\{\{(\w+)\}\}/g,
      (_m, k: string) => vars[k] ?? '',
    ),
  );
const postEmail = (port: number, body: Buffer) => {
  const at = Math.floor(Date.now() / 1000);
  return fetch(`http://127.0.0.1:${port}/v1/inbound`, {
    method: 'POST',
    body: new Uint8Array(body),
    headers: {
      'X-Web-Scumm-Timestamp': String(at),
      'X-Web-Scumm-Signature': `sha256=${createHmac('sha256', SECRET).update(`${at}.`).update(body).digest('hex')}`,
    },
  });
};

/** Reads a socket's or a stream's text until `re` matches. */
function reader(on: (cb: (d: Buffer) => void) => void) {
  let buf = '';
  on((d) => {
    buf += d.toString('utf8');
  });
  return async (re: RegExp, ms = 8000) => {
    const t0 = Date.now();
    while (!re.test(buf)) {
      if (Date.now() - t0 > ms) throw new Error(`timed out on ${re}: ${JSON.stringify(buf.slice(-300))}`);
      await new Promise((r) => setTimeout(r, 10));
    }
    return buf;
  };
}

/** The prompt after the lamp's answer: the proposal is done (accepted or refused) by then. */
const AFTER_LAMP = /glows\.( Somebody[^\r]*)?\r\n(\(the world did not answer: [\w-]+\)\r\n)?shed[>$] $/;

export function drivers(fixtures: ReturnType<typeof badgeFixtures>): Driver[] {
  const docs = async (url: string): Promise<Fetched> => {
    const d = fixtures.documents[url];
    return d === undefined
      ? { ok: false, status: 404, reason: 'status 404' }
      : { ok: true, status: 200, url, text: JSON.stringify(d), json: d };
  };
  return [
    {
      id: 'email',
      async start(ctx) {
        const c = new EmailConnector({
          mode: 'webhook',
          domain: 'garden.example',
          webhook: { port: 0, secret: SECRET },
        });
        await c.start(ctx);
        return c;
      },
      async deliver(t, c, n) {
        const code = await t.code();
        await postEmail(c.port, Buffer.from(eml('pairing.eml', { code }).toString().replace('<m09@', `<m09-${n}@`)));
        const playerId = await claim(t, code);
        await postEmail(
          c.port,
          Buffer.from(eml('plain-open-door.eml', { player: playerId }).toString().replace('<m01@', `<m01-${n}@`)),
        );
        return playerId;
      },
      async oversize(c) {
        return String((await postEmail(c.port, Buffer.alloc(300 * 1024, 0x61))).status);
      },
      secrets: [SECRET, 'robin@player.example', 'please open the door', 'garden.example'],
    },
    {
      id: 'telnet',
      async start(ctx) {
        const c = new TelnetConnector({ port: 0 });
        await c.start(ctx);
        return c;
      },
      async deliver(t, c) {
        const code = await t.code();
        const s = connect(c.port, '127.0.0.1');
        s.on('error', () => {});
        const until = reader((cb) => s.on('data', cb));
        await until(/Pairing code: $/);
        s.write(`${code}\r\n`);
        await until(/shed> $/);
        s.write('lamp on\r\n');
        await until(AFTER_LAMP);
        s.end();
        return claim(t, code);
      },
      async oversize(c) {
        const s = connect(c.port, '127.0.0.1');
        s.on('error', () => {});
        const until = reader((cb) => s.on('data', cb));
        s.write(`${'q'.repeat(600)}\r\n`);
        const out = await until(/Line too long/);
        s.end();
        return out;
      },
      secrets: ['lamp on', 'Mind the spiders'],
    },
    {
      id: 'ssh',
      async start(ctx) {
        const c = new SshConnector({ port: 0, hostKey: sshKeyPair().private });
        await c.start(ctx);
        return c;
      },
      async deliver(t, c) {
        const code = await t.code();
        const client = new ssh2.Client();
        await new Promise<void>((ok, ko) => {
          client.on('ready', () => ok());
          client.on('error', ko);
          client.connect({ host: '127.0.0.1', port: c.port, username: 'p', password: code, readyTimeout: 10_000 });
        });
        await new Promise<void>((ok, ko) =>
          client.shell({ cols: 80, rows: 24 }, (err, stream) => {
            if (err) return ko(err);
            const until = reader((cb) => stream.on('data', cb));
            void (async () => {
              await until(/shed\$ $/);
              stream.write('lamp on\r');
              await until(AFTER_LAMP);
              client.end();
              ok();
            })().catch(ko);
          }),
        );
        return claim(t, code);
      },
      async oversize(c) {
        const client = new ssh2.Client();
        const code = 'AAAAAAAA';
        const r = await new Promise<string>((ok) => {
          client.on('ready', () => ok('in'));
          client.on('error', (e: Error) => ok(e.message));
          client.connect({
            host: '127.0.0.1',
            port: c.port,
            username: 'p',
            password: `${code}${'x'.repeat(100)}`,
            readyTimeout: 10_000,
          });
        });
        client.end();
        return r;
      },
      secrets: ['lamp on', 'Same spiders', 'BEGIN OPENSSH PRIVATE KEY'],
    },
    {
      id: 'open-badge',
      async start(ctx) {
        const c = new OpenBadgeConnector({ port: 0 });
        await c.start(ctx);
        (c as unknown as { verifier: BadgeVerifier }).verifier = new BadgeVerifier({
          issuers: ['https://badges.example.org/issuer'],
          fetch: docs,
        });
        return c;
      },
      async deliver(t, c) {
        const code = await t.code();
        await fetch(`http://127.0.0.1:${c.port}/v1/badges`, {
          method: 'POST',
          body: JSON.stringify({
            code,
            badge: fixtures.cases['ob2-hosted-valid']!.submission.badge,
            email: 'robin@player.example',
          }),
        });
        return claim(t, code);
      },
      async oversize(c) {
        return String(
          (await fetch(`http://127.0.0.1:${c.port}/v1/badges`, { method: 'POST', body: 'x'.repeat(70_000) })).status,
        );
      },
      secrets: ['robin@player.example', 'badges.example.org', 'ob2-hosted-valid'],
    },
  ];
}
