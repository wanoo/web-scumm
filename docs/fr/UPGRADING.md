# Passer un jeu de la v2 à la v3

*Version anglaise : [docs/en/UPGRADING.md](../en/UPGRADING.md). Ce qu'est la v3 et pourquoi : `docs/fr/ROADMAP.md`,
section v3 ; le détail des changements : `CHANGELOG.md`.*

La v3 casse la v2 volontairement (décision D1 dans `docs/dev/DECISIONS.md`) : le schéma de contenu gagne des ids
stables, la sauvegarde une enveloppe et un stockage vérifié, le solveur un mode preuve avec des codes de sortie
honnêtes, et le serveur de dev n'écoute plus le réseau par défaut. Un jeu v2 continue de tourner sur la v3 comme
« contenu v2 » pendant la beta ; cette page liste ce qu'il faut faire pour devenir un jeu v3, dans l'ordre qui coûte
le moins.

## 1. Rien à faire : ce qui migre tout seul

- **L'autosave.** Au premier lancement sur la v3, l'autosave v2 du `localStorage` est lue, écrite dans IndexedDB dans
  une enveloppe v3, vérifiée, puis l'ancienne clé est retirée. Les emplacements manuels et les fichiers exportés se
  lisent dans les deux formats.
- **Les références périmées.** Une sauvegarde qui cite un lieu, un prop, un objet, un script ou une place que le
  contenu n'a plus est élaguée, pas refusée : le joueur garde Continuer, le jeu affiche un toast (`ui.saveAdjusted`)
  qui liste ce qui a été retiré. Seules une corruption de structure, un lieu *courant* inconnu ou un joueur actif
  inconnu font refuser une sauvegarde.
- **Les clés de persistance de `once` / `nth` / `cycle` / `random`.** Sans `id`, la clé reste la position de la
  commande, comme en v2 : les compteurs des sauvegardes v2 sont conservés.
- **Le témoin du solveur.** `npm run solve` trouve le même chemin qu'en v2 (le jeu privé de référence : 59 actions,
  355 états, 0,3 s dans les deux versions).

## 2. Scripts et commandes

| v2 | v3 |
|---|---|
| `npm run dev` écoute le réseau | `npm run dev` écoute 127.0.0.1 ; `npm run dev:lan` / `studio:lan` pour le téléphone, avec un jeton de session imprimé au démarrage (`?token=…` sur les URL du Studio et de l'éditeur) |
| `npm test` lance tout | `npm test` = tests Node ; `npm run test:assets` = les tests d'images (Python) ; `npm run check` = tsc + tests Node |
| `npm run build` = tsc + tests + vite | `npm run build` = `check` + `test:assets` + `verify:game` (validate, solve, `--chapters`, i18n status) + vite + spoilers + audit des assets. La preuve exhaustive est `npm run prove:game` (`--prove`, `--prove --chapters`), lancée par `release-check`, jamais par `build` |
| `npm run audit` | `npm run audit` (assets et noms privés) + `npm run audit:deps` (npm audit, dépendances de production) |
| — | `npm run doctor` : Node, Python, ffmpeg, navigateurs Playwright, avec la correction pour chacun |
| — | `npm run e2e:smoke` (parcours générique du solveur sur un build de production), `npm run e2e:pwa` (le service worker s'installe, le jeu s'ouvre hors ligne), `npm run release-check` |

**Codes de sortie du solveur.** `0` résolu (et aucun invariant cassé), `1` non résolu, softlocks trouvés, erreurs ou
invariant cassé, `2` tronqué (le budget d'états s'est épuisé avant la réponse). `npm run solve -- --json` gagne
`status`, `mode`, `softlocks`, `assumptions`. La sortie humaine gagne une ligne après le verdict, `Witness status: …`
ou `Proof status: …` ; tout le reste est inchangé, les scripts qui la lisent continuent de marcher.

**Mode preuve.** `npm run solve -- --prove` explore tout le graphe atteignable et liste les états d'où la fin n'est
plus atteignable. C'est exhaustif, donc coûteux sur un grand jeu (voir `docs/fr/BENCH.md`), et la réduction d'ordre
partiel est coupée dans ce mode : donnez-lui `--max=<états>` et lancez-le là où vous pouvez vous le permettre.

## 3. Le contenu : `schemaVersion: 3`

Un jeu v3 déclare `schemaVersion: 3` dans `game.ts`. Dès lors `npm run validate` exige un **id stable** sur tout ce
qui est persisté, traduit ou nommé par les outils, et refuse les doublons :

| Où | Champ | Utilisé par |
|---|---|---|
| une règle de `on` (lieu ou jeu) | `id` | les sauvegardes, le graphe de puzzles, la heatmap du solveur (`rule:<id>`) |
| une option de `choice` | `id` | les choix `once` dans les sauvegardes, les traductions, les fichiers de voix |
| un sujet de dialogue | `id` | les sujets `seen` dans les sauvegardes, les traductions |
| un écouteur de `events` | `id` | les écouteurs `once` dans les sauvegardes |
| `once` / `nth` / `cycle` / `random` | `id` | leurs compteurs dans les sauvegardes (`key` v2 encore lu, déprécié) |
| un script | `stepIds: [...]`, un par commande de `do` | une sauvegarde reprend au pas nommé après réordonnancement du script |

Les ids sont des chaînes libres, uniques dans le jeu ; `games/_template` montre un nommage (`start.take-bucket`,
`start.first-arrival`). Le moteur, le solveur et le graphe de puzzles nomment une règle par son id quand elle en a un,
par sa position sinon (`src/engine/core/content-ids.ts`) : un jeu peut migrer lieu par lieu.

Ce que ça achète : une sauvegarde survit à des règles réordonnées, à des sujets et des choix réordonnés ou traduits,
à des pas de script déplacés ; le Studio et les tables de traduction nomment la même chose par le même id.

**Migrations.** `migrations[]` gagne `renameCounter`, `renameSeen`, `renameScript`, `renameScriptStep`,
`renamePlayer`, `renameCharacter`, `dropCounter`, `dropSeen`, `dropScript`, pour les clés qu'introduisent les ids.

**Textes.** Nouvelles clés `ui`, avec un défaut anglais si absentes : `saveFailed`, `saveAdjusted`,
`updateAvailable`, `updateNow`. Les tables de traduction (`npm run i18n -- extract`) gagnent les verbes
(`verb:<id>/label`, `/join`) et les textes visibles des mini-jeux (`….params.intro`, `….params.rounds[0].prompt`…) ;
un mini-jeu maison déclare les siens avec `textParams`.

## 4. Un jeu qui embarque le moteur (une copie de `src/engine`)

En plus de copier `src/engine/`, mettez à jour votre point d'entrée et votre config :

- `src/main.ts` : ouvrir le stockage avec `IndexedDbSaveStore.open(game, onError)` et le passer à `App` (repli sur
  l'adaptateur `localStorage` vérifié quand IndexedDB manque) ; appeler `app.reportStorageError` sur erreur ;
  enregistrer le service worker vous-même avec `registerSW({ immediate: true, onNeedRefresh })` et
  `app.offerUpdate(...)`, car le plugin PWA passe en `registerType: 'prompt'` et `injectRegister: false` (la mise à
  jour attend une sauvegarde vérifiée au lieu de recharger sous les pieds du joueur) ; passer les mini-jeux à
  `applyLocale(game, table, minigames)`.
- `vite.config.ts` : `server.host` vaut `127.0.0.1` sauf `WEB_SCUMM_LAN=1` ; l'écriture des layouts et chaque route
  `/__studio` passent par `authorizeStudioRequest` (`tools/studio/security.ts`) ; les options PWA ci-dessus.
- `package.json` : les scripts de la section 2 (`tools/doctor.ts`, `tools/serve.ts`, `scripts/e2e-pwa.mjs`).
- Votre e2e : `scripts/e2e/lib.mjs` accepte `E2E_BROWSER=chromium|webkit|firefox` et `--prod` (pas de `?dev`, pas de
  calque de debug).
- Votre `tsconfig`/`env.d.ts` : `/// <reference types="vite-plugin-pwa/client" />`.
- Le `game` du moteur est désormais un clone compilé (`compileGame`), gelé quand `schemaVersion` vaut 3 : un outil
  qui modifiait l'objet passé à `Engine` en comptant que le moteur le voie doit passer par l'API du moteur.

## 5. Vérifier

```bash
npm run doctor
npm run check && npm run test:assets
npm run verify:game            # validate, solve, chapitres, i18n status
npm run build                  # puis : npm run preview, et npm run e2e -- http://127.0.0.1:4173/ --prod
npm run prove:game             # la preuve exhaustive, quand vous pouvez vous la permettre (release-check la lance)
```

Sur un jeu long, lancez `--prove` chapitre par chapitre (`--prove --chapters`) avant de le lancer sur le jeu entier.
