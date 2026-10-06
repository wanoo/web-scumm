// Looping prop animations honour `at` for sounds and shakes; the validator refuses anything else there.
import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core/engine';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import { validate } from '@engine/tools/validate';
import { mini, miniLayouts } from './fixtures/mini';

describe('loop frame events', () => {
  it('reach the presenter, and only play sounds', async () => {
    const g = mini();
    g.audio = { sfx: { clank: 'clank.mp3' } };
    g.rooms[0].props!.valise.anims = {
      run: { frames: ['o/v1', 'o/v2'], fps: 4, loop: true, at: { 1: [{ sfx: 'clank' }] } },
    };
    expect(validate(g, miniLayouts).errors).toEqual([]);
    const ui = new FakePresenter();
    const e = new Engine(g, miniLayouts, ui, new MemoryStore());
    await e.newGame();
    await e.script([{ play: ['valise', 'run'] }]);
    expect(ui.log).toContain('loop valise 2 +at');
    g.rooms[0].props!.valise.anims!.run.at = { 1: [{ set: 'clanked' }] };
    expect(validate(g, miniLayouts).errors.some((x) => /looping animation only plays sounds/.test(x))).toBe(true);
  });
});
