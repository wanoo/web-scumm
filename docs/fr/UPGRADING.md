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

Laisser l'outil écrire les ids, puis les relire :

```bash
npm run ids                  # simulation : ce qui serait écrit, ce qui reste à faire à la main
npm run ids -- --write --map # écrit les ids dans rooms/*.ts, rules.ts, game.ts ; renomme les clés de locales/*.json ;
                             # écrit ids.migration.json (renameSeen / renameCounter) et ids.paths.json
```

Il nomme d'après le contenu (`house.open-pantry`, `house.grandma.where-is-the-key`, `house.open-pantry.once`,
`clock.wait`), de façon unique dans le jeu et déterministe. Ce qu'il pose : un `id` sur chaque `Rule` de lieu ou
globale, `TalkTopic`, `Choice`, `EventRule`, bloc `once` / `nth` / `cycle` / `random` ; sur chaque script, une entrée
`stepIds` par commande de premier niveau. Les listes construites par du code (un spread, un `.map(...)`) sont sautées
et rapportées avec l'id attendu par le moteur : ajoutez-le dans le générateur. Puis trois lignes à la main dans
`game.ts` : `schemaVersion: 3`, `saveVersion` + 1, `migrations: [idsMigration]` avec `import idsMigration from
'./ids.migration.json'`. `npm run validate` refuse un jeu v3 avec un id manquant ou en double ; `npm run ids` se
relance à volonté (rien n'est renommé deux fois). Les règles de sortie générées reçoivent des ids déterministes.

## 3. Migrer les sauvegardes volontairement

Le navigateur stocke une enveloppe `web-scumm-save` de schéma 3 dans IndexedDB. Au premier lancement v3, l'ancienne
autosauvegarde localStorage `<jeu>.save` est importée une fois et supprimée seulement après relecture de l'écriture.
Les emplacements manuels (`saves.slots`) vivent dans la même base, en enveloppes, vérifiés de la même façon ; les
entrées v2 `<jeu>.slot.<n>` sont importées une fois aussi. Un fichier importé depuis le menu de sauvegarde atterrit
en plus dans le premier emplacement libre.

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

En v3 les chemins de traduction nomment par id (`room:house/on.house.open-pantry.do[1]`, `talk.grandma.<id>.topic`,
`.choice.<id>.text`, `events.<id>.do`) ; `npm run ids -- --write` a renommé les tables existantes (`ids.paths.json`
garde la correspondance). Lancer `npm run i18n -- extract --lang <xx>` pour chaque langue livrée. La v3 extrait aussi les libellés/mots de liaison
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
doit garder son sens. Enfin, tester la PWA de production en ligne, hors ligne dans un lieu jamais visité
(`npm run e2e:pwa` le fait) et pendant une mise à jour. Le jeu entier est mis en cache après la première visite,
sauf si le jeu dit `offline: 'nearby'` (décision D5).

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

**Nouvelles clés `ui`** (défaut anglais si absentes) : `saveFailed`, `saveAdjusted`, `updateAvailable`, `updateNow`, `advance`, `offlineStatus`, `offlineComplete`, `offlineRetry` (3.1.1 : la ligne « hors ligne » du menu pause)
(3.1, le repère « toucher pour continuer » pour les lecteurs d'écran), `shareSession` (3.1, la ligne playtest du menu pause).

## 8. Un jeu qui embarque le moteur (une copie de `src/engine`)

Votre `src/main.ts` ne recopie plus l'amorçage : il appelle `bootGame` (`src/engine/boot.ts`) et ne dit que ce qui
est propre à votre build :

```ts
import { bootGame } from '@engine/boot';
import { game, layouts, manifest, minigames, commands, locales } from '@game';

void bootGame({
  game, layouts, manifest, minigames, commands, locales, version: __ASSETS_VERSION__,
  dev: { enabled: (q) => import.meta.env.DEV && (q.has('dev') || q.has('edit')) },
  sw: { register: () => import('virtual:pwa-register') },   // ou `sw: false` sans vite-plugin-pwa
});
```

`bootGame` choisit la langue (`?lang=`, le choix sauvegardé du joueur, le navigateur), attend les polices, ouvre le
stockage IndexedDB vérifié (ses premières erreurs atteignent l'App dès qu'elle existe ; sans IndexedDB, l'adaptateur
`localStorage` vérifié prend le relais), construit l'`App`, expose `window.__game` pour les pilotes e2e, lance les
outils de dev quand `dev.enabled` le dit (`dev.patch` peut remplacer le jeu, les layouts et le stockage avant, comme
la démo du Studio), affiche le titre, et enregistre le service worker par le module que vous injectez, la mise à jour
n'étant proposée qu'après une sauvegarde vérifiée. Les briques sont exportées séparément (`pickLanguage`,
`waitFonts`, `openStore`) quand un jeu a besoin d'un autre ordre.

Ce que votre build garde : `vite.config.ts` avec `server.host` sur `127.0.0.1` sauf `WEB_SCUMM_LAN=1`, l'écriture
des layouts et chaque route `/__studio` derrière `authorizeStudioRequest` (`tools/studio/security.ts`), et VitePWA en
`registerType: 'prompt'`, `injectRegister: false`, `skipWaiting: false` (obligatoire avec la proposition de mise à
jour) ; `package.json` avec les scripts de la section 7 (`tools/doctor.ts`, `tools/serve.ts`, `scripts/e2e-pwa.mjs`) ;
`scripts/e2e/lib.mjs` (`E2E_BROWSER`, `--prod` ; un script qui lit la sortie humaine de `npm run solve` continue de
marcher) ; `env.d.ts` avec `/// <reference types="vite-plugin-pwa/client" />`. Le `game` du moteur est un clone
compilé (`compileGame`), gelé quand `schemaVersion` vaut 3 : un outil qui modifiait l'objet passé à `Engine` doit
passer par l'API du moteur.

## 9. Ids de lignes (3.2) : des traductions et des voix qui survivent à une insertion

Chaque `say`, `toast` et `guide` peut porter un `id` stable (`house.open-door.l-just-a-door` : son propriétaire, puis
le début de son texte). Une table de traduction et un clip de voix sont alors indexés par lui : insérer, déplacer ou
supprimer une ligne ne décale jamais les autres. `npm run ids -- --lines --write --map` donne leurs ids aux objets qui
n'en ont pas et renomme les clés de `locales/*.json` (une seconde passe renomme depuis les chemins courants ; rien de
déjà consigné dans `ids.migration.json` / `ids.paths.json` n'est perdu) ; `--lines=all` transforme d'abord chaque
ligne en chaîne nue en `{ say: ['hero', texte], id }` pour un jeu qui double ou traduit chaque ligne (verbeux : la démo
garde ses chaînes nues, indexées par leur propriétaire et leur position). `audio.voices[<id de ligne>]` joue sans
écrire `voice` sur la ligne. `npm run validate -- --release` signale une ligne sans id (depuis la 3.2.1 une erreur, chaînes nues comprises, quand
le jeu a plus d'une langue ou des voix : lancer `--lines=all` une fois) ; `npm run i18n -- voices` liste les lignes avec un id et sans clip, et les clips qu'aucune ligne ne réclame.
