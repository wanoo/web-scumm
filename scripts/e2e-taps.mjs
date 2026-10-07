// npm run e2e:taps -- <url> [--browser=chromium|webkit] (4.0): the default verb in the browser, on the reference
// chapter (GAME=reference). A double tap on an exit goes through it, on a character talks to it; an item picked from
// the bag without a verb is given to a character and used on anything else. Each action is read back from the
// engine's session, the way the player's input was recorded.
import { chromium, webkit } from 'playwright';

const url = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5175/';
const engine = process.argv.find((a) => a.startsWith('--browser='))?.split('=')[1] === 'webkit' ? webkit : chromium;
let failed = 0;
const say = (ok, msg) => {
  if (!ok) failed++;
  console.log(`  ${ok ? '✔' : '✖'} ${msg}`);
};

const browser = await engine.launch();
const page = await (await browser.newContext({ viewport: { width: 932, height: 430 }, hasTouch: false })).newPage();
await page.goto(url);
await page.waitForFunction(() => !!window.__game?.engine, null, { timeout: 20000 });
await page.locator('.overlay .bigbtn').first().click();
await page.waitForFunction(() => !!window.__game.engine.state && !window.__game.engine.busy, null, { timeout: 20000 });
const last = () =>
  page.evaluate(() => {
    const l = window.__game.engine.session?.log ?? [];
    for (let i = l.length - 1; i >= 0; i--) if (l[i].act) return l[i].act;
    return null;
  });
const idle = () =>
  page
    .waitForFunction(() => !window.__game.engine.busy && !document.querySelector('.speech'), null, { timeout: 30000 })
    .catch(() => {});
// Taps on the scene where the target is (its keyboard button marks the place), as a player does.
const at = async (id) => {
  const b = await page.locator(`.a11y-target[data-target="${id}"]`).first().boundingBox();
  return [b.x + b.width / 2, b.y + b.height / 2];
};
const target = (id) => ({
  click: async () => {
    const [x, y] = await at(id);
    await page.mouse.click(x, y);
  },
  dblclick: async () => {
    const [x, y] = await at(id);
    await page.mouse.dblclick(x, y);
  },
});
const go = async (room) => {
  await page.evaluate((r) => window.__game.engine.teleport(r), room);
  await idle();
};

console.log(`default verbs (${engine === webkit ? 'WebKit' : 'Chromium'}):`);
await go('street');
await target('hall_door').dblclick();
await page.waitForFunction(() => window.__game.engine.state.room === 'hall', null, { timeout: 15000 }).catch(() => {});
say(
  (await page.evaluate(() => window.__game.engine.state.room)) === 'hall',
  `a double tap on the door goes through it (${JSON.stringify(await last())})`,
);
await idle();
await target('neighbor').dblclick();
await page
  .waitForFunction(() => !!document.querySelector('.side .choices .choice'), null, { timeout: 15000 })
  .catch(() => {});
const talk = await last();
say(talk?.verb === 'talk' && talk.a === 'neighbor', `a double tap on Lou talks to him (${JSON.stringify(talk)})`);
// Leave the conversation (its last choice says goodbye), then an item from the bag on Lou and on the map.
for (let k = 0; k < 10 && (await page.locator('.side .choices .choice').count()); k++) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await idle();
}
await page.evaluate(() => {
  const g = window.__game;
  g.engine.state.inventory.push('cable');
  g.presenter.inventory(g.engine.state.inventory);
});
const slot = page
  .locator(`.slot[aria-label="${await page.evaluate(() => window.__game.engine.game.items.cable.name)}"]`)
  .first();
await slot.click();
await target('neighbor').click();
await idle();
const give = await last();
say(
  give?.verb === 'give' && give.a === 'cable' && give.b === 'neighbor',
  `an item picked from the bag, then Lou: given (${JSON.stringify(give)})`,
);
await page.evaluate(() => {
  const g = window.__game;
  if (!g.engine.state.inventory.includes('cable')) g.engine.state.inventory.push('cable');
  g.presenter.inventory(g.engine.state.inventory);
});
await slot.click();
await target('map').click();
await idle();
const use = await last();
say(
  use?.verb === 'use' && use.a === 'cable' && use.b === 'map',
  `an item picked from the bag, then the map: used (${JSON.stringify(use)})`,
);
// A single tap still only walks.
const before = JSON.stringify(await last());
await target('map').click();
await idle();
say(JSON.stringify(await last()) === before, 'a single tap on the map walks, it does not act');
await browser.close();
console.log(`${failed ? '✖' : '✔'}  default verbs: ${failed ? `${failed} check(s) failed` : 'every check passes'}`);
process.exit(failed ? 1 : 0);
