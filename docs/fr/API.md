# API publique

Depuis la 4.0, un jeu, une page hôte et les tests d'un jeu utilisent quatre modules d'entrée et la commande
`web-scumm`. Leurs noms sont le contrat : `tests/api-surface.json` les liste, `tests/api-surface.test.ts` échoue quand
l'un change sans cette page, et `docs/fr/SUPPORT.md` dit comment un changement se fait (annoncé, puis retiré à la
version majeure suivante). Tout le reste de `src/engine` est interne et peut changer à chaque release ; l'alias
`@engine/*` y mène toujours, sans cette promesse.

Dans un projet de jeu, les entrées sont `web-scumm/content`, `web-scumm/player`, `web-scumm/minigames` et
`web-scumm/testing` (les `exports` du paquet) ; dans ce dépôt, les mêmes noms mènent à `src/engine/api/`.

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
| `Engine` | le moteur sans page (ses membres marqués `@internal` sont lus par les modules de `core/` depuis la 4.1.0 : hors contrat) |
| `FakePresenter` · `MemoryStore` | une interface qui répond par script, un stockage de sauvegarde en mémoire |
| `solve` · `SolveOptions` · `SolveResult` | le solveur : un chemin vers la fin, les blocages avec `prove` |
| `parseSave` · `saveEnvelope` · `SaveEnvelopeV3` | l'enveloppe d'une sauvegarde : l'écrire, la relire (migrations appliquées) |

## À côté des modules

- **Schéma d'écriture** : `schemaVersion: 3` dans `defineGame` ; `web-scumm migrate` y amène un jeu plus ancien.
- **Sauvegardes** : l'enveloppe `web-scumm-save` schéma 3 ; chaque sauvegarde de la lignée 3.x se charge en 4.x
  (`tests/save-v3.test.ts` en garde une par release).
- **Studio et MCP** : les outils de `npm run mcp` sont décrits par leurs schémas (`docs/fr/MCP.md`) ; leurs noms et
  leurs arguments obligatoires et facultatifs sont dans `tests/api-surface.json` (`mcp`) : un outil retiré ou un argument
  obligatoire ajouté est un changement d'API comme un autre.
- **Ligne de commande** : `web-scumm <commande>` et ses options (`docs/fr/PACKAGE.md`).
