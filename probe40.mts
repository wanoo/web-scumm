import { proveChapters } from './src/engine/tools/chapters';
import { makeStressGame } from './src/engine/tools/stress';
const { game, layouts } = makeStressGame({ rooms: 40, players: 3, items: 30, flags: 100, npcs: 5, scripts: 10, topics: 40, schemaVersion: 3 } as any);
const t = Date.now();
const p = await proveChapters(game, layouts, { mode: 'prove', maxStates: 50000 });
for (const c of p.chapters) console.log(c.id, c.status, 'from', c.from, 'states', c.states, (c.ms / 1000).toFixed(1) + 's', c.checkpointUnreachable ? 'UNREACHABLE ' + (c.checkpointDiff ?? []).join(', ') : '');
console.log('total', p.status, ((Date.now() - t) / 1000).toFixed(1) + 's');
