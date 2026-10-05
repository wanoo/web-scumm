# web-scumm 4.1.1 — Clarity

> **Adopted as 4.1.0 "Clarity" (D14).** The maintainer stays on the 4.1.x line for a while, 4.2 being the final
> version: Clarity ships first, as 4.1.0, on top of 4.0.0; Reality Bridge (PLAN-4.1-REALITY-BRIDGE.md) follows as
> 4.1.1 on the clarified code. Codex's text below is kept as written; what was adapted:
>
> - **The baseline (§2), measured on `v4.0.0` (`5d635c0`)**: 87 TypeScript files under `src/engine` (as said); **70**
>   test files and 459 `it`/`test` declarations (570 tests once parametrised), not 75 and ~490; the four files over
>   1,000 lines as said; `noUnusedLocals` + `noUnusedParameters` give 16 errors, `noUncheckedIndexedAccess` 933 (396 in
>   `src/engine`, 29 of them in `core`, the rest in tests and tools); **11** `any` in production code, 8 of them in
>   `src/studio/storyboard.ts`, none in `core`.
> - **Moved to 4.1.1 with Reality**: `core/types/reality.ts`, `dom/reality-client.ts`, `tools/solve/scenarios.ts`, the
>   Biscuit and envelope tests, the signal golden tests, the Biscuit ADR, `CODE_TOUR.md` step 7 (a signal).
> - **Branch names**: CI runs on `docs/**`, `test/**` and `refactor/**` too.
> - **`noUncheckedIndexedAccess`** is held on `src/engine` and `src/studio` (`tsconfig.strictest.json`); tests and
>   `tools/` stay outside, documented.
> - **The outside review (§13)** is a human gate: reported, not blocking (D12).

> **Statut : proposition de maintenance pour la première correction de la 4.1.**  
> Branche de préparation : `feature/4.1-reality-bridge`  
> Nature : refactoring interne, documentation et garanties de qualité ; aucune nouvelle fonctionnalité de jeu.

## 1. Intention

La 4.1.1 doit rendre web-scumm plus facile à lire, vérifier et modifier par une personne qui découvre le projet.

Le projet assume son développement assisté par IA sans en faire un argument de qualité ni un sujet de communication.
Une contribution, humaine ou générée, est acceptée selon les mêmes critères : contrats typés, tests comportementaux,
replays déterministes, vérifications navigateur, mesures reproductibles et revue des changements.

La 4.1.1 ne répond à aucune polémique. Elle réduit simplement le coût d'entrée d'un contributeur extérieur et rend les
choix du moteur plus explicites.

Formulation publique proposée :

> **4.1.1 “Clarity”** is a maintenance release focused on making web-scumm easier to read, review and contribute to.
> It changes no gameplay or public contract: module boundaries are clearer, large responsibilities are separated,
> static checks are stronger, and the architecture and quality evidence are easier to find.

## 2. Point de départ à mesurer

Les nombres ci-dessous viennent du checkout 4.0.0 et doivent être recalculés sur le tag exact `v4.1.0` avant le
premier refactoring :

- 87 fichiers TypeScript sous `src/engine` ;
- 75 fichiers `*.test.ts` et environ 490 déclarations de tests ;
- TypeScript en mode `strict` ;
- frontières core / player / tools / dev déjà documentées et testées ;
- quatre fichiers centraux dépassant 1 000 lignes :
  - `src/engine/tools/solve.ts` : 1 423 ;
  - `src/engine/dom/app.ts` : 1 401 ;
  - `src/engine/core/engine.ts` : 1 170 ;
  - `src/engine/core/types.ts` : 1 023 ;
- aucun formatter ou linter général du code ;
- `noUnusedLocals` et `noUncheckedIndexedAccess` désactivés ;
- pas de couverture instrumentée ni de mutation testing.

Ces mesures ne sont pas un jugement automatique sur la qualité. Elles désignent les endroits où une lecture humaine
coûte le plus cher et où une modification est difficile à examiner isolément.

## 3. Principes

1. **Comportement inchangé.** Les mêmes sessions produisent les mêmes digests et les mêmes fins.
2. **API inchangée.** Aucun nom public, schéma de contenu ou format de sauvegarde ne change dans une patch release.
3. **Un refactoring à la fois.** Aucun commit ne mélange formatage mécanique, déplacement de code et changement logique.
4. **Mesurer avant et après.** Tests, preuves, bundle et performances accompagnent chaque extraction importante.
5. **Nommer les responsabilités.** Un fichier ou module doit pouvoir être résumé en une phrase courte.
6. **Valider aux frontières.** Toute donnée extérieure commence comme `unknown`, puis passe par un schéma explicite.
7. **La lisibilité prime sur la densité.** Éviter les suites d'opérations compressées sur une ligne lorsqu'elles cachent
   des branches, mutations ou effets asynchrones.
8. **Pas de métrique décorative.** Couverture, complexité et lignes servent à déclencher une revue, jamais à déclarer
   seules qu'un code est bon.

## 4. Lot A — Baseline comportementale

Avant toute extraction :

- exécuter et archiver `npm run release-check` sur `v4.1.0` ;
- enregistrer le nombre de tests, les preuves globale et par chapitres, les benchmarks et le poids du bundle ;
- figer la surface de l'API publique et des outils MCP ;
- conserver les sessions de référence de la démo, du jeu de référence et du scénario Reality Bridge ;
- ajouter les golden tests qui manquent à la 4.1 : réception, déduplication, sauvegarde, reprise et replay d'un signal ;
- produire un rapport `quality-baseline.json` lisible en CI.

### Critère de sortie

Un changement ultérieur qui modifie un digest, un statut du solveur, une surface publique ou une sauvegarde échoue avec
un diagnostic précis.

## 5. Lot B — Style et contrôles statiques

### Formatter et linter

Adopter Biome pour le code TypeScript et JavaScript :

```text
npm run format
npm run format:check
npm run lint:code
npm run lint:content
npm run quality
```

Le script actuel `lint` reste disponible comme alias de `lint:content` pendant toute la version majeure.

Le premier formatage est un commit purement mécanique :

- aucun déplacement ni renommage dans ce commit ;
- résultat ajouté à `.git-blame-ignore-revs` ;
- sortie de `npm test` et `npm run build` jointe ;
- aucun formatage automatique des fichiers d'assets ou de golden data dont les octets sont contractuels.

### TypeScript

Rendre bloquants :

- imports et variables inutilisés ;
- promesses volontairement ignorées sans marque explicite ;
- branches et conditions constantes ;
- chutes involontaires dans les `switch` ;
- nouveaux `any` dans `src/engine`, `src/studio` et le code Reality ;
- assertions non-nulles non justifiées à une frontière de données.

Ajouter d'abord `tsconfig.strictest.json` avec `noUnusedLocals`, `noUnusedParameters` et
`noUncheckedIndexedAccess`. Corriger par sous-système, puis rendre cette configuration bloquante avant la release si
elle n'impose aucun changement de comportement. Toute exception restante doit être locale, commentée et testée.

### Critère de sortie

`npm run quality` passe sans avertissement et aucun outil ne reformate encore le dépôt après son exécution.

## 6. Lot C — Découpage du cœur

### `core/engine.ts`

Extraire les responsabilités sans changer la façade `Engine` :

```text
core/session-runtime.ts   enregistrement, feed et replay
core/script-runtime.ts    programme, attentes, reprise et scheduler
core/event-runtime.ts     emit, listeners et événements attendus
core/command-runtime.ts   dispatch et exécution des Cmd
core/interactions.ts      règles, topics, réactions et fallbacks
```

Ordre recommandé : session, événements, scripts, interactions, commandes. Chaque extraction commence par les tests
caractérisant le comportement existant et conserve le même ordre des effets.

Les modules extraits ne doivent pas devenir de nouvelles APIs publiques. `Engine` reste le point d'entrée de
`web-scumm/testing`.

### `core/types.ts`

Séparer les définitions internes :

```text
core/types/content.ts
core/types/state.ts
core/types/session.ts
core/types/stage.ts
core/types/audio.ts
core/types/reality.ts
```

`core/types.ts` devient une façade de réexport. `web-scumm/content` et `web-scumm/testing` exportent exactement les
mêmes noms qu'en 4.1.0.

### Critère de sortie

- aucun changement dans `tests/api-surface.json` ;
- mêmes digests de replay ;
- mêmes chemins et verdicts du solveur ;
- pas de cycle d'import nouvellement autorisé ;
- chaque module extrait a un test direct de sa responsabilité.

## 7. Lot D — Découpage du joueur

Extraire de `dom/app.ts` :

```text
dom/storage.ts          autosave, slots et erreurs durables
dom/settings.ts         préférences et persistance légère
dom/input.ts            verbes, inventaire, taps et double taps
dom/speech.ts           paroles, transcript et voix
dom/menus.ts            pause, sauvegardes et paramètres
dom/update.ts           service worker, sauvegarde puis activation
dom/reality-client.ts   connexion, curseur, accusé et statut extérieur
```

`App` garde l'orchestration et le contrat `Presenter`. Les composants extraits reçoivent leurs dépendances au
constructeur plutôt que d'importer un singleton ou d'atteindre le DOM global implicitement.

Points à préserver particulièrement :

- restauration du focus ;
- ordre parole / voix / musique ;
- autosave relue avant confirmation ;
- mise à jour PWA après sauvegarde vérifiée ;
- réception d'un signal pendant dialogue, cinématique ou minijeu ;
- absence totale de code Reality dans le chunk initial d'un jeu qui ne l'utilise pas.

### Critère de sortie

Les E2E Chromium et WebKit, axe, hors-ligne, sauvegarde, double tap et Reality Bridge reproduisent les mêmes résultats
et captures fonctionnelles.

## 8. Lot E — Découpage du solveur

Le solveur est l'algorithme le plus difficile à examiner. Séparer :

```text
tools/solve/search.ts         frontière, nœuds, graphe et terminaison
tools/solve/expansion.ts      actions candidates et variantes
tools/solve/scenarios.ts      choix, random et signaux externes
tools/solve/abstractions.ts   mobilité, joueurs et inventaires
tools/solve/memo.ts           no-op memo et vérification
tools/solve/report.ts         profil, métriques et résultat public
```

Les types internes importants (`Node`, `Expansion`, `Transition`) reçoivent des noms complets et des invariants
documentés. Les helpers qui mutent l'état indiquent explicitement ce qu'ils lisent et écrivent.

Chaque abstraction est comparée à la recherche explicite sur les fixtures et le corpus. Aucun refactoring ne modifie
les statuts `solved`, `softlocks`, `unsolved` ou `truncated`.

### Critère de sortie

- mêmes verdicts sur toutes les fixtures et le corpus ;
- écart de performance expliqué s'il dépasse 5 % ;
- aucun fichier opérationnel du solveur au-dessus de 800 lignes sans exception documentée ;
- la lecture du chemin `solve()` → expansion → transition → verdict est décrite dans `CODE_TOUR.md`.

## 9. Lot F — Frontières de données

Remplacer les `any` de production par `unknown` puis validation :

- documents storyboard ;
- messages Studio ;
- réponses des fournisseurs d'assistant ;
- imports de layout ;
- manifests et fichiers de provenance ;
- enveloppes Reality Bridge ;
- réponses et facts Biscuit.

Unifier les normalisations actuellement dupliquées entre les outils et le Studio. Une même entrée invalide doit donner
le même diagnostic dans la CLI, le Studio et le MCP.

Pour Reality Bridge :

- corpus de conformité de l'enveloppe signée ;
- tests Biscuit valides et refusés entre les implémentations retenues ;
- fuzzing des parseurs et limites de taille ;
- séparation testée entre autorisation Biscuit et signature finale ;
- aucun token, email brut ou credential dans session, sauvegarde ou log ;
- tests de mauvaise audience, mauvais jeu, mauvais joueur, signal hors capacité, expiration et révocation.

### Critère de sortie

Le cœur, le joueur et Reality Bridge ne contiennent aucun `any` injustifié. Les rares adaptateurs dynamiques qui en
ont encore besoin documentent l'origine, la validation suivante et un test négatif.

## 10. Lot G — Couverture et résistance des tests

Ajouter la couverture V8 de Vitest :

```text
npm run test:coverage
npm run test:mutation:core
```

Politique :

- le seuil global démarre au niveau mesuré sur `v4.1.0` et ne peut pas régresser ;
- sauvegarde, migration, replay, vérification de signal et déduplication couvrent toutes leurs branches ;
- les nouveaux parseurs ont une table de cas invalides ;
- des tests de propriété vérifient sérialisation, déterminisme et idempotence ;
- un mutation testing ciblé tourne chaque nuit sur conditions, saves, sessions et Reality ;
- tout bug corrigé possède d'abord une reproduction rouge.

Une couverture élevée n'est pas présentée comme preuve suffisante. Le rapport distingue lignes exécutées, branches
réellement discriminées et mutations survivantes.

### Critère de sortie

Aucune baisse de couverture, aucune mutation survivante connue sur les invariants critiques et rapports archivés par
la CI.

## 11. Lot H — Documentation pour un lecteur humain

Ajouter :

### `ARCHITECTURE.md`

- frontières et sens des imports ;
- cycle d'une action : UI → Engine → règle → commande → état → autosave → rendu ;
- cycle d'un signal extérieur ;
- séparation contenu de confiance / entrée non fiable ;
- stockage, session et replay ;
- solveur et moteur réel ;
- ce qui est public et ce qui reste interne.

### `CODE_TOUR.md`

Parcours de lecture d'environ trente minutes :

1. déclarer un petit jeu ;
2. compiler et figer son contenu ;
3. démarrer une partie ;
4. exécuter une action ;
5. sauvegarder et rejouer ;
6. explorer la même action dans le solveur ;
7. recevoir un signal Reality Bridge ;
8. trouver les tests correspondants.

### ADR

Créer `docs/dev/adr/` pour les décisions qui semblent surprenantes sans contexte :

- DOM comme renderer de référence ;
- contenu déclaratif et code de confiance séparés ;
- solveur exécutant le vrai moteur ;
- session comme unité de reproduction ;
- IndexedDB et relecture durable ;
- Biscuit pour les capacités, signature séparée pour les événements ;
- livraison au moins une fois et effet au plus une fois.

### Guide de contribution

Ajouter une checklist « modifier une commande » : types, catalogue, moteur, validator, solveur, puzzle graph, i18n,
Studio, MCP, tests et docs. Donner un exemple complet de petite contribution revue.

## 12. Discipline des changements

Branches proposées :

```text
fix/quality-tooling
refactor/core-runtime
refactor/player-shell
refactor/solver-search
fix/untrusted-boundaries
test/coverage-and-mutation
docs/code-tour
release/4.1.1
```

Chaque proposition contient :

- responsabilité extraite ou défaut corrigé ;
- tests ajoutés avant le changement ;
- sorties avant/après ;
- différence de bundle et de benchmark ;
- ce qui n'a volontairement pas été changé ;
- commit de formatage séparé de tout changement logique.

Le trailer `Agent: Claude` ou `Agent: Codex` reste présent. Il renseigne la provenance sans modifier le niveau de preuve
exigé.

## 13. Revue extérieure

Avant le tag, demander à au moins une personne qui n'a pas participé au moteur de suivre `CODE_TOUR.md` puis de relire
un changement limité.

Questions utiles :

- peut-elle expliquer où vit l'état et qui peut le modifier ?
- trouve-t-elle le test d'une commande donnée ?
- comprend-elle comment un replay reste déterministe ?
- peut-elle ajouter une validation ou corriger un diagnostic sans parcourir tout le dépôt ?
- quels noms, fichiers ou frontières l'ont ralentie ?

Le compte rendu donne des observations concrètes, pas une note générale. Les blocages de compréhension sont corrigés
ou explicitement reportés.

## 14. Critères de sortie 4.1.1

La 4.1.1 est publiable lorsque :

1. `npm run quality` et `npm run release-check` sont verts ;
2. formatter et linter ne produisent aucun avertissement ;
3. les quatre fichiers centraux sont séparés par responsabilité ou possèdent une exception argumentée ;
4. aucun `any` injustifié ne reste dans le cœur, le joueur ou Reality Bridge ;
5. la surface publique est identique à la 4.1.0 ;
6. toutes les sauvegardes 3.x, 4.0 et 4.1 continuent de charger ;
7. les sessions de référence donnent les mêmes digests ;
8. le solveur donne les mêmes verdicts et explique tout écart de performance supérieur à 5 % ;
9. un jeu sans Reality Bridge ne reçoit ni code ni requête supplémentaire ;
10. couverture et mutation testing ne révèlent aucun trou critique connu ;
11. `ARCHITECTURE.md` et `CODE_TOUR.md` correspondent au code livré ;
12. une revue extérieure a produit des observations concrètes et tous ses blockers sont fermés ou arbitrés.

Si le travail exige un changement d'API publique, de DSL ou d'enveloppe de sauvegarde, cette partie quitte la patch
release et devient un candidat 4.2.

## 15. Hors périmètre

- nouvelle primitive de gameplay ;
- nouveau renderer ;
- réécriture générale du moteur ;
- modification esthétique sans bénéfice de lecture mesuré ;
- objectif artificiel de 100 % de couverture globale ;
- suppression de code uniquement pour réduire un compteur ;
- communication défensive sur la manière dont le projet est développé.

Le résultat recherché n'est pas un dépôt qui prétend être parfait. C'est un dépôt dans lequel un lecteur peut suivre
les responsabilités, reproduire les garanties, formuler une critique précise et proposer une correction limitée.
