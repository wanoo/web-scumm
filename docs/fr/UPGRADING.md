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
ligne en chaîne nue en `{ say: ['hero', texte], id }` : exigé pour un jeu livré dans une autre langue que la sienne
(`game.lang`, `en` par défaut) ou doublé ; la démo l'a fait en 3.2.1. `audio.voices[<id de ligne>]` joue sans écrire
`voice` sur la ligne. `npm run validate -- --release` signale une ligne sans id (une erreur, chaînes nues comprises,
dans un jeu traduit ou doublé : lancer `--lines=all` une fois ; un avertissement sinon) ; `npm run i18n -- voices` liste les lignes avec un id et sans clip, et les clips qu'aucune ligne ne réclame.

## 10. Lignes de listes (3.3) : regards, indices, réponses par défaut et réactions par sorte

Les lignes que le moteur tire d'une liste (une liste de regard, les lignes d'un indice, `rules.fallbacks.<verbe>`)
peuvent être `{ id, text }` au lieu d'une chaîne nue, un indice peut porter un `id`, et une réaction par sorte aussi
(`rules.kinds[i]`). Leurs traductions sont alors indexées par l'id (`room:house/look.pantry.<id>`,
`room:house/hints.<id d'indice>.lines.<id>`, `item:key/look.<id>`, `rules/fallbacks.look.<id>`,
`rules/kinds.<id>.say`), et `audio.voices[<id>]` les double. `npm run ids -- --lines=all --write --map` convertit les
chaînes nues des listes dans `rooms/*.ts`, `items.ts`, `rules.ts` et `game.ts`, nomme indices et sortes, et renomme les
clés de `locales/*.json` (`--lines` seul n'ajoute d'ids qu'aux objets qui n'en ont pas). Une ligne de regard unique
(`look: { door: '…' }`) est déjà indexée par son propriétaire et reste une chaîne. Une release traduite ou doublée les
exige, comme les lignes `say` (`validate -- --release`). Le Studio édite une ligne `{ id, text }` au même chemin qu'une
ligne nue (`look.pantry[1]`). La démo : 109 ids, 91 clés de traduction renommées par langue, français toujours à 400/400.

## 11. La scène (3.4) : rien à réécrire

Le `decor` d'un lieu est son calque de fond, et le `walk` de son layout est la zone de marche `main` (`stageOf`,
src/engine/core/stage.ts) : un ancien lieu garde son image (`npm run e2e:visual`) et ses sauvegardes (une scène
n'ajoute rien à l'état). Calques, occulteurs, lumières, particules, plusieurs zones de marche et leurs liens s'ajoutent
quand un lieu en a besoin (CONTENT_GUIDE « La scène »). Un layout qui a `walk` et `walkZones` garde les zones
(`validate` avertit).


## 10. De la 3.x à la 4.0

La 4.0 ne change aucun format : le schéma d'écriture reste 3, l'enveloppe des sauvegardes reste en schéma 3, et toute
sauvegarde 3.x se charge. Ce qui change, c'est ce qui est promis (`docs/fr/SUPPORT.md`) :

1. **Importer depuis l'API publique.** `web-scumm/content` (`defineGame`, `defineRoom`, chaque type de contenu),
   `web-scumm/player` (`bootGame`, `AssetManifest`), `web-scumm/minigames` (`Minigame`), `web-scumm/testing`
   (`Engine`, `solve`, `parseSave`…). Les chemins `@engine/*` marchent toujours mais sont internes. Dans un jeu de ce
   dépôt : `sed -i.bak -E "s#'@engine/core/(types|define|custom)'#'web-scumm/content'#" games/<id>/*.ts games/<id>/rooms/*.ts`, puis les
   autres à la main (`docs/fr/API.md` dit quel nom est dans quelle entrée).
2. **Un jeu dans son propre projet** (`docs/fr/PACKAGE.md`) : `npx create-web-scumm`, déplacer `games/<id>/*` dans
   `game/`, `npm install`, `npx web-scumm verify`.
3. **`RevealDef`** est déprécié : utiliser `EndingDef` (retiré en 5.0).
4. `npx web-scumm migrate --check` (ou `npm run migrate -- --check` ici) dit si quelque chose est dû.

## 12. De la 4.0 à la 4.1 « Clarity »

Rien à changer dans un jeu. Le format du contenu, l'enveloppe de sauvegarde, les quatre entrées publiques et les outils
MCP sont ceux de la 4.0.0 (`tests/api-surface.json` est identique) ; `npm install` du nouveau paquet est toute la mise
à jour, et une sauvegarde 4.0 se charge. Dans ce dépôt : `npm run lint` est désormais `npm run lint:content` (l'alias
reste pendant toute la 4.x), et `npm run quality` ajoute Biome et le TypeScript plus strict à ce que la CI vérifie.

## 13. De la 4.1.0 à la 4.1.1 « Reality Bridge »

Rien à changer : chaque ajout est optionnel. Un jeu qui veut des signaux de l'extérieur déclare `reality`
(`docs/fr/REALITY.md`), ajoute des scénarios sous `reality/scenarios/`, et fait tourner un Bridge (`web-scumm bridge`, ou
le paquet `web-scumm-bridge`). Une sauvegarde 4.1.0 se charge ; elle reçoit un état `reality` seulement quand un signal
est appliqué.

## 14. De la 4.1.1 à la 4.1.2 « Bridge fiable »

Rien à changer dans un jeu. Pour un Bridge : un `config.json` 4.1.1 sert et accorde encore (`grant` y lit la clé racine
tant qu'`init` n'a pas écrit un `root.key`) ; derrière un proxy inverse, lancer `serve --trust-proxy` pour que les
limites par adresse voient l'adresse du client ; `doctor` lit le journal, `compact` le réduit, Bridge arrêté. Le paquet
`web-scumm-bridge` tourne sur Node seul désormais (sans `tsx`). Une sauvegarde 4.1.1 se charge ; elle reçoit l'id de son
joueur au signal suivant.

## 15. De la 4.1.2 à la 4.1.3 « Gates honnêtes »

Rien à changer dans un jeu ni un Bridge. Dans ce dépôt : `npm test` ne lance plus les tests lourds du solveur
(`npm run test:heavy` le fait, chaque nuit) ; `npm run build:game` construit un jeu sans la suite unitaire ;
`release-check` est plus long (couverture, cross-check Rust, mutation du cœur). Les contributions à `main` passent par
une pull request.

## 16. De la 4.1.3 à la 4.1.4 « Moteur honnête »

Rien à changer dans un jeu. Un hôte qui embarque le moteur ou le joueur gagne `destroy()` pour les terminer, `onError`
pour entendre ce qui échoue, et `beforeSave` / `onLoad` là où il remplaçait `store.save` ou `engine.load` (ne le
faites plus : les hooks se composent). Les lignes de repli, de sorte et de don peuvent utiliser `{item}`, `{target}`,
`{name}` ; `{objet}`, `{cible}`, `{nom}` marchent toujours. Une sauvegarde 4.1.3 se charge telle quelle.

## 17. De la 4.1.4 à la 4.1.5 « Cœur réel »

Rien à changer dans un jeu, ni dans un hôte qui passe par l'API publique : `engine.session`, `begin`, `choose`,
`rand`, `destroy`, les hooks sont là où ils étaient. Un hôte qui atteignait les champs `@internal` `feed`, `open` ou
`sessionT0` du moteur les trouve sur `engine.sessions` (`feed`, `open`, `t0`) ; un qui atteignait `toScreen`,
`toLogical`, `setCamera`, `followHero`, `onCamera` ou `cam` de la vue de pièce les trouve sur `view.camera`, et
`walkTo`, `motion` et `clampFloor` (désormais `clamp`) sur `view.walker`. Une sauvegarde 4.1.4 se charge telle quelle.

## 18. De la 4.1.5 à la 4.1.6 « Outil de studio »

Rien à changer dans un jeu. Dans un checkout, les chemins `@game` de tsconfig.json passent par `.cache/game`, le lien
que `npm run game` crée (`dev`, `check` et `build` le créent aussi), et se rabattent sur `games/demo` quand il n'y en
a pas ; un `package.json` dont `config.game` nommait un jeu compte toujours, après le lien et `GAME`.
`npm run build` ne lance plus les tests pixel (`npm test` et la CI le font). `npm run doctor` sort 0 quand seuls
Python, ffmpeg ou WebKit manquent. `requirements.txt` épingle ses modules : `pip install -r requirements.txt` à
nouveau si les vôtres sont plus anciens. Une sauvegarde 4.1.5 se charge telle quelle.

## 19. De la 4.1.6 à la 4.1.7 « Docs pour un studio »

Rien à changer dans un jeu ni dans un hôte : la 4.1.7 change la documentation, les tests et les modèles du dépôt,
aucun code qu'un jeu exécute. Une sauvegarde 4.1.6 se charge telle quelle. Si vous gardez une copie d'`AGENTS.md`, sa
règle 14 et la section « Working in pairs » ont disparu ; `docs/fr/TUTORIAL.md` est la page à donner à un nouveau
venu.

## 20. De la 4.1.7 à la 4.1.8 « Foundation Reset »

Une sauvegarde 4.1.7 se charge telle quelle. Le `tsconfig.json` d'un projet écrit par `create-web-scumm` avant la 4.1.8
a `baseUrl: "."` et des `paths` non relatifs, que TypeScript 7 refuse (TS5102, TS5090) : `web-scumm migrate` le
réécrit (la même configuration, dite relativement au fichier ; un commentaire du fichier n'est pas gardé), `--check` dit quand c'est dû. Les vérifications de types
du moteur tournent sur TypeScript 7 (`npm run tsc`) ; un outil à vous qui importe l'API du compilateur (`import ts from
'typescript'`) ne trouve pas d'API dans `typescript@7` et importe `@typescript/typescript6` à la place jusqu'à la 7.1
(docs/dev/MIGRATION-4.1.8.md). Vite 8 et Vitest 5 demandent Node 22.12 ou plus. Le service worker prend le contrôle
de la page à sa première activation (`clientsClaim`), donc le préchargement d'une première visite remplit les caches ;
une mise à jour attend toujours la bannière, après une sauvegarde durable. Chaque nom de
`web-scumm/{content,player,minigames,testing,reality}` porte `@public` ou `@extension` dans `docs/fr/API.md` : ce que
`src/engine` exporte sans qu'une entrée le réexporte est interne, et environ quatre-vingts exports de ce genre ont
été dé-exportés ou retirés (aucune des cinq entrées n'a changé ; `tests/api-surface.json` est identique).
`npm run doctor -- --release` exige Python, ses modules et ffmpeg ; `npm run quality:baseline` écrit les trois chiffres
des README avec le JSON, donc un test de plus est suivi de cette commande. Un signal livré et non acquitté est livré
de nouveau depuis le curseur durable : un transport maison qui implémente `WorldSignalPort` garde la séquence
acquittée, pas la séquence reçue (`docs/fr/REALITY.md`).

## 23. De 4.1.11 à 4.1.12 « Language »

Aucun format d'écriture ne change : `web-scumm migrate --check` trouve à jour les jeux fournis et le gabarit
(`tests/migrate-official.test.ts` ; un projet 4.1.11 n'a rien à migrer non plus), et une sauvegarde 4.1.11 se charge telle quelle (les objectifs accomplis ne sont pas dans la sauvegarde : ce
qui est vrai au chargement compte comme fait). Ce qui est nouveau s'ajoute. Un jeu peut déclarer `objectives`
(ADR 0014, CONTENT_GUIDE « Objectifs et journal de quêtes ») : le menu pause les liste, le journal sémantique dit
`objectiveCompleted`, `npm run solve -- --goal=100%` les atteint, le validateur refuse celui qui ne peut jamais
s'accomplir. Un hôte abonné à `Engine.journal` voit ce genre pour un tel jeu. Le menu pause a une ligne d'empreinte
dans chaque jeu (`ui.fingerprint`, « Build » par défaut en anglais) : un jeu dont la langue de sortie n'est pas
l'anglais ajoute cette clé, et `ui.objectives` s'il déclare des objectifs, à son `ui` et à ses tables
(`npm run i18n -- status` liste les clés laissées aux valeurs anglaises). `web-scumm/content` gagne `compileIR`,
`canonicalJson`, `provenanceOf`, `logicView`, `completionGoal` et les types de l'IR ; `web-scumm/testing` gagne
`fingerprint`, `fingerprintGame`, `presentationOf`, `hashSources`, `sha256Hex`, `shortFingerprint` ; MCP gagne
`get_ir`, et `set_value` écrit les objectifs avec `id: "@game"`. Un build livre désormais `site.json` (celui du jeu,
avec l'empreinte des extensions de confiance et la version du moteur), que `npm run verify:dist` attend. Le cache de
preuves du solveur est indexé par `canonicalJson` : les entrées de 4.1.11 ne sont pas reprises, le prochain passage le
remplit de nouveau. Le DSL est stabilisé (D22, `docs/dev/DSL-STABILITY.md`) : désormais, changer un nom ou un sens
stable s'accompagne de sa migration.

## 26. De 4.1.14 à 4.1.15 « Remix »

**Une rupture de la ligne 4.1 : l'enveloppe de sauvegarde v4.** Une sauvegarde s'écrit désormais en
`SaveEnvelopeV4` (`schema: 4`) : l'enveloppe v3 et le `WorldVariant` dans lequel la partie a été jouée. `parseSave` lit
v3 et v4 ; une sauvegarde v3 (toute sauvegarde faite avant 4.1.15) migre vers le monde **histoire**
(`upgradeEnvelope`) et se charge comme avant ; les sauvegardes de référence de 3.0.0 à 4.1.9 se chargent sur 4.1.15
(`tests/save-v3.test.ts`). Ce qui casse : un code qui écrivait ou lisait lui-même `schema: 3` (un hôte qui range les
sauvegardes ailleurs, un outil qui vérifie le schéma de l'enveloppe) voit maintenant `schema: 4` et un champ `variant` ;
une sauvegarde faite dans un monde Remix refuse de se charger dans un autre monde (`SaveWorldMismatch`, qui nomme le
monde à reconstruire avec `applyVariant`). Une sauvegarde 4.1.15 ne se charge pas sur 4.1.14 (son schéma y est
inconnu) : revenir en arrière n'est pas pris en charge.

**Tout le reste est additif.** Un jeu peut déclarer `remix` (un manifeste de variance) et ses salles `anchors`
(`docs/fr/REMIX.md`) ; sans eux rien ne change : un seul monde, l'histoire, la même IR et la même empreinte. Les
drapeaux réservés `remix.*` sont écrits par le moteur : un jeu qui utilisait déjà un drapeau nommé
`remix.<quelque chose>` le renomme (le validateur refuse une commande qui en pose un ; aucun dans les jeux livrés). Un jeu avec un
manifeste montre un bouton **Remix** sur son écran titre et une ligne de monde dans son menu pause : un jeu dont la
langue de release n'est pas l'anglais ajoute les clés `ui.remix*` (`remix`, `remixTitle`, `remixStory`, `remixRandom`,
`remixSeed`, `remixDaily`, `remixPlay`, `remixInvalid`, `remixWorld`, `remixHidden`, `remixCopied`, `remixNoBridge`) à
son `ui` et à ses tables (`npm run i18n -- status` liste celles laissées à l'anglais). Les minijeux livrés gagnent
`code-wheel`. `Session.variant` et `IrVariantSlot.variant` sont de nouveaux champs optionnels ; `ir.world.remix` et
`ir.rooms[].anchors` apparaissent quand un jeu les déclare. Nouvelles commandes : `npm run remix`, `npm run
verify:variants` (dans `verify:game`), `npm run code-wheel`, `npm run e2e:remix`.

**Le DSL et l'IR sont gelés** (D28, `docs/dev/DSL-STABILITY.md`) : 4.1.15 est la release candidate de 4.2. Désormais
un changement de nom ou de sens du DSL ou de l'IR attend le SemVer strict de 4.2.0, avec sa migration.
