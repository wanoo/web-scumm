// A game that passes `npm run validate -- --release` (tests/release-gate.test.ts copies it and breaks one thing at a
// time: no provenance, a placeholder, a translation without line ids). The fixture game with ids on every line.
import type { Cmd, GameDef } from '@engine/core/types';
import { subLists } from '@engine/core/cmds';
import { game as base } from '../../fixture/game';
export { layouts, manifest, minigames } from '../../fixture/index';

const g = structuredClone(base) as GameDef;
let n = 0;
const ids = (list: Cmd[] | undefined): void => list?.forEach((c, i) => {
  if (typeof c === 'string') { list[i] = { say: ['hero', c], id: `line-${++n}` }; return; }
  if ('say' in c || 'toast' in c || 'guide' in c) { (c as { id?: string }).id ??= `line-${++n}`; return; }
  for (const s of subLists(c)) ids(s.list);
});
for (const r of g.rooms) { r.on?.forEach((x) => ids(x.do)); Object.values(r.talk ?? {}).forEach((ts) => ts.forEach((t) => ids(t.do))); ids(r.onEnter); }
ids(g.start.intro);
export const game = g;
