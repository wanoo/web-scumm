import { describe, expect, it } from 'vitest';
import { parseSave, saveEnvelope, SaveEnvelopeV3Schema } from '@engine/core/save';
import { Engine } from '@engine/core/engine';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import { mini, miniLayouts } from './fixtures/mini';

describe('save envelope v3', () => {
  it('round-trips a complete, game-bound envelope', async () => {
    const game = mini();
    const engine = new Engine(game, miniLayouts, new FakePresenter(), new MemoryStore());
    await engine.newGame();
    const envelope = saveEnvelope(game, engine.state);
    expect(SaveEnvelopeV3Schema.parse(envelope).schema).toBe(3);
    expect(parseSave(game, JSON.parse(JSON.stringify(envelope)))).toEqual(engine.state);
  });

  it('rejects a foreign game, corrupt shape and unknown content ids without touching current state', async () => {
    const game = mini();
    const engine = new Engine(game, miniLayouts, new FakePresenter(), new MemoryStore());
    await engine.newGame();
    const before = structuredClone(engine.state);
    const foreign = { ...saveEnvelope(game, engine.state), gameId: 'other' };
    expect(() => parseSave(game, foreign)).toThrow(/belongs to game/);
    expect(() => parseSave(game, { ...engine.state, inventory: ['missing'] })).toThrow(/unknown item/);
    expect(() => parseSave(game, { ...engine.state, started: 'yesterday' })).toThrow();
    expect(engine.state).toEqual(before);
  });

  it('accepts a validated legacy raw state for deliberate v2 migration', async () => {
    const game = mini();
    const engine = new Engine(game, miniLayouts, new FakePresenter(), new MemoryStore());
    await engine.newGame();
    expect(parseSave(game, engine.state).room).toBe('a');
  });
});
