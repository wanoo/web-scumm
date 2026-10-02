# Studio: local WYSIWYG authoring, and the open door for any AI

`npm run studio` starts the dev server with the Studio at `/__studio/`. Nothing leaves your machine: every change is
written to files under `games/<id>/`, the same files an AI assistant or a teammate edits with git. The Studio shows the
real engine (the room rendered by `src/engine/dom`), so what you see is what players get.

## Layout of the Studio
- **Rooms** (default tab): the room rendered by the engine with the placement editor on top (drag zones, feet, heights,
  approach points, walk area, scale lines, entries), the list of the room's props / actors / hotspots on the right.
  Selecting one opens its sheet: name, kind, states, visibility, **look lines**, **reactions** (verb, targets, condition,
  commands as a list of lines), **talk topics**, and the room's **hints**. Text edits are written into `rooms/<room>.ts`
  in place (string literals replaced through the TypeScript parser; the file stays readable code). "Add prop / hotspot /
  actor" creates the entry in the room file and places it in the layout.
- **Storyboard**: boards and panels of `storyboard.json`, preview composed from the room decor and the speakers' portraits,
  a notes box per panel.
- **Check**: the validator and the solver run after every save; their output and the solver path are shown here.
  "Screenshot" renders a room at a checkpoint (needs Playwright).
- **Notes**: a shared log (`games/<id>/notes.json`), one entry per author ("you", or the AI's name), per panel / room / id.

## The API (`/__studio/api/*`, JSON, dev server only)
All paths are relative to the current game (`GAME`). Errors return `{ error }` with a 4xx/5xx status.

| Method, path | Body → Result |
|---|---|
| GET `game` | `{ id, title, rooms: [{ id, name, decor }], characters, items, verbs, checkpoints }` (from the game module) |
| GET `room/:id` | `{ def: RoomDef, layout: Layout, texts: TextRef[] }` — `TextRef = { path, value, file, line }` for every string literal of the room file reachable by a JSON path (`look.piano[1]`, `on[3].do[0]`, `talk.grandma[0].topic`, `hints[2].lines[0]`) |
| PUT `room/:id/layout` | `Layout` → writes `layout/<id>.json` |
| PUT `room/:id/text` | `{ path, value }` → replaces that string literal in `rooms/<id>.ts`; result `{ ok, line }` |
| POST `room/:id/add` | `{ kind: 'prop' \| 'hotspot' \| 'actor', id, name, img?, char?, at: [x, y] }` → inserts the entry in the room file and the layout |
| GET/PUT `storyboard` | `storyboard.json` |
| GET `notes`, POST `notes` | `{ entries: Note[] }`; `Note = { id, about, author, text, at }` → appends to `notes.json` |
| POST `validate` | → `{ ok, errors: string[], warnings: string[] }` |
| POST `solve` | `{ from?: checkpoint }` → the solver's JSON result (`path`, `finished`, `deadEnds`, …) |
| POST `screenshot` | `{ room, checkpoint? }` → `{ file }` (PNG written under `.cache/studio/`), 501 if Playwright is missing |
| GET `events` | server-sent events: `{ type: 'changed', file }` when a game file changes on disk (an AI just edited it) |

The same operations exist as plain functions in `tools/studio/core.ts`, used by the Vite plugin, by the tests and by the MCP server.

## Any AI, not one AI
- `AGENTS.md` at the repo root is the vendor-neutral operating manual (`CLAUDE.md` points to it).
- `npm run mcp` starts a Model Context Protocol server (stdio) exposing the API above as tools: `list_rooms`, `get_room`,
  `set_layout`, `set_text`, `add_entity`, `get_storyboard`, `set_storyboard`, `get_notes`, `add_note`, `validate`,
  `solve`, `screenshot`. Claude Code, Cursor, Codex, Gemini CLI, or a hand-written agent connect to it the same way
  (`docs/en/MCP.md` has the two-line config for each).
- An AI without MCP still works: it edits the files, the Studio reloads (file watcher), the human sees the result,
  answers in Notes or in the Storyboard, and the AI reads `notes.json` back. Git carries the history.
