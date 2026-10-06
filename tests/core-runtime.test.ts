// The modules of the engine (4.1.0 "Clarity", core/*-runtime.ts, interactions, world-queries, players): each one
// called directly, without the Engine method that forwards to it, so a module is read and tested on its own.
import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core/engine';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import type { GameDef } from '@engine/core/types';
import { begin, end } from '@engine/core/session-runtime';
import { emit } from '@engine/core/event-runtime';
import { advance, scriptState } from '@engine/core/script-runtime';
import { fill, findRule } from '@engine/core/interactions';
import { exec } from '@engine/core/command-runtime';
import { nameOf, targets } from '@engine/core/world-queries';
import { otherPlayers } from '@engine/core/players';
import { mini, miniLayouts } from './fixtures/mini';

const game = (): GameDef => {
  const g = mini();
  const a = g.rooms[0]!;
  a.scripts = [{ id: 'waiter', do: [{ waitEvent: 'bell' }, { set: 'rang' }] }];
  a.events = [{ id: 'count-bell', on: 'bell', once: true, do: [{ set: 'heard' }] }];
  return g;
};
const engine = async () => {
  const e = new Engine(game(), miniLayouts, new FakePresenter(), new MemoryStore());
  await e.newGame();
  return e;
};
const ctx = (e: Engine) => ({ room: e.room(), fast: true });

describe('the modules of the engine, called directly', () => {
  it('session-runtime: an entry opened then closed lands in the session with the digest of the state after it', async () => {
    const e = await engine();
    e.digestOn = true;
    const before = e.session?.log.length ?? 0;
    begin(e, { travel: 'b' });
    end(e);
    const last = e.session?.log.at(-1);
    expect(e.session?.log.length).toBe(before + 1);
    expect(last).toMatchObject({ travel: 'b' });
    expect(last?.digest).toMatch(/\S/);
  });

  it('event-runtime: emit moves a script past its waitEvent and runs a `once` listener once', async () => {
    const e = await engine();
    expect(scriptState(e, 'waiter').pc).toBe(0);
    expect(await advance(e, 'waiter')).toBe('blocked');
    await emit(e, 'bell', ctx(e));
    await emit(e, 'bell', ctx(e));
    expect(scriptState(e, 'waiter').pc).toBe(1);
    expect(e.state.flags.heard).toBe(true);
    expect(Object.keys(e.state.seen).filter((k) => k.includes('count-bell'))).toHaveLength(1);
  });

  it('script-runtime: advance runs one step at a time and says when the script is done', async () => {
    const e = await engine();
    await emit(e, 'bell', ctx(e));
    expect(await advance(e, 'waiter')).toBe('ran');
    expect(e.state.flags.rang).toBe(true);
    expect(await advance(e, 'waiter')).toBe('done');
  });

  it('interactions: findRule finds the written rule, fill names the things it speaks of', async () => {
    const e = await engine();
    expect(findRule(e, 'use', 'cle', 'valise', e.room())?.verb).toBe('use');
    expect(findRule(e, 'give', 'cle', 'valise', e.room())).toBeNull();
    expect(fill(e, '{objet} and {cible}', 'cle', 'valise')).toBe('key and suitcase');
  });

  it('command-runtime: exec runs a list of commands in order', async () => {
    const e = await engine();
    await exec(e, [{ set: 'one' }, { set: 'two' }], ctx(e));
    expect(e.state.flags).toMatchObject({ one: true, two: true });
  });

  it('world-queries and players: names and targets of the room; a single hero has no other player', async () => {
    const e = await engine();
    expect(nameOf(e, 'valise', e.room())).toBe('suitcase');
    expect(targets(e, e.room())).toContain('valise');
    expect(otherPlayers(e)).toEqual({});
  });
});
