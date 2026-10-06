// MCP server (stdio): the Studio operations (tools/studio/core.ts) as Model Context Protocol tools and resources, so
// any AI assistant (Claude Code, Claude Desktop, Cursor, Codex, Gemini CLI…) can read and edit a game the way the
// Studio does. Started by `npm run mcp` in the repository; the game is GAME / GAME_DIR as for every tool (tools/game.ts).
// stdout carries the protocol: everything else goes to stderr. A failing operation is a tool error, never a crash.
import { readFileSync } from 'node:fs';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { GAME, GAME_DIR, ROOT } from '../game';
import { coreBackend } from '../studio/backend';
import { createStudio } from '../studio/core';
import { TOOLS } from '../studio/tools';

// Nothing but JSON-RPC may reach stdout.
console.log = console.error;
console.info = console.error;
console.debug = console.error;

const studio = createStudio({ gameDir: GAME_DIR, root: ROOT });
const DEV_URL = process.env.WEB_SCUMM_DEV_URL?.trim() || 'http://localhost:5173/';

/** The engine's version, read from package.json (4.1.6): the server said 0.1.0 whatever the release. */
const VERSION = String(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version);

const server = new McpServer(
  { name: 'web-scumm', version: VERSION },
  {
    instructions:
      `web-scumm game "${GAME}" (${GAME_DIR}). A game is data: rooms in rooms/<id>.ts, geometry in layout/<id>.json, ` +
      'the script in storyboard.json, a shared log with the human in notes.json. Start with list_rooms and get_room; ' +
      'learn the format with read_doc CONTENT_GUIDE. After any change run validate, then solve, then run_tests. ' +
      'Never invent coordinates: ask the human (add_note) to place things in the Studio. Read AGENTS.md for the rules.',
  },
);

const backend = coreBackend(studio, {
  root: ROOT,
  devUrl: DEV_URL,
  author: () => server.server.getClientVersion()?.name ?? 'ai',
});

// The tools are shared with the Studio's Assistant (tools/studio/tools.ts).
for (const t of TOOLS) {
  server.registerTool(
    t.name,
    {
      title: t.title,
      description: t.description,
      ...(Object.keys(t.input).length ? { inputSchema: t.input } : {}),
      ...(t.output ? { outputSchema: t.output } : {}),
      ...(t.annotations ? { annotations: t.annotations } : {}),
    },
    async (args: unknown) => {
      const r = await t.run(args ?? {}, backend);
      if (r.isError) console.error(`[web-scumm mcp] ${t.name}: ${r.content[0]?.text}`);
      return r;
    },
  );
}

// ------------------------------------------------------------------ resources

server.registerResource(
  'game',
  'webscumm://game',
  {
    title: 'Game overview',
    description: 'list_rooms as a resource (JSON).',
    mimeType: 'application/json',
  },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await studio.gameInfo(), null, 2) }],
  }),
);

server.registerResource(
  'room',
  new ResourceTemplate('webscumm://room/{id}', {
    list: async () => {
      try {
        const g = await studio.gameInfo();
        return {
          resources: g.rooms.map((r) => ({
            uri: `webscumm://room/${r.id}`,
            name: r.name || r.id,
            mimeType: 'application/json',
          })),
        };
      } catch (e) {
        console.error(`[web-scumm mcp] ${(e as Error).message}`);
        return { resources: [] };
      }
    },
  }),
  { title: 'Room', description: 'get_room as a resource (JSON).', mimeType: 'application/json' },
  async (uri, { id }) => ({
    contents: [
      { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await studio.getRoom(String(id)), null, 2) },
    ],
  }),
);

process.on('uncaughtException', (e) => console.error('[web-scumm mcp] uncaught:', e));
process.on('unhandledRejection', (e) => console.error('[web-scumm mcp] unhandled:', e));

await server.connect(new StdioServerTransport());
console.error(`[web-scumm mcp] ready: game "${GAME}" (${GAME_DIR})`);
