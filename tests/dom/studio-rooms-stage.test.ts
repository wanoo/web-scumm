// @vitest-environment happy-dom
// The Rooms tab's stage editor (src/studio/rooms-stage.ts, 4.1.11): layers edited in place (depth, parallax, opacity,
// blend), an occlusion mask and a walk zone drawn as polygons on the backdrop, a link (portal) between two zones; a
// polygon that closes no surface is not kept, a zone without a portal keeps Save disabled (what the validator would
// refuse), and Save writes the stage geometry over the room's latest layout once the placement view is flushed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Layout, Point, RoomDef } from '@engine/core/types';
import { type Api, type RoomData, serverApi, useApi } from '../../src/studio/api';
import { StageEditor } from '../../src/studio/rooms-stage';

const def = {
  id: 'hall',
  name: 'Hall',
  decor: 'd/hall',
  stage: { layers: [{ id: 'plant', image: 'l/plant', role: 'foreground' }] },
} as unknown as RoomDef;
const floor: Point[] = [
  [0, 300],
  [640, 300],
  [640, 400],
  [0, 400],
];
const layout = (): Layout => ({
  entries: { default: [320, 360] },
  props: { vase: { x: 100, y: 300, h: 40 } },
  walkZones: { floor: { area: floor } },
});
const data = (): RoomData => ({ def, layout: layout(), texts: [], file: 'games/x/rooms/hall.ts' });

const setLayout = vi.fn(async (_id: string, _l: Layout) => ({ ok: true as const }));
// The room as the placement view left it: a prop moved meanwhile, which the stage editor must keep.
const room = vi.fn(async () => ({ ...data(), layout: { ...layout(), props: { vase: { x: 140, y: 300, h: 40 } } } }));

function setup() {
  const host = {
    room: () => 'hall',
    data: () => current,
    flushEditor: vi.fn(async () => {}),
    written: vi.fn(),
  };
  let current: RoomData | null = data();
  const ed = new StageEditor(host);
  document.body.append(ed.el);
  ed.load();
  // The surface is 640 × 400 pixels at the page's corner: a click's coordinates are the room's.
  vi.spyOn(ed.el.querySelector('svg')!, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 640,
    height: 400,
  } as DOMRect);
  return { ed, host };
}
const button = (ed: StageEditor, text: string) =>
  [...ed.el.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement;
const tapAt = (ed: StageEditor, ...pts: Point[]) => {
  for (const [x, y] of pts)
    ed.el.querySelector('svg')!.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y }));
};

describe('the stage editor', () => {
  beforeEach(() => {
    useApi({ ...serverApi, mode: 'server', setLayout, room } as Api);
    setLayout.mockClear();
  });
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('lists the layers (the backdrop and the stage’s) and edits their depth, parallax, opacity and blend', () => {
    const { ed } = setup();
    expect([...ed.el.querySelectorAll('[data-layer]')].map((l) => l.getAttribute('data-layer'))).toEqual([
      'decor',
      'plant',
    ]);
    const input = (label: string) => ed.el.querySelector<HTMLInputElement>(`input[aria-label="plant ${label}"]`)!;
    for (const [label, v] of [
      ['z', '12'],
      ['parallax x', '1.3'],
      ['opacity', '2'],
    ] as const) {
      input(label).value = v;
      input(label).dispatchEvent(new Event('change'));
    }
    const blend = ed.el.querySelector<HTMLSelectElement>('select[aria-label="plant blend"]')!;
    blend.value = 'screen';
    blend.dispatchEvent(new Event('change'));
    expect(ed.draft.layers?.plant).toEqual({ z: 12, parallax: [1.3, 1], opacity: 1, blend: 'screen' });
  });

  it('a mask drawn on the backdrop: an unclosed polygon is refused, a closed one is kept at a depth', () => {
    const { ed } = setup();
    button(ed, 'Draw a mask').click();
    tapAt(ed, [10, 10], [20, 20], [30, 30]); // a line
    button(ed, 'Close the polygon').click();
    expect(ed.el.textContent).toContain('does not close a surface');
    expect(ed.draft.occluders).toBeUndefined();
    tapAt(ed, [5, 40]); // now a surface
    button(ed, 'Close the polygon').click();
    expect(ed.draft.occluders).toEqual({
      mask1: {
        polygon: [
          [10, 10],
          [20, 20],
          [30, 30],
          [5, 40],
        ],
        z: 300,
      },
    });
    expect(ed.el.querySelector('polygon[data-mask="mask1"]')).not.toBeNull();
  });

  it('a second zone without a portal keeps Save disabled; a link between the two enables it; Save writes', async () => {
    const { ed, host } = setup();
    button(ed, 'Draw a zone').click();
    tapAt(ed, [0, 100], [200, 100], [200, 150], [0, 150]);
    button(ed, 'Close the polygon').click();
    expect(Object.keys(ed.draft.walkZones!)).toEqual(['floor', 'zone1']);
    expect(ed.issues()).toEqual([
      'no walk link (portal) joins walk zone "floor" to another',
      'no walk link (portal) joins walk zone "zone1" to another',
    ]);
    expect(button(ed, 'Save stage').disabled).toBe(true);
    // A link: from the floor to the new zone, stairs, its two ends clicked.
    const mode = ed.el.querySelector<HTMLSelectElement>('select[aria-label="Link to"]')!;
    mode.value = 'zone1';
    mode.dispatchEvent(new Event('change'));
    button(ed, 'Link them').click();
    tapAt(ed, [100, 320], [100, 140]);
    expect(ed.draft.walkLinks).toEqual({
      link1: { from: { zone: 'floor', at: [100, 320] }, to: { zone: 'zone1', at: [100, 140] }, mode: 'stairs' },
    });
    expect(ed.issues()).toEqual([]);
    expect(button(ed, 'Save stage').disabled).toBe(false);
    await ed.save();
    expect(host.flushEditor).toHaveBeenCalled();
    const [id, written] = setLayout.mock.calls[0]!;
    expect(id).toBe('hall');
    expect(written.props?.vase?.x).toBe(140); // the view's move, kept
    expect(Object.keys(written.walkZones!)).toEqual(['floor', 'zone1']);
    expect(written.walkLinks?.link1?.mode).toBe('stairs');
    expect(host.written).toHaveBeenCalled();
  });

  it('a mask already in the layout that closes no surface is said, and Save stays off until it is deleted', () => {
    const { ed } = setup();
    ed.draft.occluders = {
      bad: {
        polygon: [
          [0, 0],
          [5, 5],
          [10, 10],
        ],
        z: 200,
      },
    };
    ed.render();
    expect(ed.el.querySelector('.issues')?.textContent).toContain('mask "bad": the polygon does not close a surface');
    expect(button(ed, 'Save stage').disabled).toBe(true);
    (ed.el.querySelector('li[data-mask="bad"] button') as HTMLButtonElement).click();
    expect(button(ed, 'Save stage').disabled).toBe(false);
  });
});
