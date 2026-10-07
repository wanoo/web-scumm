// npm run e2e:reality -- <url of the built signals game> [--browser=chromium|webkit] (4.1.1): the scenario of
// docs/dev/PLAN-4.1-REALITY-BRIDGE.md §13 on the production build of games/signals and a real reference Bridge:
// pair the game from its pause menu, close the browser, receive the same webhook twice, reopen the game offline, come
// back online, apply the signal once, save, export the session, stop the Bridge, replay the session to the same end.
// Starts its own Bridge (npm run bridge, GAME=signals) on 127.0.0.1:8787, the URL the game declares. 4.1.9: two
// connectors send one key three times each (one effect), and the sample chapter's recorded replays are proposed.
// Exit 3: WebKit could not reopen offline (not automatable, as in e2e:pwa); `--allow-skip` accepts it with an
// explicit line.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { chromium, webkit } from 'playwright';

const url = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5176/';
const isWebkit = process.argv.find((a) => a.startsWith('--browser='))?.split('=')[1] === 'webkit';
const allowSkip = process.argv.includes('--allow-skip');
const BRIDGE = 'http://127.0.0.1:8787/';
let failed = 0;
const say = (ok, msg) => {
  if (!ok) failed++;
  console.log(`  ${ok ? '✔' : '✖'} ${msg}`);
};
const env = { ...process.env, GAME: 'signals' };
const dir = mkdtempSync(join(tmpdir(), 'e2e-reality-'));
execFileSync('npm', ['run', '--silent', 'bridge', '--', 'init', `--dir=${dir}`, `--origin=${new URL(url).origin}`], {
  env,
  stdio: 'inherit',
});
const config = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
const bridge = spawn('npm', ['run', '--silent', 'bridge', '--', 'serve', `--dir=${dir}`], {
  env,
  stdio: ['ignore', 'pipe', 'inherit'],
  detached: true,
});
const stopBridge = () => {
  try {
    process.kill(-bridge.pid, 'SIGTERM');
  } catch {
    /* already stopped */
  }
};
process.on('exit', stopBridge);
await new Promise((ok, ko) => {
  const t = setTimeout(() => ko(new Error('the Bridge did not start')), 30000);
  bridge.stdout.on('data', (d) => {
    if (String(d).includes('bridge.listening')) {
      clearTimeout(t);
      ok();
    }
  });
});
const hook = async (event, id, playerId) => {
  const body = JSON.stringify({ playerId, event, id });
  const sig = `sha256=${createHmac('sha256', config.webhooks.mail.secret).update(body).digest('hex')}`;
  const r = await fetch(new URL('v1/hooks/mail', BRIDGE), {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json', 'X-Web-Scumm-Signature': sig },
  });
  return r.status;
};

console.log(`Reality Bridge, end to end (${isWebkit ? 'WebKit' : 'Chromium'}):`);
const browser = await (isWebkit ? webkit : chromium).launch();
const context = await browser.newContext({ viewport: { width: 932, height: 430 } });
const open = async () => {
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`  page error: ${e.message}`));
  await page.goto(url);
  await page.waitForFunction(() => !!window.__game?.engine, null, { timeout: 30000 });
  return page;
};
let page = await open();
// The first visit installs the service worker and caches the whole game (offline: 'full').
await page
  .waitForFunction(
    () => navigator.serviceWorker?.controller || window.__game.offlineStatus?.state === 'complete',
    null,
    { timeout: 60000 },
  )
  .catch(() => {});
await page.locator('.overlay .bigbtn').first().click();
await page.waitForFunction(
  () => !!window.__game.engine.state && !window.__game.engine.busy && !!window.__game.reality,
  null,
  { timeout: 30000 },
);

// 1. Pair from the pause menu: the code shown is the one a connector confirms (once the arrival line is over).
// Idle: no line on screen and the engine free, twice a second apart (the arrival line starts a moment after the room).
const idle = async (p) => {
  for (let calm = 0; calm < 2; ) {
    const quiet = await p.evaluate(() => !window.__game.engine.busy && !document.querySelector('.speech'));
    calm = quiet ? calm + 1 : 0;
    await p.waitForTimeout(600);
  }
};
await idle(page);
await page.evaluate(() => window.__game.pauseMenu());
// Through the keyboard, as a player without a pointer does (the menu traps the focus).
await page.locator('.menu button', { hasText: 'not linked' }).press('Enter');
await page.locator('.menu button', { hasText: 'Link this game' }).press('Enter');
await page.waitForFunction(
  () => /[A-Z0-9]{8}/.test(document.querySelector('.reality-status')?.textContent ?? ''),
  null,
  { timeout: 15000 },
);
const code = (await page.locator('.reality-status').textContent()).match(/[A-Z0-9]{8}/)[0];
const confirm = await fetch(new URL(`v1/pairings/${code}/confirm`, BRIDGE), {
  method: 'POST',
  headers: { Authorization: `Bearer ${config.webhooks.mail.token}` },
});
const { playerId } = await confirm.json();
await page.waitForFunction(() => window.__game.reality?.status === 'open', null, { timeout: 30000 });
say(true, `paired from the pause menu with code ${code.slice(0, 2)}…, the link open`);
say(
  !(await page.evaluate(() => JSON.stringify(window.__game.engine.session)).then((s) => s.includes('capability'))),
  'no capability in the session',
);

// 2. The browser is closed; the world answers, twice.
await page.close();
const first = await hook('answer.correct', 'delivery-1', playerId);
const second = await hook('answer.correct', 'delivery-1', playerId);
say(first === 202 && second === 200, `the same webhook twice: accepted, then recognised (${first}, ${second})`);

// 3. Reopened offline: the game starts from its cache, the link waits.
await context.setOffline(true);
page = await context.newPage();
await page.goto(url).catch(() => {});
let started = await page
  .waitForFunction(() => !!window.__game?.engine, null, { timeout: 30000 })
  .then(
    () => true,
    () => false,
  );
let skipped = false;
if (!started && isWebkit) {
  // WebKit under automation cannot navigate offline even with the worker installed (as npm run e2e:pwa reports): the
  // offline reopening is proven on Chromium; here the game reopens online and the rest of the scenario runs.
  skipped = true;
  console.log(
    `  ⚠ SKIPPED on WebKit: reopening offline is not automatable on this engine${allowSkip ? ' (accepted by --allow-skip)' : ''}`,
  );
  await context.setOffline(false);
  await page.close();
  page = await open();
  started = true;
} else say(started, 'reopened offline, from the cache');
if (started) {
  // Continue the saved game (the first big button is a new one).
  await page.locator('.overlay .bigbtn', { hasText: 'CONTINUE' }).click();
  await page.waitForFunction(() => !!window.__game.engine.state && !window.__game.engine.busy, null, {
    timeout: 30000,
  });
  await idle(page);
  if (!skipped)
    say(!(await page.evaluate(() => window.__game.engine.state.flags.gate_open)), 'offline: the gate still waits');

  // 4. Online again: delivered, verified, applied once, saved, acknowledged.
  await context.setOffline(false);
  const applied = await page
    .waitForFunction(() => window.__game.engine.state.reality?.cursor === 1 && !window.__game.engine.busy, null, {
      timeout: 90000,
    })
    .then(
      () => true,
      () => false,
    );
  say(applied, 'online again: the signal arrived and the cursor moved');
  say(await page.evaluate(() => window.__game.engine.state.flags.gate_open === true), 'the gate opened');
  const externals = await page.evaluate(
    () => (window.__game.engine.session?.log ?? []).filter((e) => e.external).length,
  );
  say(externals === 1, `applied once (${externals} signal entry in the session)`);
  say(
    (await hook('answer.correct', 'delivery-1', playerId)) === 200,
    'a third delivery of the same webhook: a duplicate',
  );

  // 4b. (4.1.9, D19) Two connectors of one source (Telnet and SSH both propose `terminal.lamp`) send the same key three
  // times each: one sequence, one logical effect in the game. One token is the demonstration one of the `terminal`
  // source, the other minted by `grant`, as an operator gives each connector its own.
  const minted = execFileSync(
    'npm',
    [
      'run',
      '--silent',
      'bridge',
      '--',
      'grant',
      `--dir=${dir}`,
      '--connector=ssh',
      '--source=terminal',
      '--signals=terminal.lamp',
    ],
    { env, encoding: 'utf8' },
  ).trim();
  const propose = async (token, signal, source, dedupeKey) =>
    (
      await fetch(new URL('v1/signals', BRIDGE), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, signal, source, dedupeKey }),
      })
    ).status;
  const statuses = [];
  for (let i = 0; i < 3; i++)
    for (const token of [config.webhooks.terminal.token, minted])
      statuses.push(await propose(token, 'terminal.lamp', 'terminal', 'e2e:lamp:1'));
  say(
    statuses.filter((x) => x === 202).length === 1 && statuses.filter((x) => x === 200).length === 5,
    `one key from two connectors, three times each: accepted once (${statuses.join(' ')})`,
  );
  const lit = await page
    .waitForFunction(() => window.__game.engine.state.flags.lamp_on === true && !window.__game.engine.busy, null, {
      timeout: 60000,
    })
    .then(
      () => true,
      () => false,
    );
  const entries = await page.evaluate(() => (window.__game.engine.session?.log ?? []).filter((e) => e.external).length);
  say(lit && entries === 2, `the lamp lit, applied once (${entries} signal entries in the session)`);

  // 4c. (4.1.9) The sample chapter's recorded replays, their signals proposed as their connectors made them (the email
  // source's token for a letter, the terminal's for a command): accepted, and the game shows their effect.
  const tokenOf = { email: config.webhooks.email.token, terminal: config.webhooks.terminal.token };
  const sourceOf = (signal) => (signal.startsWith('letter.') ? 'email' : 'terminal');
  let proposed = 0;
  for (const f of readdirSync(new URL('../games/signals/replays/', import.meta.url)).filter((x) =>
    x.endsWith('.json'),
  )) {
    const replay = JSON.parse(readFileSync(new URL(`../games/signals/replays/${f}`, import.meta.url), 'utf8'));
    for (const [i, signal] of replay.signals.entries()) {
      const status = await propose(tokenOf[sourceOf(signal)], signal, sourceOf(signal), `e2e:replay:${f}:${i}`);
      if (status === 202) proposed++;
    }
  }
  const opened = await page
    .waitForFunction(() => window.__game.engine.state.flags.shed_open === true && !window.__game.engine.busy, null, {
      timeout: 60000,
    })
    .then(
      () => true,
      () => false,
    );
  say(proposed > 0 && opened, `the recorded replays proposed (${proposed} signals) and the shed door open in the game`);
  await page.evaluate(async () => {
    await window.__game.engine.act({ verb: 'use', a: 'gate' });
  });
  await page
    .waitForFunction(() => window.__game.engine.state.done || window.__game.engine.state.flags.ended, null, {
      timeout: 30000,
    })
    .catch(() => {});
  const ended = await page.evaluate(() => !!window.__game.engine.state.flags.ended);
  say(ended, 'the game reaches its end');
  // Every signal acknowledged: the first, the lamp, and the replays' (4.1.9); the player acknowledges after its save.
  const expected = 2 + proposed;
  let acked = { acked: 0 };
  for (let i = 0; i < 60 && acked.acked !== expected; i++) {
    acked = await (
      await fetch(new URL(`v1/admin/players/${playerId}`, BRIDGE), {
        headers: { Authorization: `Bearer ${readFileSync(join(dir, 'admin-token'), 'utf8').trim()}` },
      })
    ).json();
    if (acked.acked !== expected) await new Promise((r) => setTimeout(r, 500));
  }
  say(acked.acked === expected, `the Bridge holds the acknowledgements (${acked.acked} of ${expected})`);

  // 5. The session exported, the Bridge stopped, the session replayed offline to the same end.
  const session = await page.evaluate(() => ({
    kind: 'web-scumm-session',
    game: window.__game.game.id,
    v: window.__game.game.saveVersion,
    at: Date.now(),
    session: window.__game.engine.session,
    trace: [],
  }));
  const file = join(dir, 'session.json');
  writeFileSync(file, JSON.stringify(session));
  say(
    !readFileSync(file, 'utf8').includes(config.webhooks.mail.token.slice(0, 20)),
    'no token in the exported session',
  );
  stopBridge();
  let replayed = false;
  try {
    execFileSync('npm', ['run', '--silent', 'replay', '--', file], { env, stdio: 'pipe' });
    replayed = true;
  } catch (e) {
    console.log(String(e.stdout ?? '').slice(-600));
  }
  say(replayed, 'the Bridge stopped, the session replays to the same end');
}
await browser.close();
stopBridge();
console.log(
  failed
    ? `✖  e2e:reality: ${failed} check(s) failed`
    : `✔  e2e:reality: every check passes${skipped ? ' (offline reopening skipped)' : ''}`,
);
process.exit(failed ? 1 : skipped && !allowSkip ? 3 : 0);
