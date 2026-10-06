// Walk zones and links (3.4): several floors joined by stairs, ladders, jumps or teleports; a closed link stops the
// walk, never the action (lint `walk-link-gate` keeps the rules honest); each zone its own depth scale.
import { describe, expect, it } from 'vitest';
import type { GameDef, Layout } from '@engine/core/types';
import { WalkTopology } from '@engine/dom/walk';
import { lintContent } from '@engine/tools/lint';
import { game as fixture, layouts as fixtureLayouts } from './fixture';

const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const layout: Layout = {
  entries: { default: [100, 360] },
  scale: [
    [300, 0.6],
    [400, 1],
  ],
  walkZones: {
    floor: { area: rect(0, 300, 640, 400) },
    balcony: {
      area: rect(400, 100, 640, 160),
      scale: [
        [100, 0.4],
        [160, 0.5],
      ],
    },
    roof: { area: rect(500, 20, 640, 60) },
  },
  walkLinks: {
    stairs: { from: { zone: 'floor', at: [420, 310] }, to: { zone: 'balcony', at: [420, 150] }, mode: 'stairs' },
    ladder: {
      from: { zone: 'balcony', at: [620, 110] },
      to: { zone: 'roof', at: [620, 50] },
      mode: 'ladder',
      ms: 1500,
    },
  },
};
const room = {
  id: 'yard',
  name: 'Yard',
  decor: 'd/yard',
  stage: { links: { ladder: { if: 'ladder_down', locked: 'The ladder is up.' } } },
} as GameDef['rooms'][number];

describe('walk topology', () => {
  const t = new WalkTopology(layout, room);
  it('a path across floors: walk to the stairs, take them, walk on', () => {
    const { steps, blocked } = t.route([100, 360], [600, 120]);
    expect(blocked).toBeUndefined();
    const vias = steps.filter((s) => s.via).map((s) => s.via!.id);
    expect(vias).toEqual(['stairs']);
    expect(steps[steps.length - 1].to).toEqual([600, 120]);
    expect(steps.find((s) => s.via)!.via).toMatchObject({ mode: 'stairs', ms: 900 });
  });
  it('a closed link is not crossed: the walk stops at its foot and says which link', () => {
    const { steps, blocked } = t.route([100, 360], [600, 40], (l) => l.id !== 'ladder');
    expect(blocked?.id).toBe('ladder');
    expect(blocked?.locked).toBe('The ladder is up.');
    expect(steps[steps.length - 1].to).toEqual([620, 110]);
    const open = t.route([100, 360], [600, 40]);
    expect(open.steps.filter((s) => s.via).map((s) => s.via!.id)).toEqual(['stairs', 'ladder']);
  });
  it('each zone scales characters by its own depth line; the zone of a point', () => {
    expect(t.zoneAt([500, 130])?.id).toBe('balcony');
    expect(t.scaleAt([500, 160])).toBeCloseTo(0.5);
    expect(t.scaleAt([100, 400])).toBeCloseTo(1);
    expect(t.clamp([100, 250])[1]).toBeGreaterThanOrEqual(300);
  });
  it('an old layout is one zone', () => {
    const old = new WalkTopology({ walk: { area: rect(0, 300, 640, 400) } });
    expect(old.zones.map((z) => z.id)).toEqual(['main']);
    expect(old.route([10, 310], [600, 390]).steps).toEqual([{ to: [600, 390] }]);
  });
});

describe('lint: a gated link and the rules behind it', () => {
  it("warns when a target behind a closed link has a rule that does not check the link's condition", () => {
    const g = structuredClone(fixture) as GameDef;
    const r = g.rooms[0];
    r.stage = { links: { ladder: { if: 'ladder_down' } } };
    r.hotspots = { ...r.hotspots, chimney: { name: 'chimney' } };
    r.on = [
      ...(r.on ?? []),
      { verb: 'look', a: 'chimney', do: ['Soot.'] },
      { verb: 'use', a: 'chimney', if: { all: ['ladder_down', 'x'] }, do: ['Up.'] },
    ];
    const L = {
      ...fixtureLayouts[r.id],
      walkZones: layout.walkZones,
      walkLinks: layout.walkLinks,
      entries: { ...fixtureLayouts[r.id]?.entries, default: [100, 360] as [number, number] },
      hotspots: {
        ...fixtureLayouts[r.id]?.hotspots,
        chimney: {
          rect: [580, 0, 40, 40] as [number, number, number, number],
          approach: [600, 40] as [number, number],
        },
      },
    };
    const f = lintContent(g, { ...fixtureLayouts, [r.id]: L }).findings.filter((x) => x.code === 'walk-link-gate');
    expect(f).toHaveLength(1);
    expect(f[0].message).toContain('"chimney" stands behind the walk link "ladder"');
  });
});
