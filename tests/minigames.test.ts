import { describe, expect, it } from 'vitest';
import { fits, makeGrid, opens } from '@engine/minigames/pipes';

describe('pipes minigame', () => {
  it('every grid has a solvable path, never solved at the start', () => {
    for (let n = 0; n < 200; n++) {
      const cols = 3 + (n % 3),
        rows = 3;
      const g = makeGrid(cols, rows);
      const path = g.flat().filter((c) => c.need);
      expect(path.length).toBeGreaterThanOrEqual(cols);
      expect(path.every((c) => !fits(c))).toBe(true);
      // every tile on the path has a correct orientation
      for (const c of path)
        expect([0, 1, 2, 3].some((r) => c.need!.every((d) => opens(c.kind, r).includes(d)))).toBe(true);
      // the path enters at the left of the middle row and exits at the right of the same row
      expect(g[1][0].need).toContain('L');
      expect(g[1][cols - 1].need).toContain('R');
    }
  });
});

// ------------------------------------------------------------------ minimal DOM (node environment, no dependency)

import { afterEach, beforeEach, vi } from 'vitest';
import { PLUG_H, SOCKET_TOL } from '@engine/minigames/cables';
import { pick } from '@engine/minigames/pick';
import { hide } from '@engine/minigames/hide';
import { runner } from '@engine/minigames/runner';
import type { MinigameCtx } from '@engine/minigames/types';

class FakeEl {
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  style: Record<string, string> = {};
  className = '';
  src = '';
  alt = '';
  type = '';
  draggable = true;
  textContent = '';
  offsetWidth = 10;
  private ls: Record<string, ((e: unknown) => void)[]> = {};
  private cls = new Set<string>();
  classList = {
    add: (c: string) => this.cls.add(c),
    remove: (c: string) => this.cls.delete(c),
    toggle: (c: string, on?: boolean) => ((on ?? !this.cls.has(c)) ? this.cls.add(c) : this.cls.delete(c)),
    contains: (c: string) => this.cls.has(c),
  };
  constructor(public tagName: string) {}
  set innerHTML(v: string) {
    this.children = [];
    this.textContent = v;
  }
  get innerHTML() {
    return this.textContent;
  }
  append(...c: FakeEl[]) {
    for (const x of c) {
      x.parent = this;
      this.children.push(x);
    }
  }
  prepend(...c: FakeEl[]) {
    for (const x of c) {
      x.parent = this;
      this.children.unshift(x);
    }
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this);
    this.parent = null;
  }
  setAttribute() {
    /* nothing */
  }
  addEventListener(t: string, f: (e: unknown) => void) {
    (this.ls[t] ??= []).push(f);
  }
  fire(t: string, e: unknown = {}) {
    for (const f of this.ls[t] ?? []) f(e);
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 640, height: 400, x: 0, y: 0 };
  }
  all(): FakeEl[] {
    return this.children.flatMap((c) => [c, ...c.all()]);
  }
}

function fakeCtx(params: Record<string, unknown>, u = 1): { ctx: MinigameCtx; root: FakeEl; said: string[] } {
  const root = new FakeEl('div');
  const said: string[] = [];
  const ctx = {
    root: root as unknown as HTMLElement,
    u,
    img: (id: string) => `img:${id}`,
    size: () => [100, 100] as [number, number],
    sfx: () => {},
    instruct: (t: string) => {
      said.push(t);
    },
    params,
    labels: { skip: 'Skip', jump: 'JUMP', duck: 'DUCK' },
    signal: new AbortController().signal,
  };
  return { ctx, root, said };
}
const settled = (pr: Promise<void>) => {
  let done = false;
  void pr.then(() => {
    done = true;
  });
  return () => done;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('touch minigames', () => {
  beforeEach(() => {
    vi.stubGlobal('document', {
      createElement: (t: string) => new FakeEl(t),
      createElementNS: (_: string, t: string) => new FakeEl(t),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('cables: plug and socket zone >= 44 px CSS at the smallest targeted frame (u = 0.9)', () => {
    expect(PLUG_H * 0.9).toBeGreaterThanOrEqual(44);
    expect(2 * SOCKET_TOL * 0.9).toBeGreaterThanOrEqual(44);
  });

  it('pick: the decoy does not advance the rounds', async () => {
    const { ctx, root } = fakeCtx({
      rounds: [
        { options: ['a', 'b'], answer: 0 },
        { options: ['c', 'd'], answer: 1 },
      ],
      decoy: 'ortie',
      decoyLine: 'That is a nettle!',
    });
    const done = settled(pick.run(ctx));
    await wait(10);
    const box = root.children[0];
    const [grid, shown] = box.children.filter((c) => c.tagName === 'div' && c.className === '');
    const btn = (id: string) => grid.children.find((b) => b.children[0]?.src === `img:${id}`)!;
    btn('ortie').fire('click');
    btn('b').fire('click');
    await wait(700);
    expect(shown.children.length).toBe(0);
    expect(btn('a')).toBeTruthy(); // still the first round
    btn('a').fire('click');
    await wait(700);
    expect(shown.children.length).toBe(1);
    expect(btn('c')).toBeTruthy(); // second round
    btn('d').fire('click');
    await wait(1100);
    expect(done()).toBe(true);
  });

  it('hide: a wrong hiding spot does not end the game, the right one does', async () => {
    const spots = [
      { img: 'x', x: 100, y: 300, h: 80, reply: 'Not there.' },
      { img: 'y', x: 300, y: 300, h: 80 },
      { img: 'z', x: 500, y: 300, h: 80 },
    ];
    const { ctx, root, said } = fakeCtx({ spots, answer: 2 });
    const done = settled(hide.run(ctx));
    const imgs = root.children[0].children.filter((c) => c.tagName === 'img');
    imgs[0].fire('click');
    imgs[1].fire('click');
    await wait(1600);
    expect(done()).toBe(false);
    expect(said).toContain('Not there.');
    imgs[2].fire('click');
    await wait(1600);
    expect(done()).toBe(true);
  });

  it('runner: the chaser never catches up to the runners, even without a single jump', async () => {
    let now = 1000;
    const frames: ((t: number) => void)[] = [];
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (f: (t: number) => void) => {
      frames.push(f);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const u = 0.9;
    const sprites = (k: string) => ({
      run: [`${k}/run1`, `${k}/run2`],
      jump: `${k}/jump`,
      slide: `${k}/slide`,
      stumble: `${k}/stumble`,
    });
    const { ctx, root } = fakeCtx(
      {
        seconds: 20,
        hero: sprites('hero'),
        buddy: { ...sprites('buddy'), h: 110 },
        chaser: { frames: ['ball/1', 'ball/2'] },
        obstacles: { jump: 'obs/low', duck: 'obs/high' },
        bg: 'decor/bg',
      },
      u,
    );
    void runner.run(ctx);
    const box = root.children[0];
    const imgs = box.children.filter((c) => c.tagName === 'img');
    const [ball, buddy, lead] = imgs; // creation order: chaser, second runner, lead runner
    const x = (e: FakeEl) => (parseFloat(e.style.left) + parseFloat(e.style.width) / 2) / u;
    let worst = -Infinity;
    for (let i = 0; i < 20 * 60; i++) {
      now += 1000 / 60;
      const f = frames.shift();
      if (!f) break;
      f(now);
      worst = Math.max(worst, x(ball));
      expect(x(ball)).toBeLessThan(x(buddy));
      expect(x(ball)).toBeLessThan(x(lead));
    }
    expect(worst).toBeGreaterThan(95); // it did get closer (every obstacle missed)…
    expect(worst).toBeLessThanOrEqual(320 - 95); // … but always stays behind the second runner
  });
});

describe('a skip is reported to the host', () => {
  it('skipped() sends a bubbling mg-skip event (App.minigameLog tells a win from a skip by it)', async () => {
    const { skipped } = await import('@engine/minigames/util');
    const host = new EventTarget();
    let seen: Event | null = null;
    host.addEventListener('mg-skip', (e) => {
      seen = e;
    });
    skipped(host as unknown as HTMLElement);
    expect(seen).not.toBeNull();
    expect((seen as unknown as Event).bubbles).toBe(true);
    // the bare element stubs of the tests above have no dispatchEvent: nothing to report, nothing thrown
    expect(() => skipped({} as HTMLElement)).not.toThrow();
  });
});
