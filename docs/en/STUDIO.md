# Studio: local WYSIWYG authoring, and the open door for any AI

`npm run studio` starts the dev server with the Studio at `/__studio/`. Nothing leaves your machine: every change is
written to files under `games/<id>/`, the same files an AI assistant or a teammate edits with git. The Studio shows the
real engine (the room rendered by `src/engine/dom`), so what you see is what players get.

## Layout of the Studio
- **Rooms** (default tab): the room rendered by the engine with the placement editor on top (drag zones, feet, heights,
  approach points, walk area, scale lines, entries), the list of the room's props / actors / hotspots on the right.
  Selecting one (in the list or in the view) opens its sheet: name, kind, states, visibility, **look lines** (add, edit,
  delete), **reactions** (verb, targets, condition, commands as a list of lines: texts editable, other commands shown),
  **talk topics**; under the view, the room's name, **hints** and **on enter** lines. A text is saved when the field
  loses focus (Enter); Escape cancels. Each save shows a toast and runs Check in the background; a placement in
  progress in the view is saved first (the view reloads when the room file changes). Text edits are written into `rooms/<room>.ts`
  in place (string literals replaced through the TypeScript parser; the file stays readable code). "Add prop / hotspot /
  actor" creates the entry in the room file and places it in the layout.
- **Storyboard**: boards and panels of `storyboard.json`, preview composed from the room decor and the speakers' portraits,
  a notes box per panel. (For now: the list of boards.)
- **Check**: the validator and the solver run after every save; their output and the solver path are shown here.
  "Screenshot" renders a room at a checkpoint (needs Playwright).
- **Notes**: a shared log (`games/<id>/notes.json`), one entry per author ("you", or the AI's name), per panel / room / id.
  (For now: the list and a form to add a note.)

## The API (`/__studio/api/*`, JSON, dev server only)
All paths are relative to the current game (`GAME`). Errors return `{ error }` with a 4xx/5xx status (400 bad input,
404 unknown room / path / endpoint, 405 wrong method, 409 already exists, 422 no `defineRoom({...})` in the file,
500 the game does not load or an edit would break the file, 501 screenshot unavailable).

| Method, path | Body → Result |
|---|---|
| GET `game` | `{ id, title, hero, rooms: [{ id, name, decor }], characters: { id: { name, color, portrait } }, items: { id: { name, icon } }, verbs, checkpoints, images }` (from the game module; `images` is the asset manifest, id → `[w, h]`, thumbnails at `/assets/img/<id>.webp`) |
| GET `room/:id` | `{ def: RoomDef, layout: Layout, texts: TextRef[], file }` — `TextRef = { path, value, file, line, kind, who? }` for every text literal of the room file (see "Texts" below) |
| PUT `room/:id/layout` | `Layout` → writes `layout/<id>.json`; `{ ok }` |
| PUT `room/:id/text` | `{ path, value }` → replaces that string literal in `rooms/<id>.ts`; `value: null` deletes a list line (or a whole `look.<id>`); a path ending in `[+]` appends a line (`look.piano[+]`, `hints[2].lines[+]`, `on[3].do[+]`); result `{ ok, line, changed }` (`changed: false` when the value was already there: nothing is written) |
| POST `room/:id/add` | `{ kind: 'prop' \| 'hotspot' \| 'actor', id, name?, img?, char?, at: [x, y], look? }` → inserts the entry in the room file (the section is created if absent), the optional first look line, and a place in the layout (prop: foot at `at`, height 60; hotspot: 60 × 60 box centred on `at`; actor: feet at `at`); `{ ok, line, changed }`. `name` is required for props and hotspots |
| GET/PUT `storyboard` | `storyboard.json` (`{ boards: [] }` if absent). PUT needs `{ boards: [...] }`, returns `{ ok, changed }`: an unchanged storyboard is not rewritten, a changed one is written compactly (what fits on 120 columns stays on one line) |
| GET `notes`, POST `notes` | GET → `{ entries: Note[] }`; POST `{ about?, author?, text }` → the new `Note = { id, about, author, text, at }` (author defaults to `you`, `at` is an ISO date), appended to `notes.json` (created on first write) |
| POST `validate` | → `{ ok, errors: string[], warnings: string[], ms }` |
| POST `solve` | `{ from?: checkpoint }` → `{ finished, states, truncated, path, roomsReached, unlockedReached, flagsReached, itemsNeverUsed, unusedItems, deadEnds: [{ room, inventory, path }], errors, from, ms }` (400 for an unknown checkpoint) |
| POST `screenshot` | `{ room, checkpoint? }` → `{ file, url }`: a PNG of the room (editor overlays hidden) under `.cache/studio/<game>-<room>[-<checkpoint>].png`, served at `url` (`GET screenshots/<name>.png`). 501 `{ unavailable: true, reason, error }` if Playwright or its Chromium is missing |
| GET `events` | server-sent events: `{ type: 'hello', game }` on connection, then `{ type: 'changed', file }` when a file of the game folder changes on disk (`file` relative to it, e.g. `rooms/house.ts`; dotfiles and `private/` are ignored; 150 ms debounce per file) |

The same operations exist as plain functions in `tools/studio/core.ts`, used by the Vite plugin, by the tests and by
the MCP server: `gameInfo()`, `getRoom(id)`, `setLayout(id, layout)`, `setText(id, path, value)`, `addEntity(id, e)`,
`getStoryboard()`, `setStoryboard(sb)`, `getNotes()`, `addNote(n)`, `validate()`, `solve(from?)`,
`screenshot(room, checkpoint, devServerUrl)` for the current game, and `createStudio({ gameDir, root, importFresh })`
for any other game folder. They never exit the process: errors are thrown as `StudioError` (with `status`). The game is
re-imported on every call so that edits on disk are seen: by default with tsx's scoped loader (fast, in process);
`importInChild` (a child node + tsx process) is the fallback where in-process imports are cached, e.g. inside Vitest.
Writes are serialized. Shared types are in `tools/studio/types.ts`.

### Texts
A string literal under `defineRoom({...})` is a text, addressed by its JSON path, when the path ends in `name`, `topic`,
`toast`, `lines[n]`, `say[1]`, `shout[1]`, `guide.say`, `choice[n].text`, `look.<id>` or `look.<id>[n]`, or when it is a
bare string in a command list (`do`, `once`, `then`, `else`, `cutscene`, `after`, `onEnter`, or a branch of `nth`,
`cycle`, `random`, `parallel`): those are hero lines. `kind` says which (`name`, `look`, `say`, `hero`, `topic`, `hint`,
`toast`, `choice`, `guide`); `who` is the speaker of a `say`. Ids, image refs, flags and conditions are never texts, and
the API refuses to edit them. A replacement touches only the literal (same quote style, escaped as needed); an append
follows the list's layout (inline, or one item per line with the same indentation); a deletion removes the item and
its separator. Paths of the following items shift after an append or a deletion: read the room again.

### Serving
The Studio page is `studio.html` at the repository root (entry `src/studio/main.ts`). Any dev server serves it at
`/__studio/` (`npm run dev` too); `npm run studio` also opens it. A production build leaves it out unless `STUDIO=1`.
The Rooms tab shows `/?edit=<room>&at=<checkpoint>` in an iframe and talks to the editor through `postMessage`
(see TOOLS.md, "The placement editor"). The Studio page ignores Vite's full reloads caused by game files (the engine
view reloads, the Studio keeps what you are typing and follows the change through `events`).

## Any AI, not one AI
- `AGENTS.md` at the repo root is the vendor-neutral operating manual (`CLAUDE.md` points to it).
- `npm run mcp` starts a Model Context Protocol server (stdio) exposing the API above as tools: `list_rooms`, `get_room`,
  `set_layout`, `set_text`, `add_entity`, `get_storyboard`, `set_storyboard`, `get_notes`, `add_note`, `validate`,
  `solve`, `screenshot`. Claude Code, Cursor, Codex, Gemini CLI, or a hand-written agent connect to it the same way
  (`docs/en/MCP.md` has the two-line config for each).
- An AI without MCP still works: it edits the files, the Studio reloads (file watcher), the human sees the result,
  answers in Notes or in the Storyboard, and the AI reads `notes.json` back. Git carries the history.
