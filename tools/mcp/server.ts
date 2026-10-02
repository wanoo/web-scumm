// MCP server (stdio): the Studio operations (tools/studio/core.ts) as Model Context Protocol tools and resources, so
// any AI assistant (Claude Code, Claude Desktop, Cursor, Codex, Gemini CLI…) can read and edit a game the way the
// Studio does. Started by `npm run mcp` in the repository; the game is GAME / GAME_DIR as for every tool (tools/game.ts).
// stdout carries the protocol: everything else goes to stderr. A failing operation is a tool error, never a crash.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { GAME, GAME_DIR, ROOT } from '../game';
import { createStudio, StudioError } from '../studio/core';
import { buildPrompts } from '../prompts';

// Nothing but JSON-RPC may reach stdout.
console.log = console.error;
console.info = console.error;
console.debug = console.error;

const studio = createStudio({ gameDir: GAME_DIR, root: ROOT });
const DEV_URL = process.env.WEB_SCUMM_DEV_URL?.trim() || 'http://localhost:5173/';
const DOCS = ['CONTENT_GUIDE', 'ENGINE', 'TOOLS', 'STUDIO', 'WORKFLOW'] as const;

const server = new McpServer(
  { name: 'web-scumm', version: '0.1.0' },
  {
    instructions:
      `web-scumm game "${GAME}" (${GAME_DIR}). A game is data: rooms in rooms/<id>.ts, geometry in layout/<id>.json, ` +
      'the script in storyboard.json, a shared log with the human in notes.json. Start with list_rooms and get_room; ' +
      'learn the format with read_doc CONTENT_GUIDE. After any change run validate, then solve, then run_tests. ' +
      'Never invent coordinates: ask the human (add_note) to place things in the Studio. Read AGENTS.md for the rules.',
  },
);

type Content = { type: 'text'; text: string };
type Result = { content: Content[]; isError?: boolean };

const text = (t: string): Result => ({ content: [{ type: 'text', text: t }] });
const json = (v: unknown): Result => text(JSON.stringify(v, null, 2));
const fail = (e: unknown): Result => {
  const msg = e instanceof StudioError ? `${e.message} (status ${e.status})` : e instanceof Error ? e.message : String(e);
  console.error(`[web-scumm mcp] ${msg}`);
  return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
};
/** Runs an operation: its JSON result, or a tool error with the message. */
const run = async (fn: () => Promise<unknown> | unknown): Promise<Result> => {
  try { const r = await fn(); return typeof r === 'string' ? text(r) : json(r); } catch (e) { return fail(e); }
};

const roomId = z.string().describe('Room id, e.g. "house" (see list_rooms).');
const point = z.tuple([z.number(), z.number()]).describe('[x, y] in the logical 640 × 400 room space.');

server.registerTool('list_rooms', {
  title: 'Game overview',
  description: 'The current game: id, title, hero, rooms (id, name, decor), characters, items, verbs, checkpoints ' +
    '(named save states usable by solve and screenshot) and the image ids of the asset manifest with their size. Read-only.',
  annotations: { readOnlyHint: true },
}, () => run(() => studio.gameInfo()));

server.registerTool('get_room', {
  title: 'Read a room',
  description: 'One room: `def` (the RoomDef as loaded: props, actors, hotspots, look lines, reactions `on`, talk, hints, ' +
    'onEnter), `layout` (geometry from layout/<id>.json), `texts` (every editable string literal with its JSON path, ' +
    'value, kind, line and speaker) and `file`. Use the `path` of a text with set_text. Read-only.',
  inputSchema: { id: roomId },
  annotations: { readOnlyHint: true },
}, ({ id }) => run(() => studio.getRoom(id)));

server.registerTool('set_layout', {
  title: 'Write a room layout',
  description: 'Replaces layout/<id>.json with `layout` (the whole Layout object, same shape as get_room returns: ' +
    'props, hotspots, actors, walk, scale, entries…). Read the room first and change only what you must; never invent ' +
    'coordinates the human has not given you.',
  inputSchema: { id: roomId, layout: z.record(z.string(), z.unknown()).describe('The complete Layout object.') },
  annotations: { destructiveHint: true, idempotentHint: true },
}, ({ id, layout }) => run(() => studio.setLayout(id, layout)));

server.registerTool('set_text', {
  title: 'Edit a text of a room',
  description: 'Edits one string literal of rooms/<id>.ts in place, addressed by its path from get_room `texts` ' +
    '(e.g. "look.pantry[1]", "on[3].do[0]", "talk.grandma[0].topic", "hints[2].lines[0]", "props.lamp.name"). ' +
    '`value` replaces the string. `value: null` deletes a list line, or a whole `look.<id>`. A path ending in "[+]" ' +
    'appends a line: "look.piano[+]", "hints[2].lines[+]", "on[3].do[+]" (a bare string in a command list is a hero line). ' +
    'Ids, image refs, flags and conditions are not texts and are refused. Paths after an append or a deletion shift: ' +
    'call get_room again. Result { ok, line, changed } (changed false: the value was already there).',
  inputSchema: {
    id: roomId,
    path: z.string().describe('JSON path of the text under defineRoom({...}); may end in "[+]" to append.'),
    value: z.string().nullable().describe('The new text, or null to delete.'),
  },
  annotations: { destructiveHint: true },
}, ({ id, path, value }) => run(() => studio.setText(id, path, value)));

server.registerTool('add_entity', {
  title: 'Add a prop, hotspot or actor',
  description: 'Adds an entry to rooms/<id>.ts (section created if absent), its optional first look line, and a place ' +
    'in the layout: prop foot at `at` (height 60), hotspot 60 × 60 box centred on `at`, actor feet at `at`. `name` is ' +
    'required for props and hotspots; `img` is a prop image id (list_rooms images); `char` is the actor character id. ' +
    '`at` defaults to [320, 300]: then ask the human (add_note) to drag it in place in the Studio. 409 if the id exists.',
  inputSchema: {
    id: roomId,
    kind: z.enum(['prop', 'hotspot', 'actor']),
    entityId: z.string().describe('The new entity id (letters, digits, _ and -).'),
    name: z.string().optional().describe('Display name.'),
    img: z.string().optional().describe('Prop image id.'),
    char: z.string().optional().describe('Actor character id.'),
    at: point.optional(),
    look: z.string().optional().describe('First look line.'),
  },
  annotations: { destructiveHint: false },
}, ({ id, kind, entityId, name, img, char, at, look }) =>
  run(() => studio.addEntity(id, { kind, id: entityId, name, img, char, at: at ?? [320, 300], look })));

server.registerTool('get_storyboard', {
  title: 'Read the storyboard',
  description: 'storyboard.json: { boards: [...] } with panels, lines, hints and talk topics. The storyboard is the ' +
    'source of truth for text: change it first, then the rooms. Read-only.',
  annotations: { readOnlyHint: true },
}, () => run(() => studio.getStoryboard()));

server.registerTool('set_storyboard', {
  title: 'Write the storyboard',
  description: 'Replaces storyboard.json with `storyboard` (must be { boards: [...] }; send the whole object as read ' +
    'with get_storyboard, modified). Written compactly; an unchanged storyboard is not rewritten. Result { ok, changed }.',
  inputSchema: { storyboard: z.looseObject({ boards: z.array(z.unknown()) }).describe('The whole storyboard.') },
  annotations: { destructiveHint: true, idempotentHint: true },
}, ({ storyboard }) => run(() => studio.setStoryboard(storyboard)));

server.registerTool('get_notes', {
  title: 'Read the notes',
  description: 'notes.json, the shared log between the human and the AI: { entries: [{ id, about, author, text, at }] }. ' +
    'The human answers your questions here. Read-only.',
  annotations: { readOnlyHint: true },
}, () => run(() => studio.getNotes()));

server.registerTool('add_note', {
  title: 'Write a note to the human',
  description: 'Appends a note to notes.json (shown in the Studio Notes tab). Use it when unsure what the human wants, ' +
    'or to ask them to place something. `about` is a room id, a panel id, `room.entity` or free text. `author` ' +
    'defaults to the name of your MCP client.',
  inputSchema: {
    about: z.string().optional().describe('What it is about.'),
    author: z.string().optional().describe('Who writes (default: the MCP client name, or "ai").'),
    text: z.string().describe('The note.'),
  },
}, ({ about, author, text: body }) =>
  run(() => studio.addNote({ about, author: author ?? server.server.getClientVersion()?.name ?? 'ai', text: body })));

server.registerTool('validate', {
  title: 'Validate the game',
  description: 'Static checks: broken ids, missing look lines, flags never set or read, minigame params. ' +
    'Result { ok, errors, warnings, ms }. Run after every content change.',
  annotations: { readOnlyHint: true },
}, () => run(() => studio.validate()));

server.registerTool('solve', {
  title: 'Solve the game',
  description: 'Explores the game states to prove it can be finished, from New Game or from checkpoint `from`. ' +
    'Result { finished, states, truncated, path, roomsReached, flagsReached, itemsNeverUsed, unusedItems, deadEnds, ' +
    'errors, from, ms }. `finished: false` or dead ends are bugs to fix.',
  inputSchema: { from: z.string().optional().describe('Checkpoint id (list_rooms checkpoints).') },
  annotations: { readOnlyHint: true },
}, ({ from }) => run(() => studio.solve(from)));

server.registerTool('screenshot', {
  title: 'Screenshot a room',
  description: 'Renders a room (optionally at a checkpoint) with the real engine through the running dev server ' +
    `(${DEV_URL}, env WEB_SCUMM_DEV_URL; start it with npm run studio or npm run dev) and Playwright. Returns the ` +
    'PNG path (relative to the repository) to open and look at, or an explanation when unavailable.',
  inputSchema: { room: roomId, checkpoint: z.string().optional().describe('Checkpoint id.') },
  annotations: { readOnlyHint: true },
}, async ({ room, checkpoint }) => {
  try {
    await fetch(DEV_URL, { signal: AbortSignal.timeout(3000) });
  } catch {
    return text(`Screenshot unavailable: no dev server at ${DEV_URL}. Ask the human to run "npm run studio" (or set WEB_SCUMM_DEV_URL).`);
  }
  try {
    const r = await studio.screenshot(room, checkpoint, DEV_URL);
    if ('unavailable' in r) return text(`Screenshot unavailable: ${r.reason}`);
    return json({ file: r.file, absolute: join(ROOT, r.file) });
  } catch (e) {
    if (e instanceof Error && /Timeout/i.test(e.message)) {
      return fail(new Error(`${e.message} The page at ${DEV_URL} did not show the engine's editor: is it the dev server of this game ("${GAME}")?`));
    }
    return fail(e);
  }
});

server.registerTool('read_doc', {
  title: 'Read a documentation page',
  description: 'Returns one page of docs/en/: CONTENT_GUIDE (the game format, the DSL of rooms, conditions and ' +
    'commands: read it first), ENGINE, TOOLS, STUDIO or WORKFLOW. Read-only.',
  inputSchema: { name: z.enum(DOCS) },
  annotations: { readOnlyHint: true },
}, ({ name }) => run(() => readFileSync(join(ROOT, 'docs', 'en', `${name}.md`), 'utf8')));

server.registerTool('run_tests', {
  title: 'Run the tests',
  description: 'Runs `npx vitest run` (engine tests and the game walkthrough) and returns the summary lines and the ' +
    'failures. Takes a few seconds to a minute. Read-only.',
  annotations: { readOnlyHint: true },
}, () => new Promise<Result>((done) => {
  execFile('npx', ['vitest', 'run'], { cwd: ROOT, env: { ...process.env, CI: '1', NO_COLOR: '1' }, maxBuffer: 32 * 1024 * 1024, timeout: 10 * 60_000 },
    (err, stdout, stderr) => {
      // eslint-disable-next-line no-control-regex
      const all = `${stdout}\n${stderr}`.replace(/\x1b\[[0-9;]*m/g, '').split('\n');
      const keep = all.filter((l) => /^\s*(Test Files|Tests|Duration|Start at)\b|FAIL|✗|×|AssertionError|Error:/.test(l));
      const summary = (keep.length ? keep : all.slice(-30)).join('\n').trim();
      done(err ? { content: [{ type: 'text', text: summary || err.message }], isError: true } : text(summary));
    });
}));

server.registerTool('asset_prompts', {
  title: 'Art prompts',
  description: 'The image-model prompts for the game\'s art (same as `npm run prompts`): one STYLE block, then one ' +
    'ready-to-paste prompt per sheet (characters with the engine\'s pose rows and special poses, mouth kits, object ' +
    'sheets cell by cell, backgrounds with LOCATION and EMPTY SPOTS, furniture) and a checklist to cut and import them. ' +
    'Hand the sections to the human as-is; never write a sprite prompt by hand. `missing: true` keeps only the sheets ' +
    'with images not cut yet. Returns the markdown, and { missing, sheets } as structured content. Read-only.',
  inputSchema: { missing: z.boolean().optional().describe('Only the sheets with at least one missing image, and only their missing cells.') },
  outputSchema: {
    missing: z.array(z.string()).describe('Image ids the game references that are not in the art folder.'),
    sheets: z.array(z.object({ id: z.string(), kind: z.string(), missing: z.array(z.string()) })),
  },
  annotations: { readOnlyHint: true },
}, async ({ missing }) => {
  try {
    const mod = await studio.loadGame();
    const r = buildPrompts(mod, { gameId: studio.gameId, gameDir: studio.gameDir, root: ROOT, missing });
    return { content: [{ type: 'text' as const, text: r.markdown }], structuredContent: { missing: r.missing, sheets: r.sheets } };
  } catch (e) { return fail(e); }
});

// ------------------------------------------------------------------ resources

server.registerResource('game', 'webscumm://game', {
  title: 'Game overview', description: 'list_rooms as a resource (JSON).', mimeType: 'application/json',
}, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await studio.gameInfo(), null, 2) }] }));

server.registerResource('room', new ResourceTemplate('webscumm://room/{id}', {
  list: async () => {
    try {
      const g = await studio.gameInfo();
      return { resources: g.rooms.map((r) => ({ uri: `webscumm://room/${r.id}`, name: r.name || r.id, mimeType: 'application/json' })) };
    } catch (e) { console.error(`[web-scumm mcp] ${(e as Error).message}`); return { resources: [] }; }
  },
}), { title: 'Room', description: 'get_room as a resource (JSON).', mimeType: 'application/json' },
async (uri, { id }) => ({
  contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await studio.getRoom(String(id)), null, 2) }],
}));

process.on('uncaughtException', (e) => console.error('[web-scumm mcp] uncaught:', e));
process.on('unhandledRejection', (e) => console.error('[web-scumm mcp] unhandled:', e));

await server.connect(new StdioServerTransport());
console.error(`[web-scumm mcp] ready: game "${GAME}" (${GAME_DIR})`);
