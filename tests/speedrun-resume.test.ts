// A run resumed after the page was closed (4.1.14 "Time Attack", ADR 0016): the recorder wrote a chunk every 500
// entries; a fresh engine resumes from the last chunk that checks (its state, clock and draws), the inputs after it are
// played again, and the sealed run still verifies: the resume is a load of the run's own state, never a reload.
import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core/engine';
import { CHUNK_SIZE, MemoryChunkStore, readRun } from '@engine/core/journal-chunks';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import { storyWorld } from '@engine/core/remix/story';
import { RunStartRefused, SpeedrunRecorder } from '@engine/tools/speedrun/recorder';
import { verifyRun } from '@engine/tools/speedrun/verify';
import { ROUTE, speedrunGame, speedrunLayouts } from './fixtures/speedrun-game';
import { ENGINE_VERSION, fixtureFingerprint, verifyContext } from './fixtures/speedrun-run';

describe('resume after a crash', () => {
  it('a fresh engine resumes from the last stored chunk; the run verifies', async () => {
    const game = speedrunGame();
    const fingerprint = await fixtureFingerprint(game);
    const store = new MemoryChunkStore();
    const opts = (engine: Engine) => ({
      engine,
      gameId: game.id,
      manifest: game.speedrun!,
      category: game.speedrun!.categories.find((c) => c.id === 'no-hints')!,
      store,
      fingerprint,
      engineVersion: ENGINE_VERSION,
      runId: 'crash-run',
      now: () => 0,
    });
    const first = new Engine(speedrunGame(), speedrunLayouts, new FakePresenter(), new MemoryStore());
    const rec = new SpeedrunRecorder(opts(first));
    await rec.start();
    for (let i = 0; i < CHUNK_SIZE + 40; i++) await first.act({ verb: 'look', a: 'desk' });
    await rec.flushed();
    // The page closes: nothing sealed, the 40 inputs after the first chunk are lost.
    const stored = (await readRun(store, 'crash-run'))!;
    expect(stored.chunks).toHaveLength(1);
    expect(stored.head.sealed).toBeUndefined();
    const second = new Engine(speedrunGame(), speedrunLayouts, new FakePresenter(), new MemoryStore());
    // 4.1.16: the stored chunk keeps the run's world; resuming in another world is refused, in its own is not.
    const own = storyWorld(game.remix);
    expect(stored.head.resume).toMatchObject({ world: { variant: { hash: own.hash } }, runSeed: rec.seed });
    const elsewhere = { ...own, seed: 'WS-0000-0000', hash: 'f'.repeat(64) };
    await expect(
      SpeedrunRecorder.resume({ ...opts(second), runId: 'crash-run', variant: elsewhere }),
    ).rejects.toBeInstanceOf(RunStartRefused);
    const again = (await SpeedrunRecorder.resume({ ...opts(second), runId: 'crash-run' }))!;
    expect(again).not.toBeNull();
    expect(second.runClock.logicalSteps()).toBe(BigInt(CHUNK_SIZE));
    for (const a of ROUTE) await second.act({ ...a });
    const envelope = await again.seal();
    expect(envelope.loads).toEqual([{ before: CHUNK_SIZE, from: CHUNK_SIZE - 1, resume: true }]);
    expect(envelope.chunks.map((c) => c.entries.length)).toEqual([CHUNK_SIZE, ROUTE.length]);
    // A resume is not a reload: the category where a load disqualifies still accepts it.
    const r = await verifyRun(envelope, verifyContext(fingerprint, game));
    expect([r.verdict, r.code]).toEqual(['valid', 'ok']);
  }, 60000);

  it('a sealed or unknown run is not resumed', async () => {
    const store = new MemoryChunkStore();
    const game = speedrunGame();
    const engine = new Engine(game, speedrunLayouts, new FakePresenter(), new MemoryStore());
    const r = await SpeedrunRecorder.resume({
      engine,
      gameId: 'vault',
      manifest: game.speedrun!,
      category: game.speedrun!.categories[0]!,
      store,
      fingerprint: await fixtureFingerprint(game),
      engineVersion: ENGINE_VERSION,
      runId: 'none',
    });
    expect(r).toBeNull();
  });
});
