#!/usr/bin/env node
// web-scumm-bridge <init|serve|grant|rotate|revoke> (4.1.1): the reference Reality Bridge on its own, for a game that
// is already built: `init --manifest=<game>/dist/reality-manifest.json`, then `serve`. docs/en/REALITY-OPS.md.
import { tsImport } from 'tsx/esm/api';

const { main } = await tsImport('./src/cli.ts', import.meta.url);
process.exitCode = await main(process.argv.slice(2));
