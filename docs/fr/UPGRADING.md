# Migrer un jeu de v2 vers v3

La v3 casse volontairement une fois le contrat d'écriture afin de rendre ensuite les sauvegardes durables. Faire la
migration sur une branche, garder une sauvegarde v2 représentative et ne pas traduire ni réordonner le contenu avant
d'avoir posé les ids ci-dessous.

## 1. Établir la référence v2

Sur le dernier commit v2, exporter des sauvegardes aux checkpoints importants et garder une session complète. Noter :

```bash
GAME=<id> npm run validate
GAME=<id> npm run solve
GAME=<id> npm test
```

Ne jamais committer dans ce dépôt public le contenu du jeu privé ni les sauvegardes exportées des joueurs.

## 2. Activer le schéma v3

Ajouter `schemaVersion: 3` à `defineGame({...})`. `compileGame` clone et normalise la source ; la valeur v3 compilée
est figée. Une intégration ne doit donc plus dépendre de `engine.game === source` ni la modifier après construction.

Lancer `GAME=<id> npm run validate`, puis corriger chaque erreur d'id stable :

- chaque `Rule` de lieu ou globale : `id` ;
- chaque `TalkTopic` : `id` ;
- chaque `Choice` : `id` (surtout les choix `once`) ;
- chaque `EventRule` de lieu ou globale : `id` ;
- chaque bloc persistant `{ once }`, `{ nth }`, `{ cycle }`, `{ random }` : `id` ;
- chaque script : une valeur `stepIds` par commande de premier niveau, dans le même ordre.

Choisir des ids sémantiques (`garde_manger.ouvrir`, `grandmere.demander_cle`, `horloge.attendre`), jamais des numéros
ni du texte traduit. Ils sont uniques dans tout le jeu. Les règles de sortie générées reçoivent automatiquement des
ids déterministes.

## 3. Migrer les sauvegardes volontairement

Le navigateur stocke une enveloppe `web-scumm-save` de schéma 3 dans IndexedDB. Au premier lancement v3, l'ancienne
autosauvegarde localStorage `<jeu>.save` est importée une fois et supprimée seulement après relecture de l'écriture.
Les emplacements manuels restent importables.

Incrémenter `saveVersion` pour tout changement d'état et fournir une `Migration` par étape entière. En plus des champs
v2, la v3 sait migrer :

```ts
migrations: [{
  from: 2,
  renameCounter: { 'maison:on3.0': 'garde_manger.premiere_ouverture' },
  renameSeen: { 'topic.maison/grandmere[0]': 'topic.grandmere.demander_cle' },
  renameScript: { vieille_horloge: 'horloge' },
  renameScriptStep: { horloge: { 'step.1': 'carillon' } },
  renamePlayer: { enfant: 'laverne' },
  renameCharacter: { ancienne_grandmere: 'grandmere' },
  dropCounter: ['gag_temporaire'],
  dropSeen: ['choix_supprime'],
  dropScript: ['ronde_supprimee'],
}],
```

Ne convertir une ancienne clé positionnelle de compteur, sujet ou script que si le contenu v2 et son sens sont connus.
Il n'existe aucune conversion universelle sûre après un réordonnancement ou une traduction. Une référence facultative
périmée non mappée est élaguée avec un avertissement visible ; JSON mal formé, autre jeu, lieu courant absent ou joueur
actif inconnu sont refusés sans remplacer la session courante.

## 4. Mettre à jour traductions et mini-jeux

Lancer `npm run i18n -- extract --lang <xx>` pour chaque langue livrée. La v3 extrait aussi les libellés/mots de liaison
des verbes et les chemins déclarés dans `textParams` par chaque mini-jeu. Lancer ensuite `npm run i18n -- status` et
traduire toute nouvelle entrée.

Un mini-jeu personnalisé doit déclarer `required` et `textParams` afin que validation et traduction comprennent ses
paramètres. Les ids d'assets gardent la convention `planche/case` et sont découverts par les outils d'assets.

## 5. Mettre à jour les commandes de développement et de CI

- `npm run dev` et `npm run studio` sont limités à la boucle locale.
- Utiliser `dev:lan` / `studio:lan` depuis un téléphone et ouvrir l'URL avec jeton affichée.
- `npm test` est la suite Node ; `npm run test:assets` est la suite d'assets adossée à Python.
- `npm run build` exige validation et chemin gagnant, pas une preuve illimitée de l'espace d'états.
- `npm run prove:game` prouve graphes global et par chapitre et échoue sur softlock ou troncature.
- `npm run release-check` inclut prérequis, build, preuve exhaustive et audit des dépendances.

Ne pas activer de réduction d'ordre partiel en mode preuve tant que son équivalence avec l'exploration de référence
n'est pas démontrée pour la classe de jeux concernée.

## 6. Vérifier le jeu migré

```bash
GAME=<id> npm run doctor
GAME=<id> npm run build
GAME=<id> npm run prove:game
GAME=<id> npm run e2e -- http://127.0.0.1:5173/ --prod
```

Charger chaque sauvegarde v2 représentative et vérifier lieu, joueur actif, inventaires, choix persistants et étape de
script. Dans un fixture de test, réordonner une règle, un sujet, un choix et une étape de script : la même sauvegarde v3
doit garder son sens. Enfin, tester la PWA de production en ligne, hors ligne dans les lieux en cache et pendant une
mise à jour. Les lieux jamais visités ne sont pas garantis hors ligne.

## 7. En un coup d'œil

**Ce qui migre tout seul.** L'autosave v2 est importée dans IndexedDB au premier lancement v3 et vérifiée avant que
l'ancienne clé disparaisse. Une sauvegarde qui cite quelque chose que le contenu n'a plus est élaguée avec un toast
(`ui.saveAdjusted`), jamais refusée. Sans `id`, un bloc `once` / `nth` / `cycle` / `random` garde sa clé v2 par position,
les compteurs v2 survivent. Le témoin du solveur est inchangé (le jeu privé de référence : 59 actions, 355 états, 0,3 s
dans les deux versions).

| v2 | v3 |
|---|---|
| `npm run dev` écoute le réseau | `npm run dev` écoute 127.0.0.1 ; `npm run dev:lan` / `studio:lan` impriment une URL à jeton de session pour le téléphone |
| `npm test` lance tout | `npm test` = tests Node ; `npm run test:assets` = tests d'images (Python) ; `npm run check` = tsc + tests Node |
| `npm run build` = tsc + tests + vite | `npm run build` = `check` + `test:assets` + `verify:game` (validate, solve, `--chapters`, i18n status) + vite + spoilers + audit des assets |
| — | `npm run prove:game` = `--prove` et `--prove --chapters`, la porte exhaustive des softlocks, lancée par `release-check`, jamais par `build` |
| `npm run audit` | `npm run audit` (assets, noms privés) + `npm run audit:deps` (npm audit, dépendances de production) |
| — | `npm run doctor`, `npm run e2e:smoke`, `npm run e2e:pwa`, `npm run release-check` |

**Codes de sortie du solveur.** `0` résolu sans invariant cassé ; `1` non résolu, softlocks, erreurs ou invariant
cassé ; `2` tronqué. `--json` gagne `status`, `mode`, `softlocks`, `assumptions` ; la sortie humaine gagne une ligne
après le verdict (`Witness status:` / `Proof status:`), rien d'autre ne change.

| Où | Champ | Utilisé par |
|---|---|---|
| une règle de `on` (lieu ou jeu) | `id` | sauvegardes, graphe de puzzles, heatmap du solveur (`rule:<id>`) |
| une option de `choice` | `id` | choix `once` dans les sauvegardes, traductions, fichiers de voix |
| un sujet de dialogue | `id` | sujets `seen` dans les sauvegardes, traductions |
| un écouteur de `events` | `id` | écouteurs `once` dans les sauvegardes |
| `once` / `nth` / `cycle` / `random` | `id` | leurs compteurs dans les sauvegardes (`key` v2 encore lu, déprécié) |
| un script | `stepIds`, un par commande de `do` | la sauvegarde reprend au pas nommé après un réordonnancement |

**Nouvelles clés `ui`** (défaut anglais si absentes) : `saveFailed`, `saveAdjusted`, `updateAvailable`, `updateNow`.

## 8. Un jeu qui embarque le moteur (une copie de `src/engine`)

En plus de copier `src/engine/`, mettez à jour votre point d'entrée et votre config :

- `src/main.ts` : ouvrir le stockage avec `IndexedDbSaveStore.open(game, onError)` et le passer à `App` (l'adaptateur
  `localStorage` vérifié sert de repli quand IndexedDB manque) ; router les erreurs vers `app.reportStorageError` ;
  enregistrer le service worker vous-même avec `registerSW({ immediate: true, onNeedRefresh })` et
  `app.offerUpdate(...)`, car le plugin PWA passe en `registerType: 'prompt'` et `injectRegister: false` (la mise à jour
  attend une sauvegarde vérifiée au lieu de recharger sous les pieds du joueur) ; passer les mini-jeux à
  `applyLocale(game, table, minigames)`.
- `vite.config.ts` : `server.host` vaut `127.0.0.1` sauf `WEB_SCUMM_LAN=1` ; l'écriture des layouts et chaque route
  `/__studio` passent par `authorizeStudioRequest` (`tools/studio/security.ts`) ; les options PWA ci-dessus.
- `package.json` : les scripts de la section 7 (`tools/doctor.ts`, `tools/serve.ts`, `scripts/e2e-pwa.mjs`).
- Votre e2e : `scripts/e2e/lib.mjs` accepte `E2E_BROWSER=chromium|webkit|firefox` et `--prod` ; un script qui lit la
  sortie humaine de `npm run solve` continue de marcher (une ligne ajoutée, aucune changée).
- `env.d.ts` : `/// <reference types="vite-plugin-pwa/client" />`.
- Le `game` du moteur est un clone compilé (`compileGame`), gelé quand `schemaVersion` vaut 3 : un outil qui modifiait
  l'objet passé à `Engine` doit passer par l'API du moteur.
