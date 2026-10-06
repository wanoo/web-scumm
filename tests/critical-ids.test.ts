// Stable content ids: naming, assignment with the v2 → v3 map, line ids, existing ids, path renames (core/content-ids.ts).
import { describe, expect, it } from 'vitest';
import {
  assignIds,
  blockIdFor,
  choiceIdFor,
  choicePathSeg,
  eventPathSeg,
  existingIds,
  lineIdFor,
  lineIds,
  linePathSeg,
  listenerActionId,
  listenerIdFor,
  listLines,
  Namer,
  renamePaths,
  ruleActionId,
  ruleIdFor,
  rulePathSeg,
  slug,
  stepIdFor,
  topicActionId,
  topicIdFor,
  topicPathSeg,
} from '@engine/core/content-ids';
import type { Cmd, GameDef } from '@engine/core/types';
import { mini } from './fixtures/mini';

/** Every command shape the id walkers go through. */
const everyCmd = (): Cmd[] => [
  'Plain line.',
  { say: ['uncle', 'Hey there'] },
  { toast: 'A toast', id: 'toast.kept' },
  { once: ['In once'] },
  { nth: [['First time'], ['Second time']] },
  { cycle: [['Cycled']], id: 'cyc.kept' },
  { random: [['Rolled']] },
  {
    choice: [
      { text: 'Yes please', do: ['Okay.'] },
      { id: 'ch.kept', text: 'No', do: [] },
    ],
  },
  { if: 'lit', then: ['Then line.'], else: ['Else line.'] },
  { if: 'dark', then: [] },
  { parallel: [['Left line.'], ['Right line.']] },
  { cutscene: ['Cut line.'] },
  { minigame: 'mg', then: ['Won line.'] },
  { minigame: 'mg2' },
  { phone: 'ann', do: ['Ring line.'] },
  { anim: ['hero', 'wave'], at: { 1: ['Wave line.'] } },
  { anim: ['hero', 'nod'] },
  { ending: true, after: ['Bye line.'] },
  { reveal: true },
  { set: 'x' },
  { guide: { verb: 'look', target: 'valise', say: 'Look at it.' } },
];

function idsGame(): GameDef {
  const g = mini();
  const a = g.rooms[0]!;
  a.on!.push(
    { id: 'a.kept', verb: 'look', a: 'valise', do: [] },
    { verb: ['look', 'use'], a: ['uncle', 'valise'], b: ['cle'], do: [] },
  );
  a.talk = {
    uncle: [
      { topic: 'The weather', do: ['Rainy.'] },
      { id: 't.kept', topic: 'X', do: [] },
    ],
  };
  a.events = [
    { on: 'Bell rang', do: [] },
    { id: 'ev.kept', on: 'x', do: [] },
  ];
  a.scripts = [
    { id: 'clock', do: ['Tick.', { wait: 1 }] },
    { id: 'drip', do: [{ wait: 1 }], stepIds: ['drip.w'] },
    { id: 'part', do: [{ wait: 1 }, { wait: 2 }], stepIds: ['part.first'] },
  ];
  a.onEnter = everyCmd();
  a.props!.valise!.anims = { spin: { frames: [], at: { 2: ['Spin!'] } }, still: { frames: [] } };
  a.props!.lamp = { img: 'o/lamp' };
  a.look = { valise: ['Old.', { id: 'look.kept', text: 'Kept.' }], cle: 'A single look.' };
  a.hints = [
    { until: 'x', lines: ['Try.'] },
    { id: 'h.kept', until: 'y', lines: [{ id: 'hl.kept', text: 'Z.' }] },
  ];
  g.items.cle!.look = ['A key.'];
  g.items.badge!.look = 'A badge.';
  g.rules.fallbacks.give = undefined as unknown as string[];
  g.rules.kinds = [
    { verb: 'look', kind: 'door', say: 'A door.' },
    { verb: ['use'], target: 'valise', say: 'Not that.' },
    { verb: 'look', say: 'Something.' },
    { id: 'k.kept', verb: 'look', say: 'Kept kind.' },
  ];
  g.rules.on = [{ verb: 'give', a: 'badge', b: 'uncle', do: [{ say: ['uncle', 'Thanks'] }] }];
  g.events = [{ on: 'tick', do: [] }];
  g.scripts = [{ id: 'g', do: [{ toast: 'Hi' }] }];
  g.start.intro = ['Hello.', { say: ['hero', 'Hi there'] }];
  return g;
}

describe('naming', () => {
  it('slugs to ASCII, lowercase, dashes, cut on a word boundary when one is past half', () => {
    expect(slug('Où est la clé ?')).toBe('ou-est-la-cle');
    expect(slug('')).toBe('x');
    expect(slug('---')).toBe('x');
    expect(slug('abc', 3)).toBe('abc');
    expect(slug('ab cd', 4)).toBe('ab-c');
    expect(slug('abcdef ghi', 8)).toBe('abcdef');
    expect(slug('a bcdefghij', 8)).toBe('a-bcdefg');
    expect(slug('abcdefghij', 4)).toBe('abcd');
    expect(slug('abc-defgh', 4)).toBe('abc');
    expect(slug('abcd efgh', 8)).toBe('abcd-efg');
    expect(slug('ab------cd', 5)).toBe('ab-cd');
    expect(slug('a-bc', 2)).toBe('a');
    expect(slug('abc', 0)).toBe('x');
  });
  it('hands out each id once, numbering the next ones, the taken ones included', () => {
    const n = new Namer(['a', 'b-2']);
    expect([n.take('a'), n.take('b'), n.take('b'), n.take('a')]).toEqual(['a-2', 'b', 'b-3', 'a-3']);
    expect(new Namer().take('z')).toBe('z');
  });
  it('builds action ids from a written id, else the position', () => {
    expect(ruleActionId('a', 2, { verb: 'look', a: 'x', do: [] })).toBe('rule:a/on[2]');
    expect(ruleActionId('a', 2, { id: 'r', verb: 'look', a: 'x', do: [] })).toBe('rule:r');
    expect(topicActionId('a', 'ann', 1, { topic: 'T', do: [] })).toBe('topic:a/ann[1]');
    expect(topicActionId('a', 'ann', 1, { id: 't', topic: 'T', do: [] })).toBe('topic:t');
    expect(listenerActionId('game', 0, { on: 'x', do: [] })).toBe('listener:game/events[0]');
    expect(listenerActionId('game', 0, { id: 'l', on: 'x', do: [] })).toBe('listener:l');
  });
  it('builds translation path segments from a written id, else the position', () => {
    expect(rulePathSeg(3, { verb: 'look', a: 'x', do: [] })).toBe('on[3]');
    expect(rulePathSeg(3, { id: 'r', verb: 'look', a: 'x', do: [] })).toBe('on.r');
    expect(topicPathSeg('ann', 1, { topic: 'T', do: [] })).toBe('talk.ann[1]');
    expect(topicPathSeg('ann', 1, { id: 't', topic: 'T', do: [] })).toBe('talk.ann.t');
    expect(choicePathSeg(2, { text: 'Y', do: [] })).toBe('.choice[2]');
    expect(choicePathSeg(2, { id: 'c', text: 'Y', do: [] })).toBe('.choice.c');
    expect(eventPathSeg(0, { on: 'x', do: [] })).toBe('events[0]');
    expect(eventPathSeg(0, { id: 'e', on: 'x', do: [] })).toBe('events.e');
  });
  it('gives a line its id segment only for a say, toast or guide that has an id', () => {
    expect(linePathSeg(4, 'Plain.')).toBe('[4]');
    expect(linePathSeg(4, { say: ['hero', 'Hi'] })).toBe('[4]');
    expect(linePathSeg(4, { say: ['hero', 'Hi'], id: 'l' })).toBe('.l');
    expect(linePathSeg(4, { toast: 'Hi', id: 't' })).toBe('.t');
    expect(linePathSeg(4, { guide: { verb: 'look', target: 'x', say: 'Hi' }, id: 'g' })).toBe('.g');
    expect(linePathSeg(4, { toast: 'Hi', id: '' })).toBe('[4]');
    expect(linePathSeg(4, { once: [], id: 'o' })).toBe('[4]');
    expect(linePathSeg(4, { set: 'x' })).toBe('[4]');
  });
  it('builds ids from the content, slugged', () => {
    expect(ruleIdFor('a', { verb: 'use', a: 'Clé', b: 'Valise', do: [] })).toBe('a.use-cle-valise');
    expect(ruleIdFor('a', { verb: ['look', 'use'], a: ['x', 'y'], do: [] })).toBe('a.look-x');
    expect(ruleIdFor('a', { verb: 'look', a: [], b: [], do: [] })).toBe('a.look-x-x');
    expect(topicIdFor('a', 'Ann B', { topic: 'The weather', do: [] })).toBe('a.ann-b.the-weather');
    expect(listenerIdFor('game', { on: 'Bell rang', do: [] })).toBe('game.on-bell-rang');
    expect(choiceIdFor('o', { text: 'What is for dinner tonight', do: [] })).toBe('o.c-what-is-for');
    expect(blockIdFor('o', 'cycle')).toBe('o.cycle');
    expect(stepIdFor('s', 'A line')).toBe('s.say');
    expect(stepIdFor('s', { wait: 1 })).toBe('s.wait');
    expect(stepIdFor('s', {} as Cmd)).toBe('s.cmd');
    expect(stepIdFor('s', { waitUntil: 'x' })).toBe('s.waituntil');
    expect(lineIdFor('o', 'Where is the key, grandma?')).toBe('o.l-where-is-the-key');
  });
});

const seen = {
  'a.uncle.0': 'topic.a.uncle.the-weather',
  'event.a.0': 'event.a.on-bell-rang',
  'choice.a.Yes please': 'choice.a.enter.c-yes-please',
  'event.game.0': 'event.game.on-tick',
};
const counters = { 'a:enter.3': 'a.enter.once', 'a:enter.4': 'a.enter.nth', 'a:enter.6': 'a.enter.random' };
const labels = {
  'rule:a/on[0]': 'rule:a.use-cle-valise',
  'rule:a/on[2]': 'rule:a.look-uncle-cle',
  'topic:a/uncle[0]': 'topic:a.uncle.the-weather',
  'listener:a/events[0]': 'listener:a.on-bell-rang',
  'rule:b/on[0]': 'rule:b.use-cle-cadenas',
  'rule:game/on[0]': 'rule:game.give-badge-uncle',
  'listener:game/events[0]': 'listener:game.on-tick',
};
/** The paths every mode maps: rules, topics, listeners, choices, and the lines that already had an id. */
const basePaths = {
  'room:a/on[0]': 'room:a/on.a.use-cle-valise',
  'room:a/on.a.kept': 'room:a/on.a.kept',
  'room:a/on[2]': 'room:a/on.a.look-uncle-cle',
  'room:a/talk.uncle[0]': 'room:a/talk.uncle.a.uncle.the-weather',
  'room:a/talk.uncle.t.kept': 'room:a/talk.uncle.t.kept',
  'room:a/events[0]': 'room:a/events.a.on-bell-rang',
  'room:a/events.ev.kept': 'room:a/events.ev.kept',
  'room:a/onEnter.toast.kept': 'room:a/onEnter.toast.kept',
  'room:a/onEnter[7].choice[0]': 'room:a/onEnter[7].choice.a.enter.c-yes-please',
  'room:a/onEnter[7].choice.ch.kept': 'room:a/onEnter[7].choice.ch.kept',
  'room:b/on[0]': 'room:b/on.b.use-cle-cadenas',
  'rules/on[0]': 'rules/on.game.give-badge-uncle',
  'events[0]': 'events.game.on-tick',
};
/** What `lines: true` adds: the say / toast / guide objects, hints and kinds, and the list lines that had an id. */
const linePaths = {
  'room:a/onEnter[1]': 'room:a/onEnter.a.enter.l-hey-there',
  'room:a/onEnter[20]': 'room:a/onEnter.a.enter.l-look-at-it',
  'room:a/look.valise.look.kept': 'room:a/look.valise.look.kept',
  'room:a/hints[0]': 'room:a/hints.a.hint',
  'room:a/hints.h.kept': 'room:a/hints.h.kept',
  'room:a/hints.h.kept.lines.hl.kept': 'room:a/hints.h.kept.lines.hl.kept',
  'rules/kinds[0]': 'rules/kinds.kind.look-door',
  'rules/kinds[1]': 'rules/kinds.kind.use-valise',
  'rules/kinds[2]': 'rules/kinds.kind.look-x',
  'rules/kinds.k.kept': 'rules/kinds.k.kept',
  'rules/on[0].do[0]': 'rules/on.game.give-badge-uncle.do.game.give-badge-uncle.l-thanks',
  'scripts.g.do[0]': 'scripts.g.do.g.l-hi',
  'start/intro[1]': 'start/intro.game.intro.l-hi-there',
};
/** What `lines: 'all'` adds: every plain string, turned into a say object (`.say`) or a `{ id, text }` list line. */
const allPaths = {
  'room:a/on[0].do[1]': 'room:a/on.a.use-cle-valise.do.a.use-cle-valise.l-opened.say',
  'room:a/talk.uncle[0].do[0]': 'room:a/talk.uncle.a.uncle.the-weather.do.a.uncle.the-weather.l-rainy.say',
  'room:a/scripts.clock.do[0]': 'room:a/scripts.clock.do.clock.l-tick.say',
  'room:a/onEnter[0]': 'room:a/onEnter.a.enter.l-plain-line.say',
  'room:a/onEnter[3].once[0]': 'room:a/onEnter[3].once.a.enter.once.l-in-once.say',
  'room:a/onEnter[4].nth[0][0]': 'room:a/onEnter[4].nth[0].a.enter.nth.l-first-time.say',
  'room:a/onEnter[4].nth[1][0]': 'room:a/onEnter[4].nth[1].a.enter.nth.l-second-time.say',
  'room:a/onEnter[5].cycle[0][0]': 'room:a/onEnter[5].cycle[0].cyc.kept.l-cycled.say',
  'room:a/onEnter[6].random[0][0]': 'room:a/onEnter[6].random[0].a.enter.random.l-rolled.say',
  'room:a/onEnter[7].choice[0].do[0]':
    'room:a/onEnter[7].choice.a.enter.c-yes-please.do.a.enter.c-yes-please.l-okay.say',
  'room:a/onEnter[8].then[0]': 'room:a/onEnter[8].then.a.enter.l-then-line.say',
  'room:a/onEnter[8].else[0]': 'room:a/onEnter[8].else.a.enter.l-else-line.say',
  'room:a/onEnter[10].parallel[0][0]': 'room:a/onEnter[10].parallel[0].a.enter.l-left-line.say',
  'room:a/onEnter[10].parallel[1][0]': 'room:a/onEnter[10].parallel[1].a.enter.l-right-line.say',
  'room:a/onEnter[11].cutscene[0]': 'room:a/onEnter[11].cutscene.a.enter.l-cut-line.say',
  'room:a/onEnter[12].then[0]': 'room:a/onEnter[12].then.a.enter.l-won-line.say',
  'room:a/onEnter[14].do[0]': 'room:a/onEnter[14].do.a.enter.l-ring-line.say',
  'room:a/onEnter[15].at[1][0]': 'room:a/onEnter[15].at[1].a.enter.l-wave-line.say',
  'room:a/onEnter[17].after[0]': 'room:a/onEnter[17].after.a.enter.l-bye-line.say',
  'room:a/props.valise.anims.spin.at[2][0]': 'room:a/props.valise.anims.spin.at[2].a.valise.spin.2.l-spin.say',
  'room:b/on[0].do[0]': 'room:b/on.b.use-cle-cadenas.do.b.use-cle-cadenas.l-no-not-that.say',
  'room:a/look.valise[0]': 'room:a/look.valise.a.look-valise.l-old',
  'room:a/hints[0].lines[0]': 'room:a/hints.a.hint.lines.a.hint.l-try',
  'item:cle/look[0]': 'item:cle/look.item.cle.l-a-key',
  'rules/fallbacks.look[0]': 'rules/fallbacks.look.fallback.look.l-nothing',
  'rules/fallbacks.use[0]': 'rules/fallbacks.use.fallback.use.l-no',
  'rules/fallbacks.use2[0]': 'rules/fallbacks.use2.fallback.use2.l-these-do-not-go',
  'start/intro[0]': 'start/intro.game.intro.l-hello.say',
};

describe('assignIds', () => {
  it('names rules, topics, listeners, choices, blocks and steps, and maps their v2 keys', () => {
    const src = idsGame();
    const before = structuredClone(src);
    const { game, map, added } = assignIds(src);
    expect(src).toEqual(before);
    expect(map).toEqual({ seen, counters, paths: basePaths, labels });
    expect(added).toBe(15);
    const a = game.rooms[0]!;
    expect(a.on!.map((r) => r.id)).toEqual(['a.use-cle-valise', 'a.kept', 'a.look-uncle-cle']);
    expect(a.talk!.uncle!.map((t) => t.id)).toEqual(['a.uncle.the-weather', 't.kept']);
    expect(a.events!.map((e) => e.id)).toEqual(['a.on-bell-rang', 'ev.kept']);
    expect(a.scripts!.map((s) => s.stepIds)).toEqual([
      ['clock.say', 'clock.wait'],
      ['drip.w'],
      ['part.first', 'part.wait'],
    ]);
    expect(game.scripts![0]!.stepIds).toEqual(['g.toast']);
    expect(game.events![0]!.id).toBe('game.on-tick');
    expect(game.rules.on![0]!.id).toBe('game.give-badge-uncle');
    expect(a.onEnter![0]).toBe('Plain line.');
    expect(a.onEnter![1]).toEqual({ say: ['uncle', 'Hey there'] });
    expect(a.onEnter![3]).toEqual({ once: ['In once'], id: 'a.enter.once' });
    expect((a.onEnter![5] as { id: string }).id).toBe('cyc.kept');
    expect(a.hints![0]!.id).toBeUndefined();
    expect(game.rules.kinds![0]!.id).toBeUndefined();
  });

  it('with lines, names the say, toast and guide objects, hints, kinds and list lines that are objects', () => {
    const { game, map, added } = assignIds(idsGame(), { lines: true });
    expect(map).toEqual({ seen, counters, paths: { ...basePaths, ...linePaths }, labels });
    expect(added).toBe(24);
    const a = game.rooms[0]!;
    expect(a.onEnter![0]).toBe('Plain line.');
    expect(a.onEnter![1]).toEqual({ say: ['uncle', 'Hey there'], id: 'a.enter.l-hey-there' });
    expect(a.hints).toEqual([
      { until: 'x', lines: ['Try.'], id: 'a.hint' },
      { id: 'h.kept', until: 'y', lines: [{ id: 'hl.kept', text: 'Z.' }] },
    ]);
    expect(a.look).toEqual({ valise: ['Old.', { id: 'look.kept', text: 'Kept.' }], cle: 'A single look.' });
    expect(game.items.cle!.look).toEqual(['A key.']);
    expect(game.rules.kinds!.map((k) => k.id)).toEqual(['kind.look-door', 'kind.use-valise', 'kind.look-x', 'k.kept']);
  });

  it("with lines 'all', turns every plain string into a line with an id", () => {
    const { game, map, added } = assignIds(idsGame(), { lines: 'all' });
    expect(map).toEqual({ seen, counters, paths: { ...basePaths, ...linePaths, ...allPaths }, labels });
    expect(added).toBe(52);
    const a = game.rooms[0]!;
    expect(a.onEnter![0]).toEqual({ say: ['hero', 'Plain line.'], id: 'a.enter.l-plain-line' });
    expect(a.onEnter![9]).toEqual({ if: 'dark', then: [] });
    expect(a.onEnter![13]).toEqual({ minigame: 'mg2' });
    expect(a.onEnter![16]).toEqual({ anim: ['hero', 'nod'] });
    expect(a.onEnter![18]).toEqual({ reveal: true });
    expect(a.onEnter![19]).toEqual({ set: 'x' });
    expect(a.look).toEqual({
      valise: [
        { id: 'a.look-valise.l-old', text: 'Old.' },
        { id: 'look.kept', text: 'Kept.' },
      ],
      cle: 'A single look.',
    });
    expect(game.items.badge!.look).toBe('A badge.');
    expect(game.rules.fallbacks.look).toEqual([{ id: 'fallback.look.l-nothing', text: 'Nothing.' }]);
    expect(game.rules.fallbacks.give).toBeUndefined();
    expect(game.start.intro).toEqual([
      { say: ['hero', 'Hello.'], id: 'game.intro.l-hello' },
      { say: ['hero', 'Hi there'], id: 'game.intro.l-hi-there' },
    ]);
  });

  it('adds nothing on a second pass, and maps every current path to itself', () => {
    for (const lines of [false, true, 'all'] as const) {
      const once = assignIds(idsGame(), { lines }).game;
      const again = assignIds(once, { lines });
      expect(again.game).toEqual(once);
      expect(again.added).toBe(0);
      expect(again.map.seen).toEqual({});
      expect(again.map.counters).toEqual({});
      expect(again.map.labels).toEqual({});
      for (const [k, v] of Object.entries(again.map.paths)) expect(k).toBe(v);
    }
  });

  it('skips the rules generated from exits, and copes with a game without optional lists', () => {
    const g = mini();
    g.rooms[1]!.exits = { gate: { name: 'gate', to: 'a' } };
    g.rooms[1]!.on!.push({ id: 'exit.b.gate.go', verb: ['use'], a: 'gate', do: [{ goto: 'a' }], exit: 'gate' });
    g.rules.fallbacks = {};
    const { game, added } = assignIds(g, { lines: true });
    expect(game.rooms[1]!.on!.map((r) => r.id)).toEqual(['b.use-cle-cadenas', 'exit.b.gate.go']);
    expect(added).toBe(2);
    const bare = mini();
    delete bare.rooms[0]!.on;
    delete bare.rooms[0]!.props;
    expect(assignIds(bare, { lines: 'all' }).added).toBe(5);
  });

  it('names a choice of a game-wide rule with no seen key (it has no room)', () => {
    const g = mini();
    g.rules.on = [{ verb: 'look', a: 'cle', do: [{ choice: [{ text: 'Hm', do: [] }] }] }];
    const { game, map } = assignIds(g);
    const c = game.rules.on![0]!.do[0] as { choice: { id: string }[] };
    expect(c.choice[0]!.id).toBe('game.look-cle.c-hm');
    expect(map.seen).toEqual({});
    expect(map.paths['rules/on[0].do[0].choice[0]']).toBe('rules/on.game.look-cle.do[0].choice.game.look-cle.c-hm');
  });

  it('gives a block with an empty id a fresh one, with no counter to map', () => {
    const g = mini();
    g.rooms[0]!.onEnter = [{ once: ['Hi'], id: '' }];
    const { game, map } = assignIds(g);
    expect(game.rooms[0]!.onEnter![0]).toEqual({ once: ['Hi'], id: 'a.enter.once' });
    expect(map.counters).toEqual({});
  });

  it('gives a fresh id when a written one is taken elsewhere', () => {
    const g = mini();
    g.rooms[1]!.on![0]!.id = 'a.use-cle-valise';
    const { game } = assignIds(g);
    expect(game.rooms[0]!.on![0]!.id).toBe('a.use-cle-valise-2');
  });
});

describe('lineIds, listLines and existingIds', () => {
  it('lists the lines with an id, who says them, and their text', () => {
    expect(lineIds(idsGame())).toEqual([
      { id: 'toast.kept', who: 'hero', text: 'A toast' },
      { id: 'look.kept', who: 'hero', text: 'Kept.' },
      { id: 'hl.kept', who: 'hero', text: 'Z.' },
      { id: 'k.kept', who: 'hero', text: 'Kept kind.' },
    ]);
    const all = lineIds(assignIds(idsGame(), { lines: 'all' }).game);
    expect(all).toHaveLength(40);
    expect(all.slice(0, 5)).toEqual([
      { id: 'a.use-cle-valise.l-opened', who: 'hero', text: 'Opened.' },
      { id: 'a.uncle.the-weather.l-rainy', who: 'hero', text: 'Rainy.' },
      { id: 'clock.l-tick', who: 'hero', text: 'Tick.' },
      { id: 'a.enter.l-plain-line', who: 'hero', text: 'Plain line.' },
      { id: 'a.enter.l-hey-there', who: 'uncle', text: 'Hey there' },
    ]);
    expect(all.map((l) => l.id)).toContain('a.valise.spin.2.l-spin');
    expect(all.map((l) => l.id)).toContain('a.enter.l-bye-line');
    expect(all.find((l) => l.id === 'a.enter.l-look-at-it')).toEqual({
      id: 'a.enter.l-look-at-it',
      who: 'hero',
      text: 'Look at it.',
    });
  });

  it('reads rooms without props, and a malformed block with no lists', () => {
    const g = mini();
    delete g.rooms[1]!.props;
    g.rooms[1]!.onEnter = [{ cycle: undefined, id: 'odd' } as unknown as Cmd, { say: ['ann', 'Hi'], id: 'hi' }];
    expect(lineIds(g)).toEqual([{ id: 'hi', who: 'ann', text: 'Hi' }]);
    expect([...existingIds(g)]).toEqual(['odd', 'hi']);
  });

  it('voices hints with the hint voice', () => {
    const g = idsGame();
    g.hintVoice = 'ann';
    expect(listLines(g)).toEqual([
      { id: 'look.kept', who: 'hero', text: 'Kept.' },
      { id: 'hl.kept', who: 'ann', text: 'Z.' },
      { id: 'k.kept', who: 'hero', text: 'Kept kind.' },
    ]);
    expect(listLines(mini())).toEqual([]);
  });

  it('collects every written id, so new ones never collide', () => {
    expect([...existingIds(idsGame())]).toEqual([
      'a.kept',
      't.kept',
      'ev.kept',
      'drip.w',
      'part.first',
      'toast.kept',
      'cyc.kept',
      'ch.kept',
      'look.kept',
      'hl.kept',
      'k.kept',
      'h.kept',
    ]);
    const all = assignIds(idsGame(), { lines: 'all' }).game;
    const ids = existingIds(all);
    expect(ids.size).toBe(64);
    for (const id of [
      'a.enter.once',
      'a.enter.nth',
      'a.enter.random',
      'a.enter.c-yes-please',
      'a.valise.spin.2.l-spin',
    ])
      expect(ids.has(id)).toBe(true);
    expect([...existingIds(mini())]).toEqual([]);
  });
});

describe('renamePaths', () => {
  const paths = { 'room:a/on[0]': 'room:a/on.r', 'room:a/on[0].do[1]': 'room:a/on.r.do.l', 'start/intro': 'start/x' };
  it('renames by the longest old prefix that ends on a segment, stale keys included', () => {
    expect(
      renamePaths(
        {
          'room:a/on[0]': 'exact',
          'room:a/on[0].do[1]': 'longest',
          'room:a/on[0].do[2]': 'prefix',
          'room:a/on[0][3]': 'bracket',
          'room:a/on[00]': 'no boundary',
          'start/intro[0]': 'intro',
          '_stale:room:a/on[0].do[0]': 'stale',
          '_stale:other': 'stale untouched',
          other: 'untouched',
        },
        paths,
      ),
    ).toEqual({
      'room:a/on.r': 'exact',
      'room:a/on.r.do.l': 'longest',
      'room:a/on.r.do[2]': 'prefix',
      'room:a/on.r[3]': 'bracket',
      'room:a/on[00]': 'no boundary',
      'start/x[0]': 'intro',
      '_stale:room:a/on.r.do[0]': 'stale',
      '_stale:other': 'stale untouched',
      other: 'untouched',
    });
    expect(renamePaths({}, paths)).toEqual({});
    expect(renamePaths({ a: 'b' }, {})).toEqual({ a: 'b' });
  });
});
