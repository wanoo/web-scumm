# 0014 · Objectives and the quest journal, the one primitive family admitted in 4.1.12

**Context.** The programme (§8.3) lists narrative candidates; the sheet admits one family without further proof:
objectives, because 4.1.14 (Time Attack) splits a run at named steps, and the existing primitives cannot say what a
step is. A checkpoint's `goals` are conditions the solver proves a chapter reaches, from a hand-written state: no title
for a player, no hierarchy, no event when they become true, and a checkpoint is a place to start from, not something
a player completes. A flag set by the content says a fact, not that a player finished something; a journal built from
flags would need every game to re-declare which flags count, in code. The other candidates are refused or already exist
(`docs/dev/DSL-STABILITY.md`, "The candidate primitives").

**Decision.** `GameDef.objectives?: Record<Id, { title, done: Cond, optional?, parent? }>`.

- **Completion.** The engine completes an objective once, the first time its `done` holds after a transition
  (`core/objectives.ts`): every state event of the journal (a flag changed, an item acquired or lost, a room entered,
  a player switched; the handlers now change the state before they journal it) and every `Engine.save()` (what has no
  event: a prop's state, a place unlocked, a script's step) and just before an ending. So `objectiveCompleted` lands
  right after the event that completed it, even inside a cutscene, before what follows and before the autosave's
  `saveMade` (`tests/objectives.test.ts` pins it); several at once come deepest step first, then in declaration
  order. A condition that stops holding never takes a completion back in the session. Evaluated with `check`
  directly, never `Engine.cond`: the solver's read sets are not touched. The cost: the objectives' conditions once
  per state event (five in each bundled game).
- **Not in the save.** What already holds when a game starts, loads or jumps to a checkpoint is done silently; the set
  lives with the session. The save format does not change (no migration), the solver's state does not grow, and a
  replay yields the same events. The cost: an objective whose condition held once and no longer does is open again
  after a load. The content guide says to write `done` as a condition that stays true (a flag set once, an item kept),
  which every objective of `demo` and `reference` is.
- **Validator** (`tools/validate/objectives.ts`, split out of `validate.ts` with the migrations' checks so the capped
  file shrinks, 1140 → 1113 lines): an id of letters, digits, `.`, `_`, `-`; a title; `done`'s references exist (the
  validator's condition check); `done` can hold at all (a flag some command sets, an item gained or held at the start,
  a prop's state set or initial, a place unlocked: generous, static; a flag only a custom command without declared
  `effects` could set is named as such, "declare the command's effects"); a `parent` that exists, without a cycle;
  and a warning for a `done` the content can take back.
- **Solver.** `npm run solve -- --goal=100%`: the search's goal is the `done` of every objective that is not
  `optional` (`completionGoal`), **all holding at once in one state**, instead of the ending. The journal keeps an
  objective completed forever, so a `done` the content can take back (a flag some `unset` clears, an item some `lose`
  or hand-over removes) can make 100 % unreachable although each was completed once: the validator warns about it. `demo`: 35 states; `reference`: 1 447 states, both solved
  (local, 7 Oct 2026).
- **Player.** The pause menu's **Objectives** row (`ui.objectives`, English default) opens the quest journal: each
  step under its parent, ✓ done or ○ open, side objectives in italics. Titles are translated
  (`objectives/<id>.title` in `locales/<lang>.json`).
- **Studio and MCP.** The Studio's form is generated from the objective's schema (`src/studio/forms-gen.ts`); MCP's
  `set_value` writes `objectives.<id>` (or one field) in the game file with `id: "@game"`, validated after the write
  like a room's value; `list_rooms` shows them.

**Cost.** One more pass over the objectives' conditions at each save (five conditions in the bundled games). The
pause menu has one more row in a game that declares objectives.

**Evidence.** `tests/objectives.test.ts` (validator, completion once, silent at load, replay, the 100% goal, the
bundled games), `tests/dom/quest-journal.test.ts`, `tests/studio-objectives.test.ts`, `tests/propagation.test.ts`.

**Would change it.** A speedrun category that must count an objective completed before a save and lost after it:
the completed set then enters the save (`GameState`), with its migration, and the solver's state with it.
