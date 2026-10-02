# MCP: the Studio for any AI assistant

`npm run mcp` starts a [Model Context Protocol](https://modelcontextprotocol.io) server over **stdio** that exposes the
Studio operations (`tools/studio/core.ts`, see STUDIO.md) as tools. Any MCP client (Claude Code, Claude Desktop,
Cursor, Codex CLI, Gemini CLI, a hand-written agent) can then read and edit a game exactly like the Studio does, and
the human sees the result live in `npm run studio` (it watches the files).

- Server: `tools/mcp/server.ts`, SDK `@modelcontextprotocol/sdk` 1.x. Name `web-scumm`.
- Game: `GAME=<id>` (or `GAME_DIR=<folder>`) as for every tool; default `package.json` `config.game`.
- stdout carries the protocol only; logs go to stderr. Use `npm run -s mcp` (silent) in client configs: without `-s`,
  npm prints its `> web-scumm mcp` banner on stdout, which strict clients reject.
- A failing operation (unknown room, bad path, broken edit…) returns a tool error with the message; the server keeps
  running.

## Tools

| Tool | Arguments | Does |
|---|---|---|
| `list_rooms` | | game info: id, title, hero, rooms, characters, items, verbs, checkpoints, images |
| `get_room` | `id` | `{ def, layout, texts, file }`: every editable text with its JSON path |
| `set_layout` | `id, layout` | writes `layout/<id>.json` (the whole Layout) |
| `set_text` | `id, path, value \| null` | replaces a text literal in `rooms/<id>.ts`; `null` deletes a line; a path ending in `[+]` appends (`look.piano[+]`, `on[3].do[+]`) |
| `add_entity` | `id, kind, entityId, name?, img?, char?, at?, look?` | adds a prop / hotspot / actor to the room file and the layout (`at` defaults to `[320, 300]`) |
| `get_storyboard` / `set_storyboard` | `storyboard` | reads / writes `storyboard.json` (`{ boards: [...] }`) |
| `get_notes` / `add_note` | `about?, author?, text` | the shared log `notes.json`; `author` defaults to the MCP client's name, else `ai` |
| `validate` | | `{ ok, errors, warnings, ms }` |
| `solve` | `from?` | proves the game can be finished (from New Game or a checkpoint) |
| `screenshot` | `room, checkpoint?` | PNG of the room under `.cache/studio/`; needs the dev server (`npm run studio`) at `WEB_SCUMM_DEV_URL` (default `http://localhost:5173/`) and Playwright, else says why it is unavailable |
| `read_doc` | `name` | one of `CONTENT_GUIDE`, `ENGINE`, `TOOLS`, `STUDIO`, `WORKFLOW` (docs/en): the agent learns the DSL through MCP |
| `run_tests` | | runs `npx vitest run`, returns the summary and the failures |

Resources: `webscumm://game` (= `list_rooms`) and `webscumm://room/<id>` (= `get_room`), JSON.

## Connect your client

Replace `/path/to/web-scumm` with the absolute path of your clone. `npm --prefix <dir> run -s mcp` runs the script
inside `<dir>` whatever the client's working directory. Add `"env": { "GAME": "<id>" }` to work on another game.

### Claude Code
The repository ships `.mcp.json` (project scope): open Claude Code in the repo and approve the `web-scumm` server.
```json
{ "mcpServers": { "web-scumm": { "type": "stdio", "command": "npm", "args": ["run", "-s", "mcp"], "env": {} } } }
```
Or from the command line, in the repo (`-s local` by default; `-s project` writes `.mcp.json`):
```
claude mcp add web-scumm -- npm run -s mcp
claude mcp add web-scumm -e GAME=demo -- npm --prefix /path/to/web-scumm run -s mcp
```

### Claude Desktop
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json`:
```json
{ "mcpServers": { "web-scumm": { "command": "npm", "args": ["--prefix", "/path/to/web-scumm", "run", "-s", "mcp"] } } }
```
If Claude Desktop does not find `npm` (no shell PATH), put its absolute path (`which npm`) in `command`.

### Cursor
The repository ships `.cursor/mcp.json` (project); the same block in `~/.cursor/mcp.json` works globally with an absolute path:
```json
{ "mcpServers": { "web-scumm": { "command": "npm", "args": ["--prefix", "${workspaceFolder}", "run", "-s", "mcp"] } } }
```

### Codex CLI
`~/.codex/config.toml`:
```toml
[mcp_servers.web-scumm]
command = "npm"
args = ["--prefix", "/path/to/web-scumm", "run", "-s", "mcp"]
# env = { GAME = "demo" }
```

### Gemini CLI
`~/.gemini/settings.json` (or `.gemini/settings.json` in the repo):
```json
{ "mcpServers": { "web-scumm": { "command": "npm", "args": ["run", "-s", "mcp"], "cwd": "/path/to/web-scumm" } } }
```

### Any other client
Command `npm run -s mcp` (or `npx tsx tools/mcp/server.ts`) with the repository as working directory, transport stdio.
Node 22+.

## A typical session
1. `read_doc CONTENT_GUIDE`, `list_rooms`, `get_storyboard`, `get_notes`.
2. Edit: `set_storyboard` first, then `set_text` / `add_entity` in the rooms.
3. `validate`, `solve`, `run_tests`; `screenshot` if the human runs the Studio.
4. `add_note` for anything the human must decide or place; read their answer with `get_notes`.
