// A game whose only chapter checkpoint names a state the content cannot reach: `solve --prove --chapters` must fail
// in every output (text and --json), exit 1, status `checkpoint_mismatch` (tests/tooling.test.ts).
import type { GameDef } from '@engine/core/types';
import { game as base } from '../../fixture/game';
export { layouts, manifest, minigames } from '../../fixture/index';

const g = structuredClone(base) as GameDef;
// The ending needs `!bogus`: nothing sets `bogus`, so no reachable state has it, yet the checkpoint claims it.
const garden = g.rooms.find((r) => r.id === 'garden')!;
garden.on = garden.on!.map((r) => (r.a === 'key' && r.b === 'shed' ? { ...r, if: '!bogus' } : r));
g.checkpoints = { free: { ...(g.checkpoints?.free ?? { room: 'house' }), flags: { bogus: true }, goals: [{ has: 'talkie' }] } };
export const game = g;
