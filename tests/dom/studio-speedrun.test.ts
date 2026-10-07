// @vitest-environment happy-dom
// The Studio Play tab's speedrun panel (4.1.14 "Time Attack"): a game's categories with their rules, the splits with
// an editor (a name changed, a trigger changed, a split added, the manifest written back), a preview of the splits on
// the session played in the frame, routes exported and compared (the solver's witness as a logical route, never a
// record).
import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core/engine';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import type { SpeedrunManifest } from '@engine/core/types';
import { solve } from '@engine/tools/solve';
import { routeFromRun, routeFromWitness } from '@engine/tools/speedrun/routes';
import { SpeedrunPanel, type SpeedrunFrame } from '../../src/studio/speedrun-panel';
import { ROUTE, speedrunGame, speedrunLayouts } from '../fixtures/speedrun-game';

async function frame(): Promise<SpeedrunFrame> {
  const game = speedrunGame();
  const engine = new Engine(game, speedrunLayouts, new FakePresenter(), new MemoryStore());
  await engine.newGame();
  for (const a of ROUTE) await engine.act({ ...a });
  return { engine, game, layouts: speedrunLayouts, speedrun: null };
}

describe('the speedrun panel', () => {
  it('lists the categories with their rules and the splits with their triggers; hidden for a game without speedrun', async () => {
    const f = await frame();
    const p = new SpeedrunPanel(() => f);
    p.refresh();
    expect(p.el.hidden).toBe(false);
    const options = [...p.el.querySelectorAll('select[aria-label="category"] option')].map((o) => o.textContent);
    expect(options).toEqual(['Any%', 'No Hints', 'Fixed Seed', 'Real Time']);
    expect(p.el.querySelector('.rules')?.textContent).toContain('timed on igt');
    expect(p.el.querySelectorAll('tr.split')).toHaveLength(4);
    expect(p.el.textContent).toContain('itemAcquired (item=key)');
    const none = new SpeedrunPanel(() => ({ ...f, game: { ...f.game, speedrun: undefined } }));
    none.refresh();
    expect(none.el.hidden).toBe(true);
  });

  it('edits splits and writes the manifest back', async () => {
    const f = await frame();
    let written: SpeedrunManifest | null = null;
    const p = new SpeedrunPanel(() => f, {
      write: async (m) => {
        written = m;
      },
    });
    p.refresh();
    const name = p.el.querySelector('input[aria-label="name of key"]') as HTMLInputElement;
    name.value = 'The key';
    name.dispatchEvent(new Event('input'));
    p.addSplit();
    expect(p.manifest!.splits.map((s) => s.name)).toEqual(['The key', 'Found it', 'Vault', 'Gem', 'Split 5']);
    (
      [...p.el.querySelectorAll('button')].find((b) => b.textContent === 'Write to the game') as HTMLButtonElement
    ).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(written!.splits).toHaveLength(5);
    expect(f.game.speedrun!.splits).toHaveLength(4); // the frame's game is untouched until it reloads
  });

  it('previews the splits on the frame’s session, as a run would record them', async () => {
    const f = await frame();
    const p = new SpeedrunPanel(() => f);
    p.refresh();
    await p.runPreview();
    expect(p.preview!.splits.every((s) => s.entry !== null)).toBe(true);
    expect(p.preview!.finish).not.toBeNull();
    expect(
      [...p.el.querySelectorAll('tr.split td.time')].every((td) => /\d:\d\d\.\d{3}/.test(td.textContent ?? '')),
    ).toBe(true);
  });

  it('compares a logical route with a human one, and says the logical one is never a record', async () => {
    const f = await frame();
    const p = new SpeedrunPanel(() => f);
    p.refresh();
    const s = await solve(speedrunGame(), speedrunLayouts, { maxStates: 5000 });
    p.addRoute(routeFromWitness('vault', s.steps));
    p.addRoute(routeFromRun({ gameId: 'vault', name: 'Mine', steps: f.engine.session!.log }));
    expect(p.el.querySelector('.compare')?.textContent).toMatch(/Solver route \(logical\) vs Mine \(human\)/);
    expect(p.el.textContent).toContain('never a record');
  });
});
