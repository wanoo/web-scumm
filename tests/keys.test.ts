// The state's keys (4.1.4, core/keys.ts): one spelling for what `seen` remembers and for a room-scoped key, the same
// bytes 4.0 wrote (a save from before must still read), and placeholders in English with their 4.0 names kept.
import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core/engine';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import { roomKey, seenKey, splitRoomKey } from '@engine/core/keys';
import { fill } from '@engine/core/interactions';
import { mini, miniLayouts } from './fixtures/mini';

describe('keys', () => {
  it('spells what 4.0 spelled, by id or by place', () => {
    expect(seenKey.topic({ id: 't1' }, 'hall', 'cook', 2)).toBe('topic.t1');
    expect(seenKey.topic({}, 'hall', 'cook', 2)).toBe('hall.cook.2');
    expect(seenKey.event({ id: 'e1' }, 'game', 0)).toBe('event.e1');
    expect(seenKey.event({}, 'hall', 3)).toBe('event.hall.3');
    expect(seenKey.choice({ id: 'c1', text: 'Yes' }, 'hall')).toBe('choice.c1');
    expect(seenKey.choice({ text: 'Yes' }, 'hall')).toBe('choice.hall.Yes');
    expect(seenKey.reality('mail.answer.correct')).toBe('reality.mail.answer.correct');
    expect(roomKey('hall', 'lamp')).toBe('hall.lamp');
    expect(splitRoomKey('hall.lamp')).toEqual(['hall', 'lamp']);
    expect(splitRoomKey('hall.a.b')).toEqual(['hall', 'a.b']);
    expect(splitRoomKey('lamp')).toBeNull();
    expect(splitRoomKey('.lamp')).toBeNull();
  });

  it('fills placeholders in English and under their 4.0 names alike', async () => {
    const e = new Engine(mini(), miniLayouts, new FakePresenter(), new MemoryStore());
    await e.newGame();
    const a = 'door';
    const name = e.nameOf(a, e.room());
    expect(name).toBeTruthy();
    expect(fill(e, '{item}|{objet}|{name}|{nom}|{target}|{cible}|{other}', a)).toBe(
      `${name}|${name}|${name}|${name}|||{other}`,
    );
    expect(fill(e, '{item} on {target}', a, a)).toBe(`${name} on ${name}`);
  });
});
