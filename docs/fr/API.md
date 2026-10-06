# API publique

Depuis la 4.0, un jeu, une page hôte et les tests d'un jeu utilisent quatre modules d'entrée et la commande
`web-scumm`. Leurs noms sont le contrat : `tests/api-surface.json` les liste, `tests/api-surface.test.ts` échoue quand
l'un change sans cette page, et `docs/fr/SUPPORT.md` dit comment un changement se fait (annoncé, puis retiré à la
version majeure suivante). Tout le reste de `src/engine` est interne et peut changer à chaque release ; l'alias
`@engine/*` y mène toujours, sans cette promesse.

Dans un projet de jeu, les entrées sont `web-scumm/content`, `web-scumm/player`, `web-scumm/minigames` et
`web-scumm/testing` et, depuis la 4.1.1, `web-scumm/reality` (les `exports` du paquet) ; dans ce dépôt, les mêmes noms mènent à `src/engine/api/`.

## web-scumm/content : écrire un jeu

| Nom | Quoi |
|---|---|
| `defineGame` | déclare le jeu (`GameDef`) ; avec `schemaVersion: 3`, compilé et figé |
| `defineRoom` | déclare un lieu (`RoomDef`) |
| `compileGame` | le jeu compilé et figé qu'un hôte ou un outil fait tourner (`defineGame` l'appelle déjà en schéma 3) |
| `GameSource` · `CompiledGame` | un jeu tel qu'écrit, et tel que compilé |
| `EMPTY_LAYOUT` · `FLOOR` · `NEAR` | la géométrie d'un lieu que personne n'a encore placé, la ligne de sol par défaut, la distance « près » par défaut |
| `GameDef` | le jeu entier : verbes, personnages, objets, lieux, règles, audio, habillage, budgets, migrations, textes |
| `RoomDef` | un lieu : décor ou scène, accessoires, zones, acteurs, sorties, réactions, indices, scripts |
| `Id` · `Value` · `Point` | un id, la valeur d'un drapeau, un point de la scène 640 × 400 |
| `Cond` | une condition (`'flag'`, `'!flag'`, `{ has }`, `{ flag, eq }`, `{ not }`, `{ all }`, `{ any }`…) |
| `Cmd` | une commande d'une réaction ou d'un script (`say`, `set`, `gain`, `goto`, `minigame`…) |
| `Who` · `WalkTarget` · `ListLine` | qui parle, où marcher, une ligne d'une liste où le moteur pioche |
| `Choice` · `TalkTopic` | un choix de dialogue, un sujet de conversation |
| `VerbId` · `VerbDef` | l'id d'un verbe, un verbe tel que l'interface le montre |
| `Rule` · `KindRule` · `EventRule` | une réaction écrite, une réaction par sorte, un écouteur d'événement émis |
| `Action` | une action du joueur : verbe, a, b |
| `CharacterDef` · `SpriteSet` · `MouthSet` | un personnage, ses poses, ses bouches |
| `ItemDef` | un objet d'inventaire |
| `PropDef` · `PropAnim` · `ActorDef` · `HotspotDef` · `ExitDef` | ce qu'un lieu contient (chacun peut nommer le `defaultVerb` d'un double tap, 4.0) |
| `HintDef` · `ScriptDef` | les indices d'un lieu, un script du monde |
| `StageDef` · `StageLayer` · `LightDef` · `EmitterDef` · `TransitionKind` | le lieu mis en scène (calques, lumières, particules, transitions) |
| `MapDef` · `MapRegion` · `PlaceDef` | la carte de voyage |
| `GameRules` | les règles communes à tous les lieux |
| `AudioDef` · `ScoreDef` · `ScoreState` | musique, sons, voix ; les stems d'une partition et lesquels sonnent quand |
| `EndingDef` | la fin scellée |
| `RealityDef` · `SignalDef` · `RealityState` · `ExternalEntry` | les signaux du monde extérieur par un Reality Bridge (4.1.1, `docs/fr/REALITY.md`) : ce qu'un jeu déclare, ce qu'une sauvegarde garde du lien, un signal comme entrée de session |
| `RevealDef` | **déprécié** (4.0) : l'ancien nom de `EndingDef` ; retiré en 5.0 |
| `SkinDef` · `UiTexts` | les images et sons de l'interface, ses textes |
| `Migration` | une étape de migration des sauvegardes (renommages, suppressions) |
| `Layout` | la géométrie d'un lieu, écrite par l'éditeur de placement |
| `GameState` · `Session` · `SessionEntry` | l'état qu'une sauvegarde garde, une session rejouable et ses entrées |
| `CustomCommand` · `CustomCommands` · `CustomContext` | les commandes propres d'un jeu (`{ custom }`), la porte de sortie, et ce qu'elles reçoivent |

## web-scumm/player : lancer le jeu dans une page

| Nom | Quoi |
|---|---|
| `bootGame` | lance le jeu dans la page (`BootOptions` : le module du jeu, l'élément racine, le service worker) |
| `BootOptions` · `SwModule` | ses options, le module d'enregistrement du service worker |
| `Locales` · `pickLanguage` | les traductions qu'un jeu livre, celle qu'une visite reçoit |
| `openStore` · `StoreOpener` | le stockage de sauvegarde qu'une page ouvre (IndexedDB, sinon localStorage), et comment en fournir un autre |
| `SaveStore` · `SlotStore` | le stockage de la sauvegarde auto et les emplacements manuels qu'un hôte peut fournir |
| `Presenter` | ce que le moteur demande à une interface (une réplique, un choix, une marche, un mini-jeu) |
| `AssetManifest` | `assets.gen.json` : les images, leurs tailles, les fichiers audio |
| `SceneRenderer` | le contrat d'un peintre (les peintres DOM et canvas l'implémentent) |
| `SpriteSpec` · `LayerSpec` · `OccluderSpec` · `LightSpec` · `EmitterSpec` · `StageSpec` | ce qu'on donne à un peintre à dessiner |

## web-scumm/minigames : les mini-jeux comme greffons

| Nom | Quoi |
|---|---|
| `Minigame` | le contrat : `run(ctx)`, et ce que le validateur lit (`required`, `textParams`, `bindings`) |
| `MinigameCtx` | ce qu'un mini-jeu reçoit : sa zone, images, sons, paramètres, libellés, un signal d'abandon |
| `minigames` | ceux du moteur (pipes, stroke, pick, hide, runner, scratch, cables), chacun chargé quand il démarre |
| `MINIGAME_CSS` | leur style commun |

Un jeu ajoute les siens dans `minigames` de son module (même contrat) : c'est le format des greffons.

## web-scumm/testing : les tests d'un jeu

| Nom | Quoi |
|---|---|
| `Engine` | le moteur sans page (ses membres marqués `@internal` sont lus par les modules de `core/` depuis la 4.1.0 : hors contrat). Depuis la 4.1.4 : `destroy()` le termine (boucles arrêtées, attentes libérées, plus aucun rappel) ; `onError(error, where)` entend un script qui a levé (arrêté, `scripts[id].off`) ou une commande custom qui a changé plus qu'elle ne déclarait ; `beforeSave(state)` façonne ce que le store écrit, `onLoad.before/after` encadrent un chargement ; `clock` est le seul temps qu'il connaît (`started`, la trace, la date d'une session) |
| `FakePresenter` · `MemoryStore` | une interface qui répond par script, un stockage de sauvegarde en mémoire |
| `solve` · `SolveOptions` · `SolveResult` | le solveur : un chemin vers la fin, les blocages avec `prove` |
| `parseSave` · `saveEnvelope` · `SaveEnvelopeV3` | l'enveloppe d'une sauvegarde : l'écrire, la relire (migrations appliquées) |

## web-scumm/reality : les signaux du monde extérieur (4.1.1)

| Nom | Quoi |
|---|---|
| `verifySignal` · `SignalExpectation` · `VerifyResult` · `RefusalCode` | un signal signé vérifié avant d'être lu : taille, algorithme, clé, signature, puis jeu, joueur, manifeste, expiration ; un refus a un code |
| `signSignal` · `importBridgeKey` · `BridgeKey` · `Keyring` | signer comme un Bridge (tests, simulateurs) ; la clé publique d'un Bridge et celles auxquelles le joueur se fie |
| `WorldSignalV1` · `WorldSignalV1Schema` · `SignedWorldSignalV1` · `MAX_SIGNAL_CHARS` | le contenu et son schéma, le JWS compact qui le porte, sa taille limite |
| `WorldSignalPort` | d'où viennent les signaux : le transport d'un Bridge, le simulateur, celui d'un jeu |
| `RealityClient` · `RealityClientOptions` | vérifier, appliquer, attendre la sauvegarde durable, accuser réception |
| `httpPort` · `HttpPortOptions` | le transport vers un Bridge : Server-Sent Events lus avec fetch, ou une lecture par curseur |
| `SignalSimulator` · `Fault` · `SimulatedDelivery` | un Bridge dans le navigateur pour le Studio et les tests : délais, doublons, ordre, mauvaises signatures, expiration, coupures |
| `realityManifest` · `manifestHash` · `RealityManifest` | les signaux qu'un jeu déclare, tels que le Bridge les vérifie, et l'empreinte que sa configuration garde |

## À côté des modules

- **Schéma d'écriture** : `schemaVersion: 3` dans `defineGame` ; `web-scumm migrate` y amène un jeu plus ancien.
- **Sauvegardes** : l'enveloppe `web-scumm-save` schéma 3 ; chaque sauvegarde de la lignée 3.x se charge en 4.x
  (`tests/save-v3.test.ts` en garde une par release).
- **Studio et MCP** : les outils de `npm run mcp` sont décrits par leurs schémas (`docs/fr/MCP.md`) ; leurs noms et
  leurs arguments obligatoires et facultatifs sont dans `tests/api-surface.json` (`mcp`) : un outil retiré ou un argument
  obligatoire ajouté est un changement d'API comme un autre.
- **Ligne de commande** : `web-scumm <commande>` et ses options (`docs/fr/PACKAGE.md`).

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
| `HttpPortOptions` | `type { url, capability, fetch, retryMs, mode, onStatus }` |  |
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
