// The graph of walk zones (4.1.11, core/motion.ts): several floors of a room joined by links (stairs, ladders, jumps,
// teleports), searched without a DOM, so the walker and any tool read the same route. The fewest links first, a
// one-way link only forward, a closed link never crossed but named as what blocks.
import { describe, expect, it } from 'vitest';
import { type ZoneLink, zoneRoute } from '@engine/core/motion';

const link = (id: string, a: string, b: string, oneWay = false): ZoneLink => ({
  id,
  from: { zone: a, at: [0, 0] },
  to: { zone: b, at: [10, 10] },
  oneWay,
});
// floor ─stairs─ landing ─ladder─ attic ; floor ─jump(one way)→ attic ; cellar alone
const links = [
  link('stairs', 'floor', 'landing'),
  link('ladder', 'landing', 'attic'),
  link('drop', 'attic', 'floor', true),
];

describe('zoneRoute', () => {
  it('the fewest links, in order, each with its direction', () => {
    const r = zoneRoute(links, 'floor', 'attic');
    expect(r.reached).toBe(true);
    expect(r.chainTo('attic').map((s) => [s.link.id, s.forward])).toEqual([
      ['stairs', true],
      ['ladder', true],
    ]);
    const back = zoneRoute(links, 'attic', 'floor');
    expect(back.chainTo('floor').map((s) => [s.link.id, s.forward])).toEqual([['drop', true]]);
  });

  it('a one-way link is not taken backwards', () => {
    const r = zoneRoute([link('drop', 'attic', 'floor', true)], 'floor', 'attic');
    expect(r.reached).toBe(false);
    expect(r.blocked).toBeUndefined();
  });

  it('a closed link is not crossed: the zones reached, and the link that blocks', () => {
    const r = zoneRoute(links, 'floor', 'attic', (l) => l.id !== 'ladder');
    expect(r.reached).toBe(false);
    expect(r.blocked?.id).toBe('ladder');
    expect([...r.seen].sort()).toEqual(['floor', 'landing']);
    expect(r.chainTo('landing').map((s) => s.link.id)).toEqual(['stairs']);
  });

  it('the same zone: no link; a zone nothing joins: unreached', () => {
    expect(zoneRoute(links, 'floor', 'floor').chainTo('floor')).toEqual([]);
    expect(zoneRoute(links, 'floor', 'cellar').reached).toBe(false);
  });
});
