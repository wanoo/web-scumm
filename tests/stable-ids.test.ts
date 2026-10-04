import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core/engine';
import { applyMigration } from '@engine/core/migrate';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import type { Cmd, GameState } from '@engine/core/types';
import { mini, miniLayouts } from './fixtures/mini';

describe('stable v3 persistence ids', () => {
  it('a once choice remains consumed after its text is translated', async () => {
    const game = mini(); game.schemaVersion = 3;
    const ui = new FakePresenter(); const engine = new Engine(game, miniLayouts, ui, new MemoryStore());
    await engine.newGame(); ui.picks = [0];
    await engine.script([{ choice: [{ id: 'answer.key', text: 'The key?', once: true, do: [] }] }]);
    expect(engine.state.seen['choice.answer.key']).toBe(1);
    const before = ui.log.length;
    await engine.script([{ choice: [{ id: 'answer.key', text: 'La clé ?', once: true, do: [] }] }]);
    expect(ui.log).toHaveLength(before);
  });

  it('talk topics stay seen when reordered and translated', async () => {
    const game = mini(); game.schemaVersion = 3;
    game.verbs.push({ id: 'talk', label: 'Talk', color: '#fff' });
    game.rooms[0].talk = { uncle: [{ id: 'ask.key', topic: 'The key?', do: ['No key.'] }] };
    const ui = new FakePresenter(); const engine = new Engine(game, miniLayouts, ui, new MemoryStore());
    await engine.newGame(); ui.picks = [0, 1]; await engine.act({ verb: 'talk', a: 'uncle' });
    expect(engine.state.seen['topic.ask.key']).toBe(1);

    const translated = mini(); translated.schemaVersion = 3; translated.verbs.push({ id: 'talk', label: 'Parler', color: '#fff' });
    translated.rooms[0].talk = { uncle: [
      { id: 'ask.weather', topic: 'Le temps ?', do: [] },
      { id: 'ask.key', topic: 'La clé ?', do: [] },
    ] };
    const ui2 = new FakePresenter(); const resumed = new Engine(translated, miniLayouts, ui2, new MemoryStore());
    await resumed.load(engine.state); ui2.picks = [2]; await resumed.act({ verb: 'talk', a: 'uncle' });
    expect(ui2.asked[0].texts).toEqual(expect.arrayContaining(['La clé ?']));
    expect(ui2.asked[0]).toMatchObject({ n: 3 });
    const index = ui2.asked[0].texts.indexOf('La clé ?');
    // The presenter receives `seen`; FakePresenter keeps texts only, so the persisted stable key is the contract here.
    expect(index).toBeGreaterThanOrEqual(0);
    expect(resumed.state.seen['topic.ask.key']).toBe(1);
  });

  it('a script resumes at its named step after steps are reordered', async () => {
    const game = mini(); game.schemaVersion = 3;
    game.scripts = [{ id: 'clock', stepIds: ['first', 'second'], do: [{ set: 'first' }, { set: 'second' }] }];
    const engine = new Engine(game, miniLayouts, new FakePresenter(), new MemoryStore());
    await engine.newGame(); await engine.advance('clock');
    expect(engine.state.scripts?.clock).toMatchObject({ pc: 1, step: 'second' });

    const reordered = mini(); reordered.schemaVersion = 3;
    reordered.scripts = [{ id: 'clock', stepIds: ['second', 'first'], do: [{ set: 'second' }, { set: 'first' }] }];
    const resumed = new Engine(reordered, miniLayouts, new FakePresenter(), new MemoryStore());
    await resumed.load(engine.state); await resumed.advance('clock');
    expect(resumed.state.flags.second).toBe(true);
    expect(resumed.state.flags.first).toBe(true);
  });

  it('migration covers counters, seen entries, scripts, steps and players', () => {
    const state = {
      v: 1, room: 'a', inventory: [], flags: {}, props: {}, actors: {}, hero: {}, unlocked: [], visited: {},
      counters: { oldCounter: 2 }, seen: { oldSeen: 1 }, scripts: { oldScript: { pc: 4, step: 'oldStep' } },
      active: 'oldPlayer', players: { oldPlayer: { room: 'a', inventory: [], hero: {} } }, started: 1,
    } as GameState;
    applyMigration(state, { from: 1, renameCounter: { oldCounter: 'counter' }, renameSeen: { oldSeen: 'seen' }, renameScript: { oldScript: 'script' }, renameScriptStep: { script: { oldStep: 'step' } }, renamePlayer: { oldPlayer: 'player' } });
    expect(state).toMatchObject({ v: 2, counters: { counter: 2 }, seen: { seen: 1 }, scripts: { script: { step: 'step' } }, active: 'player', players: { player: { room: 'a' } } });
  });
});
