# Visite du code

Une demi-heure avec le code ouvert (4.1.0). Chaque étape nomme les fichiers à lire et le test qui les montre à
l'œuvre ; `docs/fr/ARCHITECTURE.md` est la même carte vue d'en haut. Les tests d'une étape se lancent avec
`npx vitest run <fichier>`.

## 1. Déclarer un petit jeu

Lire `tests/fixtures/classics.ts` : cinq tout petits jeux d'après les classiques, chacun un `GameDef` de quelques lieux
et règles. Une règle est `{ verb, a, b, if, do }` ; `do` est une liste de commandes
(`src/engine/core/types/content.ts`, `Cmd`). Les types d'un jeu complet sont dans `src/engine/core/types/game.ts`. La
démo, écrite de la même façon mais plus grande, est `games/demo/`. Test : `tests/classics.test.ts`.

## 2. Le compiler et le figer

`compileGame` dans `src/engine/core/define.ts` clone le contenu, remplit les valeurs par défaut, le fige et donne à
chaque règle, choix, sujet, écouteur et étape de script un id stable (`src/engine/core/content-ids.ts`). Sauvegardes
et sessions parlent avec ces ids : renommer une réplique ne casse pas une sauvegarde. Tests :
`tests/compile.test.ts`, `tests/stable-ids.test.ts`.

## 3. Démarrer une partie

`new Engine(game, layouts, presenter, store)` puis `newGame()` (`src/engine/core/engine.ts`). Dans les tests, le
presenter est `FakePresenter` et le stockage `MemoryStore` (`src/engine/core/ports.ts`) ; dans le navigateur, `App`
(`src/engine/dom/app.ts`) est le presenter et `bootGame` (`src/engine/boot.ts`) branche le tout. Test :
`tests/core.test.ts` (« fixture game »).

## 4. Jouer une action

`Engine.act` y va, ouvre une entrée de session et appelle `resolve` (`src/engine/core/interactions.ts`) : la règle
que choisit `findRule`, sinon un genre, sinon une réplique de repli. Ses commandes passent par `exec` / `step`
(`src/engine/core/command-runtime.ts`) ; événements et scripts dans `src/engine/core/event-runtime.ts` et
`src/engine/core/script-runtime.ts`. Chaque module est appelé seul dans `tests/core-runtime.test.ts`.

## 5. Sauvegarder, charger, rejouer

`saveEnvelope` et `parseSave` (`src/engine/core/save.ts`) écrivent et vérifient une sauvegarde ; `migrate`
(`src/engine/core/migrate.ts`) fait suivre une ancienne ; `tests/save-v3.test.ts` charge une sauvegarde par version
depuis la 3.0 et la joue jusqu'à la fin. La session (`src/engine/core/session-runtime.ts`) enregistre chaque entrée
avec l'empreinte de l'état qui suit ; `replay` (`src/engine/tools/replay.ts`) la rejoue et nomme la première entrée
qui diffère. Test : `tests/replay.test.ts` (« a recorded session »).

## 6. La même action dans le solveur

`solve` (`src/engine/tools/solve/search.ts`) prend un état de la frontière ; `makeExpander`
(`src/engine/tools/solve/expansion.ts`) joue sur un vrai `Engine` chaque action qui vaut la peine, enregistre chaque
transition (`TryRecord`, `src/engine/tools/solve/model.ts`) et ce qu'elle a lu et écrit ; la recherche les fusionne
et rend son verdict. Ce dont un état est fait pour la recherche est dans `src/engine/tools/solve/abstractions.ts`.
Tests : `tests/solver-contract.test.ts`, `tests/memo.test.ts`, et le comportement de chaque jeu figé par
`tests/quality-baseline.json` (`npm run quality:baseline -- --check`).

## 7. Trouver le test d'une chose

Une commande : chercher sa clé dans `tests/cmds.test.ts` et `tests/core.test.ts`. Une règle de couche :
`tests/boundaries.test.ts`. Les noms publics : `tests/api-surface.json`. Un comportement du navigateur : les scripts
`scripts/e2e*.mjs` (`npm run e2e`, `e2e:taps`, `e2e:pwa`, `e2e:a11y`), lancés par la CI sous Chromium et WebKit. Pour
changer une commande de bout en bout, suivre la liste de `CONTRIBUTING.md`.
