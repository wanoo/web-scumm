// The Studio's tools, one registry for every AI: the MCP server (tools/mcp/server.ts) registers them for MCP clients,
// the Studio's Assistant runs them in its agentic loop (tools/studio/assistant.ts on the dev server, src/studio/assistant.ts
// in demo mode). A tool is a name, a description, a zod input schema and a handler over a `ToolBackend`: the server binds
// the Studio core (tools/studio/backend.ts), the demo binds the browser backend (src/studio/api-browser.ts).
// No node import here: this file is bundled into the Studio page.
import { z } from 'zod';
import { profileText } from '../../src/engine/tools/solve';
import { dialogueText, dialogueTree } from '../../src/engine/tools/dialogue';
import type { Layout } from '../../src/engine/core/types';
import type { AddEntity, CoverageData, GameInfo, LintData, PlaytestsData, GraphData, PuzzleData, NewNote, NotesFile, ReportData, RoomData, SolveData, ValidateResult } from './types';

/** The operations the tools need. Same method names as the Studio's `Api` (src/studio/api.ts), so `BrowserApi` fits. */
export interface ToolBackend {
  game(): Promise<GameInfo>;
  room(id: string): Promise<RoomData>;
  setLayout(id: string, layout: Layout): Promise<unknown>;
  setText(id: string, path: string, value: string | null): Promise<unknown>;
  add(id: string, e: AddEntity): Promise<unknown>;
  storyboardRaw(): Promise<unknown>;
  setStoryboard(sb: unknown): Promise<unknown>;
  notes(): Promise<NotesFile>;
  addNote(n: NewNote): Promise<unknown>;
  validate(): Promise<ValidateResult>;
  /** `prove`: the exhaustive search (softlocks), slow on a big game. */
  solve(from?: string, prove?: boolean): Promise<SolveData>;
  /** The content profiler (rooms, items, characters: what is thin). */
  report?(): Promise<ReportData>;
  /** The world's map: rooms, exits, gotos, unreachable rooms. */
  graph?(): Promise<GraphData>;
  /** The puzzle graph; `id`: one item / flag / prop card. */
  puzzle?(id?: string): Promise<PuzzleData>;
  /** The storyboard checked against the content. */
  coverage?(): Promise<CoverageData>;
  /** The playtests of games/<id>/playtests replayed and summed up. */
  playtests?(): Promise<PlaytestsData>;
  /** The content lint after a solver run (`prove`: the exhaustive search). */
  lint?(prove?: boolean): Promise<LintData>;
  /** Optional abilities: a tool whose ability is missing is left out of `toolsFor(backend)`. */
  screenshot?(room: string, checkpoint?: string): Promise<ToolResult>;
  readDoc?(name: DocName): Promise<string>;
  runTests?(): Promise<ToolResult>;
  assetPrompts?(missing?: boolean): Promise<{ markdown: string; missing: string[]; sheets: { id: string; kind: string; missing: string[] }[] }>;
  /** Default author of add_note (the MCP client's name, the model's name). */
  author?(): string;
}

export type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

export const DOCS = ['CONTENT_GUIDE', 'ENGINE', 'TOOLS', 'STUDIO', 'WORKFLOW', 'AUDIO', 'UPGRADING', 'CLASSICS'] as const;
export type DocName = (typeof DOCS)[number];

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  /** zod raw shape of the arguments (empty: none). */
  input: z.ZodRawShape;
  output?: z.ZodRawShape;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
  /** It changes a game file (the Studio refreshes after it). */
  writes?: boolean;
  /** The optional backend ability it needs. */
  needs?: 'screenshot' | 'readDoc' | 'runTests' | 'assetPrompts' | 'report' | 'graph' | 'puzzle' | 'coverage' | 'lint' | 'playtests';
  run(args: any, b: ToolBackend): Promise<ToolResult>;
}

export const textResult = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }] });
export const jsonResult = (v: unknown): ToolResult => textResult(JSON.stringify(v, null, 2));
/** A failed operation as a tool error: the message, and the HTTP-like status when there is one. */
export const errorResult = (e: unknown): ToolResult => ({ content: [{ type: 'text', text: `Error: ${errorMessage(e)}` }], isError: true });
export function errorMessage(e: unknown): string {
  const status = (e as { status?: unknown })?.status;
  const msg = e instanceof Error ? e.message : String(e);
  return typeof status === 'number' ? `${msg} (status ${status})` : msg;
}

/** Runs an operation: its result as JSON (a string as is), or a tool error with the message. */
async function op(fn: () => Promise<unknown> | unknown): Promise<ToolResult> {
  try { const r = await fn(); return typeof r === 'string' ? textResult(r) : jsonResult(r); } catch (e) { return errorResult(e); }
}

const roomId = z.string().describe('Room id, e.g. "house" (see list_rooms).');
const point = z.tuple([z.number(), z.number()]).describe('[x, y] in the logical 640 × 400 room space.');

export const TOOLS: ToolDef[] = [
  {
    name: 'list_rooms', title: 'Game overview',
    description: 'The current game: id, title, hero, rooms (id, name, decor), characters, items, verbs, checkpoints ' +
      '(named save states usable by solve and screenshot) and the image ids of the asset manifest with their size. Read-only.',
    input: {}, annotations: { readOnlyHint: true },
    run: (_a, b) => op(() => b.game()),
  },
  {
    name: 'get_room', title: 'Read a room',
    description: 'One room: `def` (the RoomDef as loaded: props, actors, hotspots, look lines, reactions `on`, talk, hints, ' +
      'onEnter), `layout` (geometry from layout/<id>.json), `texts` (every editable string literal with its JSON path, ' +
      'value, kind, line and speaker) and `file`. Use the `path` of a text with set_text. Read-only.',
    input: { id: roomId }, annotations: { readOnlyHint: true },
    run: ({ id }, b) => op(() => b.room(id)),
  },
  {
    name: 'set_layout', title: 'Write a room layout',
    description: 'Replaces layout/<id>.json with `layout` (the whole Layout object, same shape as get_room returns: ' +
      'props, hotspots, actors, walk, scale, entries…). Read the room first and change only what you must; never invent ' +
      'coordinates the human has not given you.',
    input: { id: roomId, layout: z.record(z.string(), z.unknown()).describe('The complete Layout object.') },
    annotations: { destructiveHint: true, idempotentHint: true }, writes: true,
    run: ({ id, layout }, b) => op(() => b.setLayout(id, layout)),
  },
  {
    name: 'set_text', title: 'Edit a text of a room',
    description: 'Edits one string literal of rooms/<id>.ts in place, addressed by its path from get_room `texts` ' +
      '(e.g. "look.pantry[1]", "on[3].do[0]", "talk.grandma[0].topic", "hints[2].lines[0]", "props.lamp.name"). ' +
      '`value` replaces the string. `value: null` deletes a list line, or a whole `look.<id>`. A path ending in "[+]" ' +
      'appends a line: "look.piano[+]", "hints[2].lines[+]", "on[3].do[+]" (a bare string in a command list is a hero line). ' +
      'Ids, image refs, flags and conditions are not texts and are refused. Paths after an append or a deletion shift: ' +
      'call get_room again. Result { ok, line, changed } (changed false: the value was already there).',
    input: {
      id: roomId,
      path: z.string().describe('JSON path of the text under defineRoom({...}); may end in "[+]" to append.'),
      value: z.string().nullable().describe('The new text, or null to delete.'),
    },
    annotations: { destructiveHint: true }, writes: true,
    run: ({ id, path, value }, b) => op(() => b.setText(id, path, value)),
  },
  {
    name: 'add_entity', title: 'Add a prop, hotspot or actor',
    description: 'Adds an entry to rooms/<id>.ts (section created if absent), its optional first look line, and a place ' +
      'in the layout: prop foot at `at` (height 60), hotspot 60 × 60 box centred on `at`, actor feet at `at`. `name` is ' +
      'required for props and hotspots; `img` is a prop image id (list_rooms images); `char` is the actor character id. ' +
      '`at` defaults to [320, 300]: then ask the human (add_note) to drag it in place in the Studio. 409 if the id exists.',
    input: {
      id: roomId,
      kind: z.enum(['prop', 'hotspot', 'actor']),
      entityId: z.string().describe('The new entity id (letters, digits, _ and -).'),
      name: z.string().optional().describe('Display name.'),
      img: z.string().optional().describe('Prop image id.'),
      char: z.string().optional().describe('Actor character id.'),
      at: point.optional(),
      look: z.string().optional().describe('First look line.'),
    },
    annotations: { destructiveHint: false }, writes: true,
    run: ({ id, kind, entityId, name, img, char, at, look }, b) =>
      op(() => b.add(id, { kind, id: entityId, name, img, char, at: at ?? [320, 300], look })),
  },
  {
    name: 'get_storyboard', title: 'Read the storyboard',
    description: 'storyboard.json: { boards: [...] } with panels, lines, hints and talk topics. The storyboard is the ' +
      'source of truth for text: change it first, then the rooms. Read-only.',
    input: {}, annotations: { readOnlyHint: true },
    run: (_a, b) => op(() => b.storyboardRaw()),
  },
  {
    name: 'set_storyboard', title: 'Write the storyboard',
    description: 'Replaces storyboard.json with `storyboard` (must be { boards: [...] }; send the whole object as read ' +
      'with get_storyboard, modified). Written compactly; an unchanged storyboard is not rewritten. Result { ok, changed }.',
    input: { storyboard: z.looseObject({ boards: z.array(z.unknown()) }).describe('The whole storyboard.') },
    annotations: { destructiveHint: true, idempotentHint: true }, writes: true,
    run: ({ storyboard }, b) => op(() => b.setStoryboard(storyboard)),
  },
  {
    name: 'get_notes', title: 'Read the notes',
    description: 'notes.json, the shared log between the human and the AI: { entries: [{ id, about, author, text, at, task? }] }. ' +
      'The human answers your questions here; entries with `task: true` are requests from the human for you to do. Read-only.',
    input: {}, annotations: { readOnlyHint: true },
    run: (_a, b) => op(() => b.notes()),
  },
  {
    name: 'add_note', title: 'Write a note to the human',
    description: 'Appends a note to notes.json (shown in the Studio Notes tab). Use it when unsure what the human wants, ' +
      'or to ask them to place something. `about` is a room id, a panel id, `room.entity` or free text. `author` ' +
      'defaults to the name of your MCP client.',
    input: {
      about: z.string().optional().describe('What it is about.'),
      author: z.string().optional().describe('Who writes (default: the MCP client name, or "ai").'),
      text: z.string().describe('The note.'),
    },
    writes: true,
    run: ({ about, author, text }, b) => op(() => b.addNote({ about, author: author ?? b.author?.() ?? 'ai', text })),
  },
  {
    name: 'validate', title: 'Validate the game',
    description: 'Static checks: broken ids, missing look lines, flags never set or read, minigame params. ' +
      'Result { ok, errors, warnings, ms }. Run after every content change.',
    input: {}, annotations: { readOnlyHint: true },
    run: (_a, b) => op(() => b.validate()),
  },
  {
    name: 'solve', title: 'Solve the game',
    description: 'Explores the game states to prove it can be finished, from New Game or from checkpoint `from`. ' +
      'Result { status, exit, headline, mode, finished, states, truncated, path, roomsReached, flagsReached, itemsNeverUsed, unusedItems, ' +
      'deadEnds, softlocks, errors, from, ms }. `status`/`exit`/`headline` are exactly what `npm run solve` prints (0 solved, 2 truncated: nothing proved, 1 a bug to fix). `prove: true` runs the ' +
      'exhaustive search (softlocks complete). `profile: true` adds why the search is slow or big.',
    input: { from: z.string().optional().describe('Checkpoint id (list_rooms checkpoints).'), profile: z.boolean().optional().describe('Add the solver profile as text: what the states are made of, what the search cost, independent dimensions, monotonic things.'), prove: z.boolean().optional().describe('Exhaustive search: every reachable state and the softlocks (slow on a big game; default: the fast witness).') },
    annotations: { readOnlyHint: true },
    run: ({ from, profile, prove }, b) => op(async () => { const r = await b.solve(from, prove); if (!profile) { const { profile: _p, ...rest } = r; return rest; } return { ...r, profile: r.profile ? profileText(r.profile) : undefined }; }),
  },
  {
    name: 'content_report', title: 'Content profiler',
    description: 'Game-design profiler, as Markdown: per room (zones, props, actors, exits, rules, topics, hints, scripts; ' +
      'things with no look line, verbs that only get fallbacks, props that never change), per item (obtained where, ' +
      'how many rules use it, consumed), per character (rooms, topics, lines, unreachable topics), unreachable rooms and ' +
      'exits with no way back. Read it to decide what to write next. Read-only.',
    input: {}, annotations: { readOnlyHint: true }, needs: 'report',
    run: (_a, b) => op(async () => (await b.report!()).markdown),
  },
  {
    name: 'world_graph', title: 'World map',
    description: 'The rooms and the ways between them (declared exits, goto commands, map places) as a DOT graph, with ' +
      'unreachable rooms and exits with no way back. Read-only.',
    input: {}, annotations: { readOnlyHint: true }, needs: 'graph',
    run: (_a, b) => op(async () => { const g = await b.graph!(); return `${g.dot}\n\nunreachable: ${g.graph.unreachable.join(', ') || 'none'}\none-way: ${g.graph.oneWay.map((e) => `${e.from} → ${e.to} (${e.via})`).join('; ') || 'none'}`; }),
  },
  {
    name: 'dialogue_tree', title: 'Dialogue tree',
    description: 'The conversation of a character in a room as an indented tree: topics (with their conditions), lines, ' +
      'choices and their options, branches. Derived from the talk topics, nothing else to maintain. Read-only.',
    input: { id: z.string().describe('Room id.'), actor: z.string().optional().describe('Actor id (default: every character with topics).') },
    annotations: { readOnlyHint: true },
    run: ({ id, actor }, b) => op(async () => {
      const r = await b.room(id);
      const talk = r.def.talk ?? {};
      const who = actor ? [actor] : Object.keys(talk);
      if (actor && !talk[actor]) return `no topics for "${actor}" in ${id} (${Object.keys(talk).join(', ') || 'none'})`;
      return who.map((a) => `# ${a}\n${dialogueText(dialogueTree(talk[a] ?? [], `talk.${a}`))}`).join('\n\n') || `no conversation in ${id}`;
    }),
  },
  {
    name: 'puzzle_graph', title: 'Puzzle graph',
    description: 'What every rule, topic, script and listener needs (conditions, items) and changes (items, flags, props, ' +
      'places, events). Without `id`: the overview as Markdown (every item and flag with what produces and uses it, flags ' +
      'read but never set, things produced but never used). With `id` (an item, flag, prop, place or event): its card: ' +
      'acquired by, consumed by, used by, requires first, unlocks, downstream. Read it before changing a puzzle. Read-only.',
    input: { id: z.string().optional().describe('An item, flag, prop (room.prop), place or event id; none for the overview.') },
    annotations: { readOnlyHint: true }, needs: 'puzzle',
    run: ({ id }, b) => op(async () => (await b.puzzle!(id)).markdown),
  },
  {
    name: 'storyboard_coverage', title: 'Storyboard coverage',
    description: 'The storyboard (get_storyboard) checked against the content, as Markdown: per board and panel, ' +
      'whether its room, speakers, lines, talk topics, sounds and actions ("Open the armchair", "Use pipe with tank") ' +
      'exist in the game: ok, partial (the pieces exist, no rule answers; a close line), missing, or unknown (prose). ' +
      'Read it to find what of the story is not implemented yet. Read-only.',
    input: {}, annotations: { readOnlyHint: true }, needs: 'coverage',
    run: (_a, b) => op(async () => (await b.coverage!()).markdown),
  },
  {
    name: 'playtests', title: 'Playtests',
    description: 'The sessions players shared from their phones (games/<id>/playtests/*.session.json, ids only) ' +
      'replayed on the current content and summed up, as Markdown: time per room, where players stall (the same ' +
      'action again and again without effect), hints shown, where they stopped, minigames played, sessions the content ' +
      'has outgrown. Read it to know where the game is harder than you think. Read-only.',
    input: {}, annotations: { readOnlyHint: true }, needs: 'playtests',
    run: (_a, b) => op(async () => (await b.playtests!()).markdown),
  },
  {
    name: 'lint', title: 'Content lint',
    description: 'What the validator cannot say and the solver does not say loudly, as Markdown: conditions nothing ' +
      'can satisfy, rules another rule hides, items no rule needs or nothing gives, hints that cannot fire, choices ' +
      'with a dead option, and, from a solver run, live actions never run and rooms never reached. Each finding names ' +
      'its content path, its stable id and what to do. `prove: true` runs the exhaustive search first (slow on a big ' +
      'game). Read it before asking a human for a review. Read-only.',
    input: { prove: z.boolean().optional().describe('Run the exhaustive proof first (default: the fast witness).') },
    annotations: { readOnlyHint: true }, needs: 'lint',
    run: (a, b) => op(async () => (await b.lint!(!!a.prove)).markdown),
  },
  {
    name: 'screenshot', title: 'Screenshot a room',
    description: 'Renders a room (optionally at a checkpoint) with the real engine through the running dev server ' +
      '(default http://localhost:5173/, env WEB_SCUMM_DEV_URL; start it with npm run studio or npm run dev) and Playwright. ' +
      'Returns the PNG path (relative to the repository) to open and look at, or an explanation when unavailable.',
    input: { room: roomId, checkpoint: z.string().optional().describe('Checkpoint id.') },
    annotations: { readOnlyHint: true }, needs: 'screenshot',
    run: async ({ room, checkpoint }, b) => { try { return await b.screenshot!(room, checkpoint); } catch (e) { return errorResult(e); } },
  },
  {
    name: 'read_doc', title: 'Read a documentation page',
    description: 'Returns one page of docs/en/: CONTENT_GUIDE (the game format, the DSL of rooms, conditions and ' +
      'commands: read it first), ENGINE, TOOLS, STUDIO, WORKFLOW, AUDIO (music and effects), UPGRADING (v2 to v3), ' +
      'CLASSICS (the famous mechanics of the genre, each with its DSL: read it before asking for a new command). Read-only.',
    input: { name: z.enum(DOCS) },
    annotations: { readOnlyHint: true }, needs: 'readDoc',
    run: ({ name }, b) => op(() => b.readDoc!(name)),
  },
  {
    name: 'run_tests', title: 'Run the tests',
    description: 'Runs `npx vitest run` (engine tests and the game walkthrough) and returns the summary lines and the ' +
      'failures. Takes a few seconds to a minute. Read-only.',
    input: {}, annotations: { readOnlyHint: true }, needs: 'runTests',
    run: async (_a, b) => { try { return await b.runTests!(); } catch (e) { return errorResult(e); } },
  },
  {
    name: 'asset_prompts', title: 'Art prompts',
    description: 'The image-model prompts for the game\'s art (same as `npm run prompts`): one STYLE block, then one ' +
      'ready-to-paste prompt per sheet (characters with the engine\'s pose rows and special poses, mouth kits, object ' +
      'sheets cell by cell, backgrounds with LOCATION and EMPTY SPOTS, furniture) and a checklist to cut and import them. ' +
      'Hand the sections to the human as-is; never write a sprite prompt by hand. `missing: true` keeps only the sheets ' +
      'with images not cut yet. Returns the markdown, and { missing, sheets } as structured content. Read-only.',
    input: { missing: z.boolean().optional().describe('Only the sheets with at least one missing image, and only their missing cells.') },
    output: {
      missing: z.array(z.string()).describe('Image ids the game references that are not in the art folder.'),
      sheets: z.array(z.object({ id: z.string(), kind: z.string(), missing: z.array(z.string()) })),
    },
    annotations: { readOnlyHint: true }, needs: 'assetPrompts',
    run: async ({ missing }, b) => {
      try {
        const r = await b.assetPrompts!(missing);
        return { content: [{ type: 'text', text: r.markdown }], structuredContent: { missing: r.missing, sheets: r.sheets } };
      } catch (e) { return errorResult(e); }
    },
  },
];

/** The tools a backend can run (the optional abilities it lacks remove their tool). */
export const toolsFor = (b: ToolBackend): ToolDef[] => TOOLS.filter((t) => !t.needs || typeof b[t.needs] === 'function');

export const WRITING_TOOLS = new Set(TOOLS.filter((t) => t.writes).map((t) => t.name));

/** JSON Schema object of a tool's arguments, plain enough for OpenAI-style `parameters` and Anthropic `input_schema`. */
export function jsonSchema(t: ToolDef): Record<string, unknown> {
  const s = z.toJSONSchema(z.object(t.input), { unrepresentable: 'any' }) as Record<string, unknown>;
  delete s.$schema;
  return simplify(s) as Record<string, unknown>;
}

/** Tuples (`prefixItems`) become fixed-length arrays and `propertyNames` goes: some providers reject both. */
function simplify(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(simplify);
  if (!v || typeof v !== 'object') return v;
  const o: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) if (k !== 'propertyNames') o[k] = simplify(x);
  if (Array.isArray(o.prefixItems)) {
    const items = o.prefixItems as unknown[];
    o.items = items[0] ?? {};
    o.minItems = items.length;
    o.maxItems = items.length;
    delete o.prefixItems;
  }
  return o;
}

/** Validates the arguments a model sent and runs the tool; unknown tool or bad arguments: a tool error. */
export async function callTool(name: string, args: unknown, b: ToolBackend): Promise<ToolResult> {
  const t = toolsFor(b).find((x) => x.name === name);
  if (!t) return errorResult(new Error(`no such tool: ${name}`));
  const parsed = z.object(t.input).safeParse(args ?? {});
  if (!parsed.success) return errorResult(new Error(`bad arguments for ${name}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`));
  return t.run(parsed.data, b);
}
