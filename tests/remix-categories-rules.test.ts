// A category's world and the world a run may be played in (4.1.17, the `remix` mutation set): each rule of
// `categoryWorld`, `runSeedPolicy` and `worldVerdict` alone, with its exact reason — a 4.1.15 `seed` read as a world,
// a Story run outside the story world, a world of another mode, a Mystery run without its proofs, on another seed, or
// started outside the minute after its reveal (both edges).
import { describe, expect, it } from 'vitest';
import {
  categoryWorld,
  MYSTERY_START_WINDOW_MS,
  runSeedPolicy,
  seedCommitment,
  worldVerdict,
} from '@engine/core/remix/categories';
import type { WorldVariant } from '@engine/core/remix/compile';

const world = (mode: string, seed: string) =>
  ({ mode, seed, hash: 'h', algorithmVersion: 1 }) as unknown as WorldVariant;

describe("a category's world", () => {
  it('is its `world`; a 4.1.15 daily or mystery seed read as that world (deprecated); else the story world', () => {
    const w = { policy: 'fixed' as const, mode: 'remix', fixedSeed: 'WS-0000-0000' };
    expect(categoryWorld({ seed: 'daily', world: w })).toEqual({ world: w, deprecated: false });
    expect(categoryWorld({ seed: 'daily' as never })).toEqual({
      world: { policy: 'daily', mode: 'daily' },
      deprecated: true,
    });
    expect(categoryWorld({ seed: 'mystery' as never })).toEqual({
      world: { policy: 'mystery', mode: 'mystery' },
      deprecated: true,
    });
    expect(categoryWorld({ seed: 'random' })).toEqual({ world: { policy: 'story', mode: 'story' }, deprecated: false });
    expect(categoryWorld({})).toEqual({ world: { policy: 'story', mode: 'story' }, deprecated: false });
  });

  it('draws a fixed run seed only when the category says fixed', () => {
    expect(runSeedPolicy({ seed: 'fixed' })).toBe('fixed');
    expect(runSeedPolicy({ seed: 'random' })).toBe('random');
    expect(runSeedPolicy({})).toBe('random');
  });
});

describe('the world a run may be played in', () => {
  it('a Story run in the story world only: its mode and its seed', () => {
    const story = { policy: 'story' as const, mode: 'story' };
    expect(worldVerdict(story, world('story', 'story'))).toEqual([]);
    expect(worldVerdict(story, world('remix', 'story'))).toEqual(['a Story run is played in the story world']);
    expect(worldVerdict(story, world('story', 'WS-0000-0000'))).toEqual(['a Story run is played in the story world']);
  });

  it("a world of the category's mode", () => {
    expect(worldVerdict({ policy: 'random', mode: 'remix' }, world('daily', 'WS-0000-0000'))).toEqual([
      "the world's mode is daily, the category's remix",
    ]);
    expect(worldVerdict({ policy: 'random', mode: 'remix' }, world('remix', 'WS-0000-0000'))).toEqual([]);
  });

  it('a Mystery run: its commitment and reveal, its seed, and a start within the minute after the reveal', () => {
    const policy = { policy: 'mystery' as const, mode: 'mystery' };
    const seed = 'WS-0000-0000';
    const ok = {
      commitment: seedCommitment(seed, 'n'),
      reveal: { seed, nonce: 'n' },
      revealedAt: 1000,
      runStartedAt: 1000,
    };
    const v = world('mystery', seed);
    expect(worldVerdict(policy, v, ok)).toEqual([]);
    const NEEDS = 'a Mystery run needs the commitment and its reveal';
    expect(worldVerdict(policy, v, { ...ok, commitment: undefined })).toEqual([NEEDS]);
    expect(worldVerdict(policy, v, { ...ok, reveal: undefined })).toEqual([NEEDS]);
    const other = 'WS-0000-02DZ';
    expect(worldVerdict(policy, world('mystery', other), ok)).toEqual(['the run was not played on the revealed seed']);
    const TIMES = 'a Mystery run needs the time of the reveal and of its start';
    expect(worldVerdict(policy, v, { ...ok, revealedAt: undefined })).toEqual([TIMES]);
    expect(worldVerdict(policy, v, { ...ok, runStartedAt: undefined })).toEqual([TIMES]);
    const LATE = `a Mystery run starts within ${MYSTERY_START_WINDOW_MS / 1000} s of its reveal, not after looking at the world`;
    expect(worldVerdict(policy, v, { ...ok, runStartedAt: 999 })).toEqual([LATE]);
    expect(worldVerdict(policy, v, { ...ok, runStartedAt: 1000 + MYSTERY_START_WINDOW_MS })).toEqual([]);
    expect(worldVerdict(policy, v, { ...ok, runStartedAt: 1001 + MYSTERY_START_WINDOW_MS })).toEqual([LATE]);
  });
});
