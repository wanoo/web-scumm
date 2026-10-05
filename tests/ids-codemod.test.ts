import { describe, expect, it } from 'vitest';
import { addIdsToGameSource, addIdsToRoomSource, addIdsToRulesSource, roomIdOf } from '../tools/ids/codemod';
import type { GameDef, RoomDef } from '@engine/core/types';

const ROOM_SPREAD = `import { defineRoom } from '@engine/core/define';

export default defineRoom({
  id: 'a',
  name: 'A',
  decor: 'a',
  hotspots: { door: { name: 'door' } },
  on: [
    { verb: 'open', a: 'door', do: ['Locked.', { once: ['First time.'] }] },
    { verb: 'use', a: 'key', b: 'door', do: [{ choice: [{ text: 'Yes', do: [] }, { text: 'No', do: [] }] }] },
    ...EXTRA,
  ],
  talk: { uncle: [{ topic: 'Hi', do: ['Hello.'] }] },
  events: [{ on: 'bell', do: ['Ding.'] }],
  scripts: [{ id: 'clock', do: [{ wait: 1000 }, 'Tick.'] }],
  onEnter: [{ once: ['A room.'] }],
});
`;

const ROOM = ROOM_SPREAD.replace('    ...EXTRA,\n', '');

const room: RoomDef = {
  id: 'a',
  name: 'A',
  decor: 'a',
  on: [
    { id: 'a.open-door', verb: 'open', a: 'door', do: ['Locked.', { id: 'a.open-door.once', once: ['First time.'] }] },
    {
      id: 'a.use-key-door',
      verb: 'use',
      a: 'key',
      b: 'door',
      do: [
        {
          choice: [
            { id: 'a.use-key-door.c-yes', text: 'Yes', do: [] },
            { id: 'a.use-key-door.c-no', text: 'No', do: [] },
          ],
        },
      ],
    },
  ],
  talk: { uncle: [{ id: 'a.uncle.hi', topic: 'Hi', do: ['Hello.'] }] },
  events: [{ id: 'a.on-bell', on: 'bell', do: ['Ding.'] }],
  scripts: [{ id: 'clock', stepIds: ['clock.wait', 'clock.say'], do: [{ wait: 1000 }, 'Tick.'] }],
  onEnter: [{ id: 'a.enter.once', once: ['A room.'] }],
};

describe('the id codemod', () => {
  it("reads the room id and writes ids as first properties, keeping the file's quotes", () => {
    expect(roomIdOf(ROOM)).toBe('a');
    const r = addIdsToRoomSource(ROOM, room);
    expect(r.code).toContain("{ id: 'a.use-key-door', verb: 'use', a: 'key', b: 'door'");
    expect(r.code).toContain("{ id: 'a.open-door.once', once: ['First time.'] }");
    expect(r.code).toContain("{ id: 'a.use-key-door.c-yes', text: 'Yes', do: [] }");
    expect(r.code).toContain("{ id: 'a.uncle.hi', topic: 'Hi'");
    expect(r.code).toContain("{ id: 'a.on-bell', on: 'bell'");
    expect(r.code).toContain("{ stepIds: ['clock.wait', 'clock.say'], id: 'clock'");
    expect(r.code).toContain("onEnter: [{ id: 'a.enter.once', once: ['A room.'] }]");
    expect(r.inserted.map((x) => x.path)).toContain('on[1].do[0].choice[0]');
  });

  it('skips a list with a spread and names what the engine expects', () => {
    const r = addIdsToRoomSource(ROOM_SPREAD, room);
    const skip = r.skipped.find((s) => s.path === 'on');
    expect(skip?.reason).toMatch(/spread/);
    expect(r.inserted.some((x) => x.path.startsWith('on['))).toBe(false);
    expect(addIdsToRoomSource(ROOM, room).skipped).toEqual([]);
  });

  it('does nothing twice', () => {
    const once = addIdsToRoomSource(ROOM, room).code;
    const twice = addIdsToRoomSource(once, room);
    expect(twice.inserted).toEqual([]);
    expect(twice.code).toBe(once);
  });

  it('handles rules.ts and game.ts, multi-line objects included', () => {
    const rules = `export const rules = {\n  fallbacks: {},\n  on: [\n    {\n      verb: 'look',\n      a: 'sky',\n      do: ['Blue.'],\n    },\n  ],\n};\n`;
    const r = addIdsToRulesSource(rules, {
      fallbacks: {},
      on: [{ id: 'game.look-sky', verb: 'look', a: 'sky', do: ['Blue.'] }],
    });
    expect(r.code).toContain("    {\n      id: 'game.look-sky',\n      verb: 'look',");
    const gameSrc = `export const game = defineGame({\n  id: 'g',\n  start: { room: 'a', intro: [{ choice: [{ text: 'Go', do: [] }] }] },\n  events: [{ on: 'x', do: [] }],\n});\n`;
    const g = addIdsToGameSource(gameSrc, {
      start: { room: 'a', intro: [{ choice: [{ id: 'game.intro.c-go', text: 'Go', do: [] }] }] },
      events: [{ id: 'game.on-x', on: 'x', do: [] }],
      rules: { fallbacks: {} },
    } as unknown as GameDef);
    expect(g.code).toContain("{ id: 'game.intro.c-go', text: 'Go', do: [] }");
    expect(g.code).toContain("events: [{ id: 'game.on-x', on: 'x', do: [] }]");
  });
});

describe('line ids in the sources', () => {
  const SRC = `export default defineRoom({
  id: 'b',
  name: 'B',
  decor: 'b',
  on: [
    { id: 'b.open-door', verb: 'open', a: 'door', do: ['Locked.', { say: ['hero', 'Really locked.'] }, { toast: 'Try the key' }] },
  ],
});
`;
  const runtime = (all: boolean): RoomDef => ({
    id: 'b',
    name: 'B',
    decor: 'b',
    on: [
      {
        id: 'b.open-door',
        verb: 'open',
        a: 'door',
        do: [
          all ? { say: ['hero', 'Locked.'], id: 'b.open-door.l-locked' } : 'Locked.',
          { id: 'b.open-door.l-really-locked', say: ['hero', 'Really locked.'] },
          { id: 'b.open-door.l-try-the-key', toast: 'Try the key' },
        ],
      },
    ],
  });
  it('writes the id of each say / toast object, leaving plain strings alone', () => {
    const r = addIdsToRoomSource(SRC, runtime(false), 'b.ts');
    expect(r.inserted.map((x) => x.id)).toEqual(['b.open-door.l-really-locked', 'b.open-door.l-try-the-key']);
    expect(r.code).toContain(
      "do: ['Locked.', { id: 'b.open-door.l-really-locked', say: ['hero', 'Really locked.'] }, { id: 'b.open-door.l-try-the-key', toast: 'Try the key' }]",
    );
  });
  it('with `all`, turns a plain string into a say object carrying its id', () => {
    const r = addIdsToRoomSource(SRC, runtime(true), 'b.ts');
    expect(r.code).toContain(
      "do: [{ say: ['hero', 'Locked.'], id: 'b.open-door.l-locked' }, { id: 'b.open-door.l-really-locked'",
    );
    expect(r.skipped).toEqual([]);
  });
});
