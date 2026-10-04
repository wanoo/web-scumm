import { describe, expect, it } from 'vitest';
import type { Layout } from '@engine/core/types';
import { solve } from '@engine/tools/solve';
import { Engine } from '@engine/core/engine';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import { parseSave, saveEnvelope } from '@engine/core/save';
import { game } from '../game';
import start from '../layout/start.json';

const layouts: Record<string, Layout> = { start: start as unknown as Layout };

describe('selected game contract', () => {
  it('has a replayable winning walkthrough', async () => {
    const result = await solve(game, layouts, { mode: 'witness' });
    expect(result.status).toBe('solved');
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it('round-trips its initial save envelope', async () => {
    const engine = new Engine(game, layouts, new FakePresenter(), new MemoryStore());
    await engine.newGame();
    expect(parseSave(game, saveEnvelope(game, engine.state))).toEqual(engine.state);
  });
});
