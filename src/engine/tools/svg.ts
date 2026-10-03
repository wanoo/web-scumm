// A small layered drawing of a directed graph as SVG, shared by the world map and the puzzle graph. Nodes go in
// columns by distance from the roots (breadth first), edges are Bézier curves with an arrow head. Self-contained.
export interface SvgNode { id: string; label: string; sub?: string; fill?: string; stroke?: string; strokeWidth?: number; title?: string; href?: string; opacity?: number }
export interface SvgEdge { from: string; to: string; dashed?: boolean; title?: string; color?: string; opacity?: number }

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/**
 * `roots`: the nodes of the first column (default: those no edge leads to, else the first node); nodes no root reaches
 * start their own column 0. `layering`: `bfs` puts a node at its distance from the roots (the world map);
 * `longest` at the length of the longest chain leading to it (a puzzle graph: chains spread out instead of piling up).
 */
export function layeredSvg(nodes: SvgNode[], edges: SvgEdge[], opts: { roots?: string[]; width?: number; height?: number; font?: number; layering?: 'bfs' | 'longest' } = {}): string {
  const ids = new Set(nodes.map((n) => n.id));
  const W = opts.width ?? 150, H = opts.height ?? 44, GX = 70, GY = 22, F = opts.font ?? 12;
  const hasIn = new Set(edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to).map((e) => e.to));
  let roots = opts.roots?.filter((r) => ids.has(r)) ?? nodes.filter((n) => !hasIn.has(n.id)).map((n) => n.id);
  if (!roots.length && nodes.length) roots = [nodes[0].id];
  // Discovery order from the roots (then from whatever is left), and the distance from them.
  const dist = new Map<string, number>();
  const order: string[] = [];
  const discover = (starts: string[]) => {
    const queue = starts.filter((r) => !dist.has(r));
    for (const r of queue) dist.set(r, 0);
    while (queue.length) {
      const cur = queue.shift()!;
      order.push(cur);
      for (const e of edges) if (e.from === cur && ids.has(e.to) && !dist.has(e.to)) { dist.set(e.to, dist.get(cur)! + 1); queue.push(e.to); }
    }
  };
  discover(roots);
  for (const n of nodes) if (!dist.has(n.id)) { discover(nodes.filter((x) => !dist.has(x.id) && !hasIn.has(x.id)).map((x) => x.id)); if (!dist.has(n.id)) discover([n.id]); }
  if (opts.layering === 'longest') {
    // Longest path over the edges that go forward in discovery order (the others close cycles).
    const idx = new Map(order.map((id, i) => [id, i]));
    for (const id of order) for (const e of edges) if (e.from === id && ids.has(e.to) && idx.get(e.to)! > idx.get(id)!) dist.set(e.to, Math.max(dist.get(e.to)!, dist.get(id)! + 1));
  }
  const cols = new Map<number, string[]>();
  for (const n of nodes) { const d = dist.get(n.id)!; cols.set(d, [...(cols.get(d) ?? []), n.id]); }
  const pos = new Map<string, [number, number]>();
  let width = 0, height = 0;
  for (const [d, list] of [...cols.entries()].sort((a, b) => a[0] - b[0])) {
    list.forEach((id, i) => pos.set(id, [20 + d * (W + GX), 20 + i * (H + GY)]));
    width = Math.max(width, 20 + d * (W + GX) + W + 20);
    height = Math.max(height, 20 + list.length * (H + GY));
  }
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui, sans-serif" font-size="${F}">`,
    '<defs><marker id="arr" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#888"/></marker></defs>'];
  const drawn = new Set<string>();
  for (const e of edges) {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) continue;
    const k = `${e.from}>${e.to}`;
    if (drawn.has(k)) continue;
    drawn.add(k);
    const [x1, y1] = [a[0] + (b[0] >= a[0] ? W : 0), a[1] + H / 2], [x2, y2] = [b[0] + (b[0] >= a[0] ? 0 : W), b[1] + H / 2];
    out.push(`<path d="M${x1} ${y1} C${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}" fill="none" stroke="${e.color ?? '#888'}" stroke-width="1.5"${e.dashed ? ' stroke-dasharray="5 4"' : ''}${e.opacity !== undefined ? ` opacity="${e.opacity}"` : ''} marker-end="url(#arr)">${e.title ? `<title>${esc(e.title)}</title>` : ''}</path>`);
  }
  for (const n of nodes) {
    const [x, y] = pos.get(n.id)!;
    const g = `<g${n.href ? ` data-node="${esc(n.href)}" style="cursor:pointer"` : ''}${n.opacity !== undefined ? ` opacity="${n.opacity}"` : ''}>${n.title ? `<title>${esc(n.title)}</title>` : ''}<rect x="${x}" y="${y}" width="${W}" height="${H}" rx="8" fill="${n.fill ?? '#f3f4f6'}" stroke="${n.stroke ?? '#aaa'}" stroke-width="${n.strokeWidth ?? 1}"/>` +
      `<text x="${x + 10}" y="${y + 18}" fill="#111" font-weight="600">${esc(n.label)}</text>` +
      (n.sub !== undefined ? `<text x="${x + 10}" y="${y + 34}" fill="#666">${esc(n.sub)}</text>` : '') + '</g>';
    out.push(g);
  }
  out.push('</svg>');
  return out.join('\n');
}
