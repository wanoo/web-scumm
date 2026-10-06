# Architecture

Comment web-scumm est construit, pour qui lit son code pour la première fois (4.1.0). `docs/fr/CODE_TOUR.md` parcourt
la même carte dans l'ordre, en une demi-heure avec le code ouvert ; `docs/dev/adr/` explique les décisions qui
semblent surprenantes sans leur contexte.

## Les couches

```text
games/<id>/          le contenu : des données seulement (lieux, règles, répliques, layouts, assets)
   │ defineGame / compileGame
   ▼
src/engine/core/     le moteur : état, règles, commandes, scripts, sessions, sauvegardes — sans DOM, tourne partout
   ▲            ▲
   │            └──── src/engine/tools/   validateur, solveur, replay, lint, poids, provenance (Node, workers, tests)
src/engine/dom/      le joueur : App (le Presenter), la vue du lieu, l'audio, les entrées, les menus, le hors-ligne
src/studio/, tools/  le Studio (interface, son serveur et le MCP), la ligne de commande
```

Ce que chaque dossier peut importer est écrit dans `src/engine/BOUNDARIES.md` et vérifié par
`tests/boundaries.test.ts` : le cœur n'importe ni le DOM ni les outils ; le joueur n'importe jamais statiquement le
solveur, le validateur ni le Studio ; les outils n'importent jamais le DOM ; aucun cycle d'imports statiques. L'API
publique, ce sont les quatre entrées de `src/engine/api/` (`docs/fr/API.md`) ; le reste est interne et peut bouger
d'une version mineure à l'autre.

## Un jeu est une donnée

Un jeu est un `GameDef` (`src/engine/core/types.ts`, découpé par sujet dans `src/engine/core/types/`) : lieux, verbes,
objets, personnages, règles (`{ verb, a, b, if, do }`), scripts, écouteurs, dialogues, une carte, une fin. Il ne
contient aucune fonction : on peut donc le valider (`src/engine/tools/validate.ts`), le sauvegarder, le comparer et le
résoudre. Le code dont un jeu a besoin (une commande personnalisée, un mini-jeu) est du code de confiance déclaré à
côté du contenu et appelé par son nom (`core/custom.ts`, `src/engine/minigames/`). `compileGame`
(`src/engine/core/define.ts`) fige le contenu et donne un id stable à chaque règle, choix, sujet, écouteur et étape de
script : sauvegardes, sessions et solveur parlent avec ces ids.

## La vie d'une action

1. **Entrée.** Un tap sur la scène ou l'inventaire (`src/engine/dom/input.ts`) devient une `Action`
   `{ verb, a, b }` ; un double tap choisit le verbe que le joueur veut dire (`src/engine/core/default-verb.ts`).
2. **Moteur.** `Engine.act` (`src/engine/core/engine.ts`) y conduit le héros, ouvre une entrée de session
   (`core/session-runtime.ts`) et demande la réponse à `resolve` (`core/interactions.ts`) : une règle écrite, sinon
   un genre, sinon un refus ou une réplique de repli.
3. **Commandes.** La liste `do` de la règle passe par `exec` (`core/command-runtime.ts`), une `Cmd` à la fois :
   poser un drapeau, donner un objet, dire une réplique, marcher, jouer un son, émettre un événement
   (`core/event-runtime.ts`), lancer un script (`core/script-runtime.ts`). Tout effet à l'écran est un appel au
   `Presenter` (`src/engine/core/ports.ts`).
4. **État.** Les commandes ne changent que `engine.state`, un `GameState` (`core/types/state.ts`) en JSON simple :
   lieu, inventaire, drapeaux, accessoires, compteurs, ce qui a été vu.
5. **Sauvegarde automatique.** Quand le moteur est de nouveau libre, `Engine.save` confie l'état au `SaveStore` :
   dans le navigateur `IndexedDbSaveStore` (`src/engine/dom/save-store.ts`), qui écrit une enveloppe versionnée
   (`core/save.ts`) et la relit avant de dire qu'elle est sauvegardée.
6. **Rendu.** `App` (`src/engine/dom/app.ts`) est le `Presenter` : la vue du lieu (`dom/room.ts`, peinte par le
   DOM ou, à la demande, par Canvas), la parole (`dom/speech.ts`), l'inventaire, la musique (`dom/director.ts`,
   `dom/audio.ts`).

## Contenu de confiance, entrées non fiables

Le contenu et le code du moteur sont de confiance ; tout ce qui vient de l'extérieur ne l'est pas et commence en
`unknown` : une sauvegarde (`parseSave`, un schéma zod), un fichier de session (`parseSessionFile`), un storyboard
(`storyboardProblems`), un import de layout, la réponse d'un fournisseur d'assistant, une requête au Studio
(`tools/studio/security.ts`). La même entrée invalide donne le même diagnostic dans la ligne de commande, le Studio
et le MCP (`tests/diagnostics-parity.test.ts`).

## Stockage, sessions et replay

Une sauvegarde est une enveloppe `{ format, schema: 3, gameId, gameSaveVersion, state }` ; une ancienne est migrée
par les `migrations` du jeu (`core/migrate.ts`) et une sauvegarde par version depuis la 3.0 est chargée par
`tests/save-v3.test.ts`. Chaque entrée est aussi une entrée de la **session** du moteur, avec les réponses données
pendant qu'elle tournait (choix, tirages aléatoires) et l'empreinte de l'état après elle : `replay`
(`src/engine/tools/replay.ts`) rejoue une session et nomme la première entrée dont l'état diffère. Un rapport de bug
est un fichier de session.

## Le solveur fait tourner le vrai moteur

`solve` (`src/engine/tools/solve/`) explore le jeu depuis « Nouvelle partie » avec le même `Engine` et un
presenter muet (`FakePresenter`) : tout ce qu'il trouve, un joueur peut le faire. Une recherche de témoin trouve un
chemin jusqu'à la fin ; une preuve explore tous les états atteignables et nomme les blocages. La recherche ne
distingue un état que par ce qui peut encore compter (`solve/abstractions.ts`) ; chaque abstraction est auditée contre
la recherche explicite (`--audit-abstractions`, le corpus de `npm run audit:corpus`). Le chemin de `solve()` jusqu'au
verdict est dans `src/engine/BOUNDARIES.md`, « Inside the solver ».

## Public et interne

Public : `web-scumm/content` (les types et `defineGame`), `web-scumm/player` (le démarrage), `web-scumm/minigames`,
`web-scumm/testing` (`Engine`, les doublures, l'enveloppe de sauvegarde, `solve`), le format du contenu,
l'enveloppe de sauvegarde et les outils MCP, tenus par `tests/api-surface.json` et `docs/fr/SUPPORT.md`. Interne :
les modules derrière les façades `Engine` et `App` (leurs membres marqués `@internal`), les modules du solveur, le
code des outils.
