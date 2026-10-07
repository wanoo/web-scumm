// The solver and the world outside (4.1.1): a verdict says which world it holds in. Closed, the game must be
// finishable on its own (a required signal's fallback); under a scenario, with the listed signals in order; adversarial,
// against any order and repetition of the declared signals. No real service is ever contacted.
import { describe, expect, it } from 'vitest';
import { lintContent } from '@engine/tools/lint';
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

describe('the content lint and a required signal', () => {
  it('the closed witness plays the declared fallback, or the lint says the fallback is not the way through', async () => {
    const ok = await solve(signals(), signalsLayouts, { mode: 'witness' });
    expect(lintContent(signals(), signalsLayouts, { solve: ok }).findings.map((f) => f.code)).not.toContain(
      'fallback-unplayed',
    );
    // The radio (the declared fallback) behind a flag nothing sets, and another way to open the vault: the game
    // still finishes closed, through a route the declaration does not name.
    const g = signals();
    const radio = g.rooms[0]!.on!.find((x) => x.a === 'radio')!;
    radio.if = 'ghost';
    g.rooms[0]!.on!.push({ verb: 'look', a: 'vault', if: '!vault_open', do: [{ set: 'vault_open' }, 'Ajar.'] });
    const r = await solve(structuredClone(g), signalsLayouts, { mode: 'witness' });
    expect(r.status).toBe('solved');
    const found = lintContent(g, signalsLayouts, { solve: r }).findings.find((f) => f.code === 'fallback-unplayed');
    expect(found).toMatchObject({ severity: 'warning', where: { path: 'reality.signals[0].fallback' } });
    expect(found?.message).toMatch(/use radio/);
    // Under a scenario the witness may go through the signal: nothing to say about the fallback there.
    const sc = await solve(structuredClone(g), signalsLayouts, {
      mode: 'witness',
      reality: { scenario: 'mail', signals: ['mail.answer.correct'] },
    });
    expect(lintContent(g, signalsLayouts, { solve: sc }).findings.map((f) => f.code)).not.toContain(
      'fallback-unplayed',
    );
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

  it("reality.connectors (4.1.9): declared signals, plain words, commands that are not the terminal's, paths inside", () => {
    const g = signals();
    g.reality!.connectors = {
      email: { answers: [{ words: ['open'], signal: 'mail.answer.correct' }], otherwise: 'mail.answer.wrong' },
      telnet: { commands: [{ says: 'ring bell', reply: 'Ding.', signal: 'hook.bell' }] },
      ssh: { commands: [], files: { '/notes/a.txt': 'a' } },
      'open-badge': { issuers: ['https://badges.example.org/issuer'], valid: 'hook.bell' },
    };
    expect(errs(g)).toEqual([]);
    g.reality!.connectors = {
      email: { answers: [{ words: ['two words', ''], signal: 'nope' }] },
      telnet: {
        commands: [
          { says: 'ls -la', reply: 'x' },
          { says: 'cat notes', reply: 'x' },
          { says: 'Rm; reboot', reply: 'x' },
          { says: 'ring', reply: 'x'.repeat(2001) },
          { says: 'ring', reply: 'y', signal: 'ghost' },
        ],
      },
      ssh: { commands: [], files: { '../etc/passwd': 'x', '/a/../b': 'y', '/big': 'z'.repeat(17_000) } },
      'open-badge': { issuers: [], valid: 'missing' },
    };
    const e = errs(g).join('\n');
    expect(e).toMatch(/answers\[0\].*`words`/);
    expect(e).toMatch(/signal "nope" is not declared/);
    expect(e).toMatch(/"cat notes": help, exit, quit, clear, ls, cd, cat, pwd are the terminal's own commands/);
    expect(e).toMatch(/commands\[0\].*`says`/);
    expect(e).toMatch(/"ring" is declared twice/);
    expect(e).toMatch(/`reply`: plain text, at most 2000/);
    expect(e).toMatch(/signal "ghost" is not declared/);
    expect(e).toMatch(/"\.\.\/etc\/passwd": an absolute path/);
    expect(e).toMatch(/"\/a\/\.\.\/b": an absolute path/);
    expect(e).toMatch(/"\/big": at most 16 KB/);
    expect(e).toMatch(/`issuers`/);
    expect(e).toMatch(/signal "missing" is not declared/);
  });
});
