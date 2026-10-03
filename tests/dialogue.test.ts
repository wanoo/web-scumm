// The dialogue tree (derived from talk topics) and the engine's journal.
import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core/engine';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import { dialogueText, dialogueTree } from '@engine/tools/dialogue';
import { insults, insultsLayouts } from './fixtures/classics';
import { world, worldLayouts } from './fixtures/world';

describe('dialogueTree', () => {
  it('lays out topics, lines, choices, options and branches with their conditions and paths', () => {
    const g = insults();
    const tree = dialogueTree(g.rooms[0].talk!.master, 'talk.master');
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ kind: 'topic', text: 'I challenge you!', path: 'talk.master[0].topic' });
    const kids = tree[0].children!;
    expect(kids[0]).toMatchObject({ kind: 'line', who: 'master', path: 'talk.master[0].do[0].say[1]' });
    expect(kids[1].kind).toBe('choice');
    expect(kids[1].children![0]).toMatchObject({ kind: 'option', text: 'How appropriate. You fight like a cow.', cond: 'learned_farmer', path: 'talk.master[0].do[1].choice[0].text' });
    expect(kids[1].children![0].children![0]).toMatchObject({ kind: 'other', text: 'inc wins' });
    const branch = kids.find((k) => k.kind === 'if')!;
    expect(branch.text).toBe('if wins ≥ 2');
    expect(kids.find((k) => k.kind === 'else')).toBeDefined();
    const thug = dialogueTree(g.rooms[0].talk!.thug);
    expect(thug[0].cond).toBe('not learned_farmer');
    const text = dialogueText(tree);
    expect(text).toContain('▸ "I challenge you!"');
    expect(text).toContain('  ○ "How appropriate. You fight like a cow."  [if learned_farmer]');
    expect(text).toContain('  if wins ≥ 2');
  });
});

describe('the journal', () => {
  it('records actions, events, listeners, script steps and moves when on', async () => {
    const ui = new FakePresenter();
    const e = new Engine(world(), worldLayouts, ui, new MemoryStore());
    await e.newGame();
    await e.act({ verb: 'use', a: 'gong' });
    expect(e.trace).toEqual([]); // off by default
    e.traceOn = true;
    await e.act({ verb: 'use', a: 'gong' });
    await e.runScript('cook_comes');
    const texts = e.trace.map((x) => `${x.kind}: ${x.text}`);
    expect(texts).toContain('event: emit gong');
    expect(texts).toContain('event: gong → game.events[0]');
    expect(texts).toContain('action: use gong: rule');
    expect(texts).toContain('actor: cook → hall');
    expect(texts.some((t) => t.startsWith('script: cook_comes ran moveActor cook hall'))).toBe(true);
    expect(e.trace.every((x) => x.room === 'hall' && x.t > 0)).toBe(true);
  });
});
