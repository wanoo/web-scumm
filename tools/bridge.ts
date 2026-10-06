// npm run bridge -- <init|serve|grant|revoke> (4.1.1): the reference Reality Bridge for the current game
// (bridge/src/cli.ts). The game's manifest comes from its content; nothing else of the game reaches the Bridge.
import { realityManifest } from '../src/engine/reality/manifest';
import { main } from '../bridge/src/cli';
import { loadGameModule } from './game';
import { flushExit } from './flush';

const { game } = await loadGameModule();
const code = await main(process.argv.slice(2), { manifest: realityManifest(game) });
await flushExit(code);
