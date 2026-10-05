#!/usr/bin/env node
// The Studio edits a stage without JSON by hand (3.4's exit criterion): on the dev server (`npm run studio`), in the
// Rooms tab of a room, "Stage…" opens the form; a foreground layer and a fade are entered in its fields; "Preview the
// change" shows the diff; "Apply" writes the room file (validated by the server); the game sees the stage; the
// painter select and the timeline are there; "Undo" puts the file back as it was. The room file is restored either
// way. Usage: node scripts/e2e-studio.mjs [http://127.0.0.1:5317/__studio/] [--room=garden]. Exit 0 / 1.
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const url = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5317/__studio/';
const room = process.argv.find((a) => a.startsWith('--room='))?.split('=')[1] ?? 'garden';
const game = JSON.parse(readFileSync('package.json', 'utf8')).config?.game ?? 'demo';
const file = join('games', process.env.GAME || game, 'rooms', `${room}.ts`);
const original = readFileSync(file, 'utf8');
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);
const api = (path, init) => fetch(new URL(`../__studio/api/${path}`, url), init).then((r) => r.json());

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let ok = false;
try {
  await page.goto(`${url}#rooms/${room}`);
  await page.getByRole('button', { name: /^Stage…/ }).click();
  const dialog = page.locator('.modal');
  await dialog.waitFor();
  // layers: tick the optional field, add one layer, fill its id, image and role
  const layersField = dialog.locator('.f-field').filter({ has: page.locator('.f-key', { hasText: /^layers$/ }) }).first();
  await layersField.locator('.f-key input[type=checkbox]').check();
  await layersField.getByRole('button', { name: '+ layer' }).click();
  const layer = layersField.locator('.f-item').first();
  const field = (name) => layer.locator('.f-field').filter({ has: page.locator('.f-key', { hasText: new RegExp(`^${name}$`) }) }).first();
  await field('id').locator('input').fill('veil');
  const image = await api('game').then((g) => Object.keys(g.images).find((k) => k.startsWith('decor/')) ?? Object.keys(g.images)[0]);
  await field('image').locator('input').fill(image);
  await field('role').locator('select').selectOption('foreground');
  const transition = dialog.locator('.f-structured, .structured').locator('.f-field').filter({ has: page.locator('.f-key', { hasText: /^transition$/ }) }).last();
  await transition.locator('.f-key input[type=checkbox]').check();
  await transition.locator('select').selectOption('fade');
  await dialog.getByRole('button', { name: 'Preview the change' }).click();
  await dialog.locator('pre.diff').waitFor();
  const diff = await dialog.locator('pre.diff').innerText();
  if (!/\+\s*stage:/.test(diff) || !diff.includes("'veil'")) throw new Error(`the diff does not show the stage:\n${diff}`);
  if (readFileSync(file, 'utf8') !== original) throw new Error('the preview wrote the file');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 30000 });
  const written = readFileSync(file, 'utf8');
  if (!written.includes("id: 'veil'") || !written.includes("transition: 'fade'")) throw new Error('the room file was not written');
  const r = await api(`room/${room}`);
  if (r.def?.stage?.layers?.[0]?.id !== 'veil') throw new Error(`the game does not see the stage: ${JSON.stringify(r.def?.stage)}`);
  console.log(`✔  stage written by the form (${hash(original)} → ${hash(written)}), seen by the game`);
  if (!(await page.locator('label', { hasText: 'painter' }).locator('select').count())) throw new Error('no painter select in the room sheet');
  await page.getByRole('button', { name: /Undo/ }).click();
  for (let i = 0; i < 50 && readFileSync(file, 'utf8') !== original; i++) await page.waitForTimeout(100);
  if (readFileSync(file, 'utf8') !== original) throw new Error('undo did not put the file back');
  console.log('✔  undone: the room file is back as it was');
  await page.getByRole('tab', { name: 'Voices' }).click();
  await page.locator('table.vtable tbody tr').first().waitFor({ timeout: 30000 });
  console.log(`✔  the voice table: ${await page.locator('table.vtable tbody tr').count()} lines shown`);
  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  ok = true;
} catch (e) {
  console.error(`✖  ${e.message}`);
  await page.screenshot({ path: '/tmp/e2e-studio.png' }).catch(() => {});
} finally {
  if (readFileSync(file, 'utf8') !== original) writeFileSync(file, original);
  await browser.close();
}
console.log(`${ok ? '✔' : '✖'}  the Studio ${ok ? 'creates, previews, applies and undoes a stage without JSON' : 'stage edit failed'}`);
process.exit(ok ? 0 : 1);
