// The printable code wheel (4.1.15, §11.13): the wheel of a seed as pages to print, cut and assemble, in millimetres on
// A4: the large disc (portraits on the rim, the answers' track inside), the small disc (symbols, the windows to cut
// out), and a booklet (assembly, how to read it, the question of this seed and practice questions with their answers
// upside down). A colour version and an economy one (outlines, no fill, grey portraits). Original layout and type: no
// publisher's face, logo, text or symbol. Pure: `tools/code-wheel.ts` writes the SVG pages and, with Pillow, the PDF
// (tools/code-wheel-pdf.py draws the same layout).
import type { CodeWheel, CodeWheelParams } from '../core/remix/code-wheel';
import { readWindow, wheelTable } from '../core/remix/code-wheel';

/** One thing to draw, in millimetres from the page's top-left corner. */
export type Mark =
  | { kind: 'circle'; cx: number; cy: number; r: number; cut?: boolean; fill?: string }
  | {
      kind: 'text';
      x: number;
      y: number;
      text: string;
      size: number;
      rotate?: number;
      anchor?: 'start' | 'middle';
      bold?: boolean;
    }
  | { kind: 'image'; x: number; y: number; w: number; h: number; src: string; label: string }
  | { kind: 'window'; cx: number; cy: number; w: number; h: number; rotate: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; dashed?: boolean };

export interface Page {
  name: string;
  marks: Mark[];
}
export interface PrintLayout {
  title: string;
  seed: string;
  economy: boolean;
  pages: Page[];
}

const W = 210;
const H = 297;
const CX = W / 2;
const CY = 140;

const polar = (deg: number, r: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
};
/** Crop marks at the four corners of the square around a disc of radius r. */
const cropMarks = (r: number): Mark[] =>
  [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ].flatMap(([sx, sy]) => {
    const x = CX + sx! * (r + 3);
    const y = CY + sy! * (r + 3);
    return [
      { kind: 'line' as const, x1: x, y1: y, x2: x + sx! * 5, y2: y },
      { kind: 'line' as const, x1: x, y1: y, x2: x, y2: y + sy! * 5 },
    ];
  });

/** The pages of a wheel. `image(id)` gives a portrait's data URL (or undefined: its name is printed instead). */
export function printLayout(
  w: CodeWheel,
  p: CodeWheelParams,
  o: { title: string; economy?: boolean; image?: (id: string) => string | undefined },
): PrintLayout {
  const economy = !!o.economy;
  const step = 360 / w.n;
  const name = (list: { id: string; label: string }[], id: string) => list.find((x) => x.id === id)?.label ?? id;
  const outer: Mark[] = [
    { kind: 'text', x: CX, y: 18, text: `${o.title} — the large disc`, size: 6, anchor: 'middle', bold: true },
    { kind: 'circle', cx: CX, cy: CY, r: 92, cut: true, fill: economy ? undefined : '#f4e9c8' },
    { kind: 'circle', cx: CX, cy: CY, r: 2.5, cut: true },
    ...cropMarks(92),
  ];
  w.outer.forEach((id, i) => {
    const a = polar(i * step, 76);
    const item = p.actors.find((x) => x.id === id)!;
    const src = item.img ? o.image?.(item.img) : undefined;
    if (src) outer.push({ kind: 'image', x: a.x - 8, y: a.y - 8, w: 16, h: 16, src, label: item.label });
    const l = polar(i * step, 87.5);
    outer.push({ kind: 'text', x: l.x, y: l.y + 1, text: item.label, size: 3.2, anchor: 'middle', rotate: i * step });
    const t = polar(i * step, 54);
    outer.push({
      kind: 'text',
      x: t.x,
      y: t.y + 1.5,
      text: w.track[i]!,
      size: 4.2,
      anchor: 'middle',
      bold: true,
      rotate: i * step,
    });
  });
  const inner: Mark[] = [
    {
      kind: 'text',
      x: CX,
      y: 18,
      text: `${o.title} — the small disc (cut out the windows)`,
      size: 6,
      anchor: 'middle',
      bold: true,
    },
    { kind: 'circle', cx: CX, cy: CY, r: 64, cut: true, fill: economy ? undefined : '#2a4d8f' },
    { kind: 'circle', cx: CX, cy: CY, r: 2.5, cut: true },
    ...cropMarks(64),
  ];
  w.inner.forEach((id, j) => {
    const a = polar(j * step, 40);
    inner.push({
      kind: 'text',
      x: a.x,
      y: a.y + 1.5,
      text: name(p.symbols, id),
      size: 3.6,
      anchor: 'middle',
      bold: true,
      rotate: j * step,
    });
    // The symbol's pointer on the rim: turn it under a character.
    const tip = polar(j * step, 63);
    const base = polar(j * step, 58);
    inner.push({ kind: 'line', x1: base.x, y1: base.y, x2: tip.x, y2: tip.y });
    const win = polar((j + w.windows[j]!) * step, 54);
    // The window shows the large disc's track (radius 54) through the small disc (radius 64).
    inner.push({ kind: 'window', cx: win.x, cy: win.y, w: 16, h: 7, rotate: (j + w.windows[j]!) * step });
    // A thin line ties the window to its symbol, so the reader knows which window belongs to which symbol.
    inner.push({ kind: 'line', x1: a.x, y1: a.y, x2: win.x, y2: win.y, dashed: true });
  });
  const q = `Turn the small disc until ${name(p.symbols, w.challenge.symbol)} sits under ${name(p.actors, w.challenge.actor)}. What does the window of ${name(p.symbols, w.challenge.symbol)} show?`;
  const practice = wheelTable(w)
    .filter((_, i) => i % Math.max(1, w.n - 1) === 0)
    .slice(0, 8);
  const booklet: Mark[] = [
    { kind: 'text', x: 20, y: 24, text: 'The Extremely Legitimate Pirate Check', size: 8, bold: true },
    { kind: 'text', x: 20, y: 32, text: `${o.title} · seed ${w.seed} · wheel v${w.version}`, size: 3.5 },
    {
      kind: 'text',
      x: 20,
      y: 44,
      text: 'A playful reconstruction of the paper code wheels of 1990s adventure games. It protects nothing:',
      size: 3.5,
    },
    {
      kind: 'text',
      x: 20,
      y: 49,
      text: 'the answer is in the game for anyone to read. It is a joke you are in on.',
      size: 3.5,
    },
    { kind: 'text', x: 20, y: 62, text: 'Assembly', size: 5, bold: true },
    ...[
      '1. Cut both discs along their solid circles (the corner marks show the squares to cut first).',
      "2. Cut out the small disc's windows (the outlined rectangles).",
      '3. Pierce both centres, lay the small disc on the large one, fasten them with a paper fastener.',
    ].map((text, i): Mark => ({ kind: 'text', x: 20, y: 70 + i * 6, text, size: 3.5 })),
    { kind: 'text', x: 20, y: 96, text: 'Reading it', size: 5, bold: true },
    {
      kind: 'text',
      x: 20,
      y: 104,
      text: 'Turn the small disc until the symbol sits under the character, then read the window of that symbol.',
      size: 3.5,
    },
    { kind: 'text', x: 20, y: 118, text: "This game's question", size: 5, bold: true },
    { kind: 'text', x: 20, y: 126, text: q, size: 3.5 },
    { kind: 'text', x: 20, y: 142, text: 'Practice', size: 5, bold: true },
    ...practice.map(
      (r, i): Mark => ({
        kind: 'text',
        x: 20,
        y: 150 + i * 6,
        text: `${i + 1}. ${name(p.symbols, r.symbol)} under ${name(p.actors, r.actor)}?`,
        size: 3.5,
      }),
    ),
    {
      kind: 'text',
      x: CX,
      y: 270,
      text: `Answers: ${practice.map((r, i) => `${i + 1}:${readWindow(w, r.actor, r.symbol)}`).join('  ')}`,
      size: 3,
      rotate: 180,
      anchor: 'middle',
    },
  ];
  return {
    title: o.title,
    seed: w.seed,
    economy,
    pages: [
      { name: 'large-disc', marks: outer },
      { name: 'small-disc', marks: inner },
      { name: 'booklet', marks: booklet },
    ],
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** One page as SVG (A4 in millimetres): solid lines to cut, dashed to read, the economy version in outlines only. */
export function pageSvg(page: Page, economy: boolean): string {
  const ink = '#000';
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="Georgia, 'Times New Roman', serif">`,
    `<rect width="${W}" height="${H}" fill="#fff"/>`,
    economy ? '<filter id="grey"><feColorMatrix type="saturate" values="0"/></filter>' : '',
  ];
  for (const m of page.marks) {
    if (m.kind === 'circle')
      out.push(
        `<circle cx="${m.cx.toFixed(2)}" cy="${m.cy.toFixed(2)}" r="${m.r}" fill="${m.fill && !economy ? m.fill : 'none'}" stroke="${ink}" stroke-width="${m.cut ? 0.5 : 0.3}"/>`,
      );
    else if (m.kind === 'line')
      out.push(
        `<line x1="${m.x1.toFixed(2)}" y1="${m.y1.toFixed(2)}" x2="${m.x2.toFixed(2)}" y2="${m.y2.toFixed(2)}" stroke="${economy ? '#999' : ink}" stroke-width="0.3"${m.dashed ? ' stroke-dasharray="1 1"' : ''}/>`,
      );
    else if (m.kind === 'window')
      out.push(
        `<rect x="${(m.cx - m.w / 2).toFixed(2)}" y="${(m.cy - m.h / 2).toFixed(2)}" width="${m.w}" height="${m.h}" rx="1" fill="#fff" stroke="${ink}" stroke-width="0.5" transform="rotate(${m.rotate.toFixed(1)} ${m.cx.toFixed(2)} ${m.cy.toFixed(2)})"/>`,
      );
    else if (m.kind === 'image')
      out.push(
        `<image x="${m.x.toFixed(2)}" y="${m.y.toFixed(2)}" width="${m.w}" height="${m.h}" href="${m.src}"${economy ? ' filter="url(#grey)"' : ''}><title>${esc(m.label)}</title></image>`,
      );
    else {
      const fill = economy || !page.name.includes('small') ? ink : '#fff';
      const rot = m.rotate ? ` transform="rotate(${m.rotate.toFixed(1)} ${m.x.toFixed(2)} ${m.y.toFixed(2)})"` : '';
      out.push(
        `<text x="${m.x.toFixed(2)}" y="${m.y.toFixed(2)}" font-size="${m.size}" text-anchor="${m.anchor ?? 'start'}" fill="${fill}"${m.bold ? ' font-weight="700"' : ''}${rot}>${esc(m.text)}</text>`,
      );
    }
  }
  out.push('</svg>');
  return out.filter(Boolean).join('\n');
}
