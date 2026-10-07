#!/usr/bin/env node
// npm run speedrun:livesplit -- export <run.wsrun> [--names=A,B,…] [--out=<file.lss>]
// npm run speedrun:livesplit -- serve [--port=7778] [--livesplit=ws://127.0.0.1:16834/livesplit]
// (4.1.14 "Time Attack", D23.) `export` writes a LiveSplit splits file from a run: its category, its splits and their
// in-game times as the personal best. `serve` is the autosplitter: the player's page posts its run's events here
// (`?speedrunTool=7778`) and this process drives LiveSplit through LiveSplit's own local WebSocket server (Control →
// Start WebSocket Server): start, split, skip, the in-game time, pause, reset. Local only; nothing goes to the Bridge.
import { readFileSync, writeFileSync } from 'node:fs';
import { arg, clock, localServer } from './local.mjs';

const xml = (s) =>
  String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
/** LiveSplit's time format: `hh:mm:ss.fffffff`. */
const lsTime = (ms) => {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(Math.floor(ms % 1000)).padStart(3, '0')}0000`;
};

/** A LiveSplit splits file (.lss) from a `.wsrun`: one segment per split, its in-game time as the PB. */
export function lssFromRun(envelope, names = []) {
  const segs = envelope.splits.map((s, i) => {
    const ms = s.logicalTime === null ? null : Number(BigInt(s.logicalTime) / 1000n);
    const pb = ms === null ? '' : `<SplitTime name="Personal Best"><GameTime>${lsTime(ms)}</GameTime></SplitTime>`;
    return `    <Segment><Name>${xml(names[i] ?? s.id)}</Name><Icon /><SplitTimes>${pb}</SplitTimes><BestSegmentTime /><SegmentHistory /></Segment>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Run version="1.7.0">',
    '  <GameIcon />',
    `  <GameName>${xml(envelope.gameId)}</GameName>`,
    `  <CategoryName>${xml(envelope.categoryId)}</CategoryName>`,
    '  <Metadata><Run id="" /><Platform usesEmulator="False">Web</Platform><Variables /></Metadata>',
    '  <Offset>00:00:00</Offset>',
    `  <AttemptCount>1</AttemptCount>`,
    '  <AttemptHistory />',
    '  <Segments>',
    ...segs,
    '  </Segments>',
    '  <AutoSplitterSettings />',
    '</Run>',
    '',
  ].join('\n');
}

/** The LiveSplit commands one event of the page turns into (LiveSplit Server's text protocol). */
export function commandsFor(e) {
  const t = e.igtMs !== undefined ? [`setgametime ${clock(e.igtMs)}`] : [];
  switch (e.kind) {
    case 'start':
      return ['reset', 'initgametime', 'starttimer', 'pausegametime', ...t];
    case 'split':
      return [...t, 'split'];
    case 'missed':
      return ['skipsplit'];
    case 'tick':
      return t;
    case 'pause':
      return ['pausegametime'];
    case 'resume':
      return [...t];
    case 'reset':
      return ['reset'];
    default:
      return t;
  }
}

/**
 * The autosplitter: a local server for the page's events and a WebSocket to LiveSplit. Returns the server and a way
 * to wait until LiveSplit is connected (tests use a fake LiveSplit).
 */
export async function startAutosplit({ port = 7778, livesplit = 'ws://127.0.0.1:16834/livesplit' } = {}) {
  let ws = null;
  let queue = [];
  const connect = () =>
    new Promise((ok) => {
      const s = new WebSocket(livesplit);
      s.onopen = () => {
        ws = s;
        for (const c of queue) s.send(c);
        queue = [];
        ok(s);
      };
      s.onclose = () => {
        if (ws === s) ws = null;
      };
      s.onerror = () => ok(null);
    });
  const ready = connect();
  const server = await localServer({
    port,
    onEvent: (e) => {
      for (const c of commandsFor(e)) {
        if (ws && ws.readyState === 1) ws.send(c);
        else queue.push(c);
      }
    },
  });
  return {
    server,
    ready,
    close: () => {
      ws?.close();
      server.close();
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, file] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (cmd === 'export' && file) {
    const env = JSON.parse(readFileSync(file, 'utf8'));
    const names = arg(process.argv, 'names')?.split(',') ?? [];
    const out = arg(process.argv, 'out') ?? file.replace(/\.wsrun$/, '') + '.lss';
    writeFileSync(out, lssFromRun(env, names));
    console.log(`${out}: ${env.splits.length} segments, ${env.categoryId}`);
  } else if (cmd === 'serve') {
    const port = Number(arg(process.argv, 'port') ?? 7778);
    const s = await startAutosplit({ port, livesplit: arg(process.argv, 'livesplit') });
    const ok = await s.ready;
    console.log(
      `Autosplitter: open the game with ?speedrunTool=${s.server.address().port}; LiveSplit ${ok ? 'connected' : 'not reachable yet (start its WebSocket server)'}`,
    );
  } else {
    console.log(
      'usage: speedrun:livesplit -- export <run.wsrun> [--names=…] [--out=…] | serve [--port=7778] [--livesplit=ws://…]',
    );
    process.exit(2);
  }
}
