// The solver and the world outside (4.1.1): a verdict says which world it holds in. Closed, the game must be
// finishable on its own (a required signal's fallback); under a scenario, with the listed signals in order; adversarial,
// against any order and repetition of the declared signals. No real service is ever contacted.
import { describe, expect, it } from 'vitest';
import { solve } from '@engine/tools/solve';
import { validate } from '@engine/tools/validate';
import { replay } from '@engine/tools/replay';
import type { GameDef } from '@engine/core/types';
import { signals, signalsLayouts } from './fixtures/signals';

describe('the solver under the reality policies', () => {
  it('closed: finished through the fallback, never through a signal', async () => {
    const r = await solve(signals(), signalsLayouts, { mode: 'prove' });
    expect(r.status).toBe('solved');
    expect(r.reality).toBe('closed: without the world outside');
    expect(r.path.join(' ')).toMatch(/radio/);
    expect(r.path.some((p) => p.startsWith('Signal'))).toBe(false);
  });

  it('a scenario: the signal the world sends opens the vault; its witness replays offline', async () => {
    // Without the radio, only the world can open the vault.
    const g = signals();
    g.rooms[0]!.on = g.rooms[0]!.on!.filter((x) => x.a !== 'radio');
    expect((await solve(structuredClone(g), signalsLayouts, { mode: 'witness' })).status).toBe('unsolved');
    const r = await solve(structuredClone(g), signalsLayouts, {
      mode: 'witness',
      reality: { scenario: 'mail-answers', signals: ['mail.answer.correct'] },
    });
    expect(r.status).toBe('solved');
    expect(r.reality).toBe('scenario mail-answers: mail.answer.correct');
    expect(r.steps.some((s) => 'external' in s)).toBe(true);
    const p = await replay(g, signalsLayouts, { start: { kind: 'new' }, log: r.steps });
    expect(p.divergedAt).toBeUndefined();
    expect(p.ended).toBe(true);
  });

  it('adversarial: duplicates and every order of the declared signals never lose the game', async () => {
    const r = await solve(signals(), signalsLayouts, { mode: 'prove', reality: 'adversarial' });
    expect(r.status).toBe('solved');
    expect(r.softlockCount).toBe(0);
  });

  it('adversarial finds the softlock a signal causes, closed cannot see it', async () => {
    const g = signals();
    // A wrong answer that jams the radio: without the right answer the game is lost.
    g.events!.push({ id: 'wrong-jams-radio', on: 'mail.answer.wrong', do: [{ set: 'radio_jammed' }] });
    const radio = g.rooms[0]!.on!.find((x) => x.a === 'radio')!;
    radio.if = { all: ['!vault_open', '!radio_jammed'] } as never;
    expect((await solve(structuredClone(g), signalsLayouts, { mode: 'prove' })).softlockCount).toBe(0);
    const adv = await solve(structuredClone(g), signalsLayouts, { mode: 'prove', reality: 'adversarial' });
    expect(adv.softlockCount).toBe(0); // the right answer can still come
    const scenario = await solve(structuredClone(g), signalsLayouts, {
      mode: 'prove',
      reality: { scenario: 'wrong-only', signals: ['mail.answer.wrong'] },
    });
    expect(scenario.softlockCount).toBeGreaterThan(0);
    expect(scenario.softlockCauses.map((c) => c.action).join(' ')).toMatch(/Signal mail\.answer\.wrong/);
  });
});

describe('the validator and signals', () => {
  const errs = (g: GameDef) => validate(g, signalsLayouts).errors;

  it('a well-declared game has no error', () => {
    expect(errs(signals())).toEqual([]);
  });

  it('a required signal without a fallback, or with one that matches no rule, is an error', () => {
    const g = signals();
    delete g.reality!.signals[0]!.fallback;
    expect(errs(g).join('\n')).toMatch(/required signal "mail\.answer\.correct" has no `fallback`/);
    const h = signals();
    h.reality!.signals[0]!.fallback = { verb: 'use', a: 'lamp' };
    expect(errs(h).join('\n')).toMatch(/fallback of "mail\.answer\.correct" \(use lamp\) matches no rule/);
  });

  it('a listener on an undeclared name, ids, duplicates and modes are checked', () => {
    const g = signals();
    g.events!.push({ id: 'typo', on: 'mail.answer.corect', do: [] });
    g.reality!.signals.push({ ...g.reality!.signals[1]! });
    g.reality!.signals.push({ id: 'bad id!', source: '', availability: 'maybe', replay: 'live' } as never);
    const e = errs(g).join('\n');
    expect(e).toMatch(/"mail\.answer\.corect" is never emitted nor declared/);
    expect(e).toMatch(/declared twice/);
    expect(e).toMatch(/signal id "bad id!"/);
    expect(e).toMatch(/names its `source`/);
    expect(e).toMatch(/`availability`/);
    expect(e).toMatch(/`replay` is "record"/);
  });
});
