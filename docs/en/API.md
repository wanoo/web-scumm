# Public API

Since 4.0 a game, a host page and a game's tests use four entry modules and the `web-scumm` command. Their names are
the contract: `tests/api-surface.json` lists them, `tests/api-surface.test.ts` fails when one changes without this
page, and `docs/en/SUPPORT.md` says how a change is made (announced, then removed at the next major). Everything else
under `src/engine` is internal and may change in any release; the `@engine/*` alias still reaches it, without that
promise.

In a game project the entries are `web-scumm/content`, `web-scumm/player`, `web-scumm/minigames` and
`web-scumm/testing` and, since 4.1.1, `web-scumm/reality` (the package's `exports`); in this repository the same names resolve to `src/engine/api/`.

## web-scumm/content: writing a game

| Name | What |
|---|---|
| `defineGame` | declares the game (`GameDef`); with `schemaVersion: 3`, compiled and frozen |
| `defineRoom` | declares a room (`RoomDef`) |
| `compileGame` | the compiled, frozen game a host or a tool runs (`defineGame` already calls it for schema 3) |
| `GameSource` · `CompiledGame` | a game as written, and as compiled |
| `EMPTY_LAYOUT` · `FLOOR` · `NEAR` | the layout of a room nobody placed yet, the default floor line, the default "near" distance |
| `GameDef` | the whole game: verbs, characters, items, rooms, rules, audio, skin, budgets, migrations, texts |
| `RoomDef` | a room: backdrop or stage, props, hotspots, actors, exits, reactions, hints, scripts |
| `Id` · `Value` · `Point` | an id, a flag's value, a point of the 640 × 400 scene |
| `Cond` | a condition (`'flag'`, `'!flag'`, `{ has }`, `{ flag, eq }`, `{ not }`, `{ all }`, `{ any }`…) |
| `Cmd` | a command of a reaction or a script (`say`, `set`, `gain`, `goto`, `minigame`…) |
| `Who` · `WalkTarget` · `ListLine` | who speaks, where to walk, a line of a list the engine draws from |
| `Choice` · `TalkTopic` | a dialogue choice, a conversation topic |
| `VerbId` · `VerbDef` | a verb's id, a verb as the interface shows it |
| `Rule` · `KindRule` · `EventRule` | a written reaction, a reaction by kind, a listener on an emitted event |
| `Action` | a player action: verb, a, b |
| `CharacterDef` · `SpriteSet` · `MouthSet` | a character, its poses, its mouths |
| `ItemDef` | an inventory item |
| `PropDef` · `PropAnim` · `ActorDef` · `HotspotDef` · `ExitDef` | what a room holds (each may name the `defaultVerb` of a double tap, 4.0) |
| `HintDef` · `ScriptDef` | a room's hints, a script of the world |
| `StageDef` · `StageLayer` · `LightDef` · `EmitterDef` · `TransitionKind` | the staged room (layers, lights, particles, transitions) |
| `MapDef` · `MapRegion` · `PlaceDef` | the travel map |
| `GameRules` | rules shared by every room |
| `AudioDef` · `ScoreDef` · `ScoreState` | music, sounds, voices; a score's stems and which sound when |
| `EndingDef` | the sealed ending |
| `RealityDef` · `SignalDef` · `RealityState` · `ExternalEntry` | signals from the world outside through a Reality Bridge (4.1.1, `docs/en/REALITY.md`): what a game declares, what a save keeps of the link, a signal as a session entry |
| `RevealDef` | **deprecated** (4.0): the old name of `EndingDef`; removed in 5.0 |
| `SkinDef` · `UiTexts` | the interface's images and sounds, its texts |
| `Migration` | one step of save migration (renames, drops) |
| `Layout` | a room's geometry, written by the placement editor |
| `GameState` · `Session` · `SessionEntry` | the state a save holds, a replayable session and its inputs |
| `CustomCommand` · `CustomCommands` · `CustomContext` | a game's own commands (`{ custom }`), the escape hatch, and what they receive |

## web-scumm/player: starting the game in a page

| Name | What |
|---|---|
| `bootGame` | starts the game in the page (`BootOptions`: the game module, the root element, the service worker) |
| `BootOptions` · `SwModule` | its options, the service worker's registration module |
| `Locales` · `pickLanguage` | the translations a game ships, which one a visit gets |
| `openStore` · `StoreOpener` | the save store a page opens (IndexedDB, else localStorage), and how to supply another |
| `SaveStore` · `SlotStore` | the autosave store and the manual slots a host may provide |
| `Presenter` | what the engine asks of a front end (a line said, a choice, a walk, a minigame) |
| `AssetManifest` | `assets.gen.json`: the images, their sizes, the audio files |
| `SceneRenderer` | the painter contract (the DOM and canvas painters implement it) |
| `SpriteSpec` · `LayerSpec` · `OccluderSpec` · `LightSpec` · `EmitterSpec` · `StageSpec` | what a painter is given to draw |

## web-scumm/minigames: minigames as plugins

| Name | What |
|---|---|
| `Minigame` | the contract: `run(ctx)`, and what the validator reads (`required`, `textParams`, `bindings`) |
| `MinigameCtx` | what a minigame is given: its zone, images, sounds, parameters, labels, an abort signal |
| `minigames` | the built-in ones (pipes, stroke, pick, hide, runner, scratch, cables), each loaded when it starts |
| `MINIGAME_CSS` | their shared style |

A game adds its own in its module's `minigames` (same contract): that is the plugin format.

## web-scumm/testing: a game's own tests

| Name | What |
|---|---|
| `Engine` | the engine without a page (its members marked `@internal` are read by the modules of `core/` since 4.1.0: not part of the contract). Since 4.1.4: `destroy()` ends it (loops stopped, waiters released, nothing called back); `onError(error, where)` hears a script that threw (stopped, `scripts[id].off`) or a custom command that changed more than it declared; `beforeSave(state)` shapes what the store writes, `onLoad.before/after` frame a load; `clock` is the only time it knows (`started`, the trace, a session's date) |
| `FakePresenter` · `MemoryStore` | a front end that answers by script, a save store in memory |
| `solve` · `SolveOptions` · `SolveResult` | the solver: a way to the end, softlocks with `prove` |
| `parseSave` · `saveEnvelope` · `SaveEnvelopeV3` | a save's envelope: write it, read it back (migrations applied) |

## web-scumm/reality: signals from the world outside (4.1.1)

| Name | What |
|---|---|
| `verifySignal` · `SignalExpectation` · `VerifyResult` · `RefusalCode` | a signed signal checked before it is read: size, algorithm, key, signature, then game, player, manifest, expiry; a refusal has a code |
| `signSignal` · `importBridgeKey` · `BridgeKey` · `Keyring` | signing as a Bridge does (tests, simulators); a Bridge's public key and the set the player trusts |
| `WorldSignalV1` · `WorldSignalV1Schema` · `SignedWorldSignalV1` · `MAX_SIGNAL_CHARS` | the payload and its schema, the compact JWS that carries it, its size limit |
| `WorldSignalPort` | where signals come from: a Bridge's transport, the simulator, a game's own |
| `RealityClient` · `RealityClientOptions` | verify, apply, wait for the durable save, acknowledge |
| `httpPort` · `HttpPortOptions` | the transport to a Bridge: Server-Sent Events read with fetch, or a fetch by cursor |
| `SignalSimulator` · `Fault` · `SimulatedDelivery` | a Bridge in the browser for the Studio and the tests: delays, duplicates, order, bad signatures, expiry, cuts |
| `realityManifest` · `manifestHash` · `RealityManifest` | the signals a game declares, as the Bridge checks them, and the hash its configuration keeps |

## Beside the modules

- **Authoring schema**: `schemaVersion: 3` in `defineGame`; `web-scumm migrate` brings an older game to it.
- **Saves**: the envelope `web-scumm-save` schema 3; every save of the 3.x line loads in 4.x (`tests/save-v3.test.ts`
  keeps one per release).
- **Studio and MCP**: the tools of `npm run mcp` are described by their schemas (`docs/en/MCP.md`); their names and
  their required and optional arguments are in `tests/api-surface.json` (`mcp`): a tool removed or a required argument
  added is an API change like any other.
- **Command line**: `web-scumm <command>` and its options (`docs/en/PACKAGE.md`).

<!-- api-doc:begin -->
### web-scumm/content

| Name | Signature | Doc |
|---|---|---|
| `Action` | `type { verb, a, b }` | A player action: VERB a (with/to b). `a` can be an inventory item, `b` is always a target. |
| `ActorDef` | `type { defaultVerb, char, interactive, pose, facing, visible, … 1 more }` |  |
| `AudioDef` | `type { music, sfx, voices, voicesByLang, scores, maxDecodedMB, … 1 more }` |  |
| `CharacterDef` | `type { name, description, color, height, sprites, portrait, … 11 more }` |  |
| `Choice` | `type { id, text, if, once, do }` |  |
| `Cmd` | `type union of 56` |  |
| `CompiledGame` | `type { schemaVersion, id, title, lang, saveVersion, renderer, … 31 more }` |  |
| `compileGame` | `(source: GameSource): CompiledGame` | Compiles authoring data once into the single normalised representation consumed by the engine and tools. The source is never mutated; genera |
| `Cond` | `type union of 13` | A condition. - `'flag'`: the flag is true; `'!flag'`: the flag is false or absent. - `{ has: 'item' }`: the item is in the inventory. - `{ f |
| `CustomCommand` | `type { effects, pure, run }` |  |
| `CustomCommands` | `type CustomCommands` |  |
| `CustomContext` | `type { game, state, room, args, ui, scene, … 1 more }` |  |
| `defineGame` | `(game: GameDef): GameDef` | Declares the full game. |
| `defineRoom` | `(room: RoomDef): RoomDef` | Declares a room. Does nothing but type it: autocomplete guides the writing. |
| `EmitterDef` | `type { id, kind, image, color, rate, visible }` |  |
| `EMPTY_LAYOUT` | `Layout` | Empty layout, when the room hasn't been placed in the editor yet. |
| `EndingDef` | `type { file, password, guess, scratch, card }` | Sealed ending (`ending` module): encrypted content, decrypted at the end of the game and shown on a card. |
| `EventRule` | `type { id, on, if, once, do }` | A listener: when `on` is emitted (`{ emit }`) and the condition holds, `do` runs. `once`: only the first time. |
| `ExitDef` | `type { defaultVerb, name, to, entry, if, locked, … 5 more }` | A way out of the room, declared rather than written as a hotspot plus a rule. The engine turns it into exactly that (core/define.ts `normali |
| `ExternalEntry` | `type { id, sequence, signal, source, receivedAt, playerId, … 2 more }` | What a session keeps of a signal from outside (4.1.1): its id and sequence on the Bridge, the signal, the source and when it arrived. Never  |
| `FLOOR` | `395` | Default floor bottom (logical y), when the layout doesn't give `floor`. |
| `GameDef` | `type { schemaVersion, id, title, lang, saveVersion, renderer, … 31 more }` |  |
| `GameRules` | `type { fallbacks, kinds, on }` |  |
| `GameSource` | `type { schemaVersion, id, title, lang, saveVersion, renderer, … 31 more }` |  |
| `GameState` | `type { v, room, inventory, flags, props, actors, … 15 more }` |  |
| `HintDef` | `type { id, until, lines }` |  |
| `HotspotDef` | `type { defaultVerb, name, kind, visible, exit }` |  |
| `Id` | `type { toString, charAt, charCodeAt, concat, indexOf, lastIndexOf, … 44 more }` |  |
| `ItemDef` | `type { name, icon, look, kind }` |  |
| `KindRule` | `type { id, verb, kind, target, item, say }` | Reaction by "kind": applies to anything with this `kind` (e.g. `person`, `cat`), before fallback responses. `target` targets a specific id ( |
| `Layout` | `type { width, floor, walk, scale, entries, hotspots, … 8 more }` |  |
| `LightDef` | `type { id, kind, color, intensity, blend, visible }` |  |
| `ListLine` | `type union of 2` | One line of a list the engine draws from (a look list, a hint, the fallback answers): a plain string, keyed by its position in translations, |
| `MapDef` | `type { regions, start, places, music, vehicles }` |  |
| `MapRegion` | `type { name, image, parent, frame }` |  |
| `Migration` | `type { from, renameFlag, renameItem, renameRoom, renameProp, renameActor, … 12 more }` | One step of save migration: from version `from` to `from + 1`. Keys are old ids, values new ones. |
| `MouthSet` | `type { closed, open, blink, smile }` | Mouth images for a pose: the body doesn't move while speaking, only the mouth changes. `closed` replaces the idle pose's image (t1), `open`  |
| `NEAR` | `150` | Distance (logical units) beyond which a saved approach point is considered stale and recomputed. |
| `PlaceDef` | `type { name, room, region, pos, portrait, vehicle, … 1 more }` |  |
| `Point` | `type { 0, 1, length, toString, toLocaleString, pop, … 31 more }` | Logical coordinates of a backdrop: 640 × 400, origin top-left. |
| `PropAnim` | `type { frames, fps, loop, at }` | A prop animation: images in order at `fps` (default 8); `at` = commands run when a frame is reached (index). |
| `PropDef` | `type { defaultVerb, img, states, anims, initial, name, … 2 more }` |  |
| `RealityDef` | `type { signals, bridge }` |  |
| `RealityState` | `type { playerId, cursor, applied }` | What a save keeps of the link (`GameState.reality`): no token, no email, no payload. |
| `RevealDef` | `type { file, password, guess, scratch, card }` |  |
| `RoomDef` | `type { id, name, decor, description, furniture, music, … 14 more }` |  |
| `Rule` | `type { id, verb, a, b, if, do, … 1 more }` | A written reaction: "when VERB is done on A (with/to B), if CONDITION, then …". `a` and `b` accept a list: the rule works with any of them.  |
| `ScoreDef` | `type { stems, bpm, beatsPerBar, loop, states, quantize, … 4 more }` |  |
| `ScoreState` | `type { if, stems }` | Which stems sound in a given state: the first entry whose condition holds wins (`if` absent: always). |
| `ScriptDef` | `type { id, while, loop, do, stepIds }` | A script of the world: it runs on its own, without a player action, one command at a time, in the gaps between the player's actions (never d |
| `Session` | `type { v, start, base, log, at }` |  |
| `SessionEntry` | `type union of 9` | One input of a session (`Engine.session`). The answers given while it ran (`picks`, `maps`, `rnd`) are what makes it replayable; `ran` lists |
| `SignalDef` | `type { id, source, availability, replay, once, fallback }` |  |
| `SkinDef` | `type { icons, sounds, fonts, heights, callPoses, pixelArt }` | UI skin: everything the engine shows or plays without the content referencing it. Image ids come from the manifest; sounds are ids from `aud |
| `SpriteSet` | `type SpriteSet` | A set of images for a character: pose → list of images (looped). |
| `StageDef` | `type { layers, lights, emitters, transition, links }` |  |
| `StageLayer` | `type { id, image, role, visible }` | A picture of the room: `backdrop` behind everything, `scenery` among the characters (depth from its layout `z`), `foreground` in front of th |
| `TalkTopic` | `type { id, topic, if, do }` |  |
| `TransitionKind` | `type union of 3` |  |
| `UiTexts` | `type { walkTo, newGame, continue, confirmErase, yes, no, … 62 more }` |  |
| `Value` | `type union of 4` |  |
| `VerbDef` | `type { id, label, color, join }` |  |
| `VerbId` | `type { toString, charAt, charCodeAt, concat, indexOf, lastIndexOf, … 44 more }` | Verb id, free-form: the game's own `verbs` declare them. Four ids have meaning to the engine: `look` ("Look" text for rooms and items), `tal |
| `WalkTarget` | `type union of 2` | Target of a move: a hotspot, an actor or a prop in the room (its approach point), or a point. |
| `Who` | `type { toString, charAt, charCodeAt, concat, indexOf, lastIndexOf, … 44 more }` | Who speaks or acts. `'hero'` always designates the hero, whatever their id. |

### web-scumm/player

| Name | Signature | Doc |
|---|---|---|
| `AssetManifest` | `type { images, audio, videos }` | Catalogue of images and sounds prepared by `npm run assets`. |
| `bootGame` | `(o: BootOptions): Promise<App>` | Boots the game in the page and returns the App (after the title screen is shown, or the dev tools started). |
| `BootOptions` | `type { game, layouts, manifest, minigames, commands, locales, … 7 more }` |  |
| `EmitterSpec` | `type { id, kind, url, color, rate, area, … 1 more }` |  |
| `LayerSpec` | `type { id, url, role, x, y, w, … 6 more }` | A stage layer, resolved: its image, its box in the room (logical units, before parallax), its depth and look. |
| `LightSpec` | `type { id, kind, color, intensity, blend, at, … 2 more }` |  |
| `Locales` | `type Locales` |  |
| `OccluderSpec` | `type { id, z, polygon, mask, layer, feather, … 1 more }` | What hides a character deeper than `z`: the backdrop's pixels (or a layer's) inside a polygon, a mask image or a layer's alpha. |
| `openStore` | `(game: GameDef, open?: StoreOpener): Promise<{ store?: SaveStore; attach: (app: App) => void; }>` | Opens the verified store and keeps its early errors and warnings until an App can show them. Without IndexedDB the App's verified localStora |
| `pickLanguage` | `(_written: GameDef, locales: Locales \| undefined, o?: { query?: string \| null; stored?: string \| null; navigatorLang?: string; }): string \| undefined` | `?lang=`, then the player's saved choice, then the browser's language when the game ships it. |
| `Presenter` | `type { enterRoom, say, walk, face, pose, anim, … 21 more }` | What the core asks the display for. The DOM renderer implements it for the browser, FakePresenter implements it for node (tests, solver). Al |
| `SaveStore` | `type { load, save, clear, whenIdle }` |  |
| `SceneRenderer` | `type { el, reset, sprite, camera, resize, stage, … 1 more }` |  |
| `SlotStore` | `type { listSlots, getSlot, putSlot, clearSlot }` | Manual save slots (`GameDef.saves.slots`), durable and verified like the autosave. Numbered from 1. |
| `SpriteSpec` | `type { id, url, fx, fy, w, h, … 9 more }` | One thing drawn in the scene, in logical units. `fx, fy`: its feet (bottom centre), the pivot of rotations. |
| `StageSpec` | `type { backdrop, layers, occluders, lights, emitters, reduceMotion }` | Everything a room shows besides its sprites (`RoomDef.stage`, normalized by `stageOf`, conditions evaluated by the model). |
| `StoreOpener` | `type StoreOpener` |  |
| `SwModule` | `type { registerSW }` | `registerSW` of `virtual:pwa-register` (vite-plugin-pwa), injected so the engine never imports a virtual module. |

### web-scumm/minigames

| Name | Signature | Doc |
|---|---|---|
| `Minigame` | `type { run, required, textParams, bindings }` |  |
| `MINIGAME_CSS` | `"\n.mg{position:absolute;inset:0;overflow:hidden;user-select:none;-webkit-user-select:none;touch-action:none;font-family:var(--font-ui,'DotGothic16'),monospace;` |  |
| `MinigameCtx` | `type { root, u, img, size, sfx, instruct, … 4 more }` |  |
| `minigames` | `Record<string, Minigame>` | Minigames provided by the engine. A game can add others with the same interface. What tools read (`required`, `textParams`, `bindings`) is h |

### web-scumm/testing

| Name | Signature | Doc |
|---|---|---|
| `Engine` | `class Engine` |  |
| `FakePresenter` | `class FakePresenter` | Silent presenter for node: everything finishes immediately, and everything is logged to `log`. |
| `MemoryStore` | `class MemoryStore` |  |
| `parseSave` | `(game: GameDef, input: unknown, opts?: ParseSaveOptions): GameState` | Parses an envelope (or a legacy raw state). Structural corruption and references needed to resume (the current room and active player) are r |
| `saveEnvelope` | `(game: GameDef, state: GameState, now?: number): SaveEnvelopeV3` |  |
| `SaveEnvelopeV3` | `type { format, schema, gameId, gameSaveVersion, savedAt, state }` |  |
| `solve` | `(gameIn: GameDef, layouts: Record<string, Layout>, opts?: SolveOptions): Promise<SolveResult>` |  |
| `SolveOptions` | `type { reality, maxStates, mode, start, goal, commands, … 13 more }` |  |
| `SolveResult` | `type { status, exit, headline, mode, reality, finished, … 19 more }` |  |

### web-scumm/reality

| Name | Signature | Doc |
|---|---|---|
| `BridgeKey` | `type { kid, key, notBefore, notAfter }` | One verification key of the Bridge: its id, the key, and when it may sign (epoch ms; rotation overlaps). |
| `Fault` | `type { delayMs, duplicate, badSignature, expired }` |  |
| `httpPort` | `(o: HttpPortOptions): WorldSignalPort` |  |
| `HttpPortOptions` | `type { url, capability, fetch, retryMs, mode, onStatus, … 3 more }` |  |
| `importBridgeKey` | `(kid: string, raw: string, window?: Omit<BridgeKey, "kid" \| "key">): Promise<BridgeKey>` | An Ed25519 public key from its 32 raw bytes in base64url (a manifest's or a Bridge's configuration). |
| `Keyring` | `type { length, toString, toLocaleString, pop, push, concat, … 29 more }` |  |
| `manifestHash` | `(m: RealityManifest): Promise<string>` | The manifest's hash: SHA-256 of its JSON (keys in this fixed order), hex. |
| `MAX_SIGNAL_CHARS` | `4096` | The largest signed signal accepted, in characters: a signal is an identifier, not a document. |
| `RealityClient` | `class RealityClient` |  |
| `RealityClientOptions` | `type { engine, store, port, keyring, refreshKeys, playerId, … 5 more }` |  |
| `realityManifest` | `(game: GameDef): RealityManifest \| null` |  |
| `RealityManifest` | `type { format, schema, gameId, signals }` |  |
| `RefusalCode` | `type union of 13` | Why a signal was refused, as a code (the conformance corpus and the Rust cross-check compare codes) and a sentence. |
| `SignalExpectation` | `type { gameId, playerId, signals, now }` | What a signal must match besides its signature. |
| `SignalSimulator` | `class SignalSimulator` |  |
| `SignedWorldSignalV1` | `type { toString, charAt, charCodeAt, concat, indexOf, lastIndexOf, … 44 more }` | A signed signal as it travels: the compact JWS string. |
| `signSignal` | `(payload: WorldSignalV1, key: CryptoKey, kid: string): Promise<SignedWorldSignalV1>` | Signs a payload as the Bridge does (the Bridge, the tests, the Studio's simulator). |
| `SimulatedDelivery` | `type { sequence, signal, fault, at }` |  |
| `VerifyResult` | `type union of 2` |  |
| `verifySignal` | `(jws: unknown, keyring: Keyring, expect: SignalExpectation): Promise<VerifyResult>` | Checks a signed signal, then what it says. The reason of a refusal is a short sentence (logged, never shown raw). |
| `WorldSignalPort` | `type { connect, acknowledge, close }` | Where signals from the world outside come from (4.1.1, Reality Bridge): the Bridge's transport (Server-Sent Events, a fetch by cursor), or t |
| `WorldSignalV1` | `type { format, schema, id, sequence, gameId, playerId, … 8 more }` |  |
| `WorldSignalV1Schema` | `z.ZodMiniObject<{ format: z.ZodMiniLiteral<"web-scumm-world-signal">; schema: z.ZodMiniLiteral<1>; id: z.ZodMiniString<string>; sequence: z.ZodMiniInt; gameId: ` | The payload the Bridge signs: one accepted fact from outside, as a finite identifier (§4.1). |
<!-- api-doc:end -->
