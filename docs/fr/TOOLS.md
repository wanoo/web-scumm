# Outils du moteur

Toutes les commandes se lancent à la racine du projet.

## Choisir le jeu (`GAME`)

Le dépôt peut contenir plusieurs jeux, chacun dans `games/<id>/`. Le jeu courant est, dans l'ordre :

1. la variable d'environnement `GAME` (`GAME=demo npm run dev`) ;
2. sinon `package.json` → `"config": { "game": "demo" }` ;
3. sinon `demo`.

La règle est codée une seule fois, dans `tools/game.ts`, et lue par `vite.config.ts` (alias `@game` → `games/<GAME>/index.ts`,
écriture des layouts de l'éditeur dans `games/<GAME>/layout/`), `tools/validate.ts`, `tools/solve.ts`, `tools/refs.ts` ; `tools/assets.py` refait la même lecture en Python.

`tsconfig.json` ne peut pas lire une variable : ses chemins `@game` et `@game/*` regardent dans `.cache/game`, un lien symbolique que
`npm run game` (`tools/select-game.ts`) pointe vers le jeu courant, avec `games/demo` en repli tant qu'aucun lien n'existe (4.1.6 ; jusqu'à
la 4.1.5 il réécrivait `tsconfig.json`, un fichier suivi, à chaque `dev` et `build`). `npm run dev`, `npm run check` et `npm run build` le lancent d'abord ; `GAME=<id> npm run game` et
`npm run new-game` changent de jeu, et les outils lisent le lien quand `GAME` n'est pas défini. Vite et Vitest n'en ont pas besoin : ils
résolvent l'alias dans `vite.config.ts`.

Les tests ne dépendent pas du jeu courant : les tests du moteur tournent sur `tests/fixture/` (un jeu minuscule), ceux d'un jeu importent
ses fichiers directement (`tests/demo.test.ts`, `tests/walkthrough.test.ts`).

## Jouer et déboguer

```bash
npm run dev        # serveur de dev limité à la machine locale
npm run dev:lan    # mode réseau local explicite ; affiche une URL avec jeton de session
npm run studio     # Studio limité à la machine locale
npm run studio:lan # Studio protégé par jeton sur le réseau local
```

Paramètres d'URL, serveur de dev uniquement (ils sont ignorés dans le build de production) :

| URL | Effet |
|---|---|
| `/` | Le jeu normal : écran titre, Nouvelle partie / Continuer. |
| `/?dev` | Démarre sur le premier checkpoint, avec le calque de débogage et le panneau DEV. |
| `/?dev&at=<checkpoint>` | Démarre sur ce checkpoint (défini dans `checkpoints` du jeu). |
| `/?edit=<lieu>` | Éditeur de placement du lieu. |
| `/?edit=<lieu>&at=<checkpoint>` | Même chose, dans l'état de ce checkpoint (utile pour placer un accessoire dans un état donné). |

### Le calque et le panneau DEV (`?dev`)

- **Calque**, affiché par-dessus la scène :
  - zones cliquables en bleu, accessoires en violet, personnages en vert ;
  - zone marchable en vert, trous (meubles) en rouge ;
  - lignes d'échelle en orange, points d'entrée en rose ;
  - points d'approche : plein s'ils sont définis dans le layout, creux s'ils sont calculés.
- **Afficher ou masquer le calque** : touche **D**, ou bouton **DEV** en bas à gauche (sur téléphone).
- **Panneau** :
  - lieu courant et état « occupé » (script en cours) ;
  - **Checkpoints** : charger un état prêt, ou démarrer une Nouvelle partie ;
  - **Lieux** : aller dans n'importe quel lieu, sans jouer son script d'arrivée ;
  - **Sac** : cocher ou décocher un objet ;
  - **Flags** : modifier les flags existants, ou poser un flag nom / valeur (`true`, `false`, un nombre ou un texte) ;
  - **Carte** : débloquer un lieu, ou **Tout débloquer** ;
  - **World** : le lieu de chaque personnage mobile (le changer les déplace, `moveActor`) ;
  - **Scripts** : la position de chaque script en cours (`commande suivante / longueur`, fini, arrêté), avec un bouton arrêter / relancer ;
  - **Journal** : les dix dernières entrées du journal du moteur (ce qui a répondu, événements, pas de script, déplacements, changements de joueur ; l'onglet Play du Studio le montre en entier), et **Export session** : les entrées depuis le début de la partie, pour `npm run replay` ;
  - **Éditer ce lieu** : ouvre l'éditeur sur le lieu affiché.

### L'éditeur de placement (`?edit=<lieu>`)

Au démarrage, l'éditeur charge le premier checkpoint situé dans ce lieu. S'il n'y en a pas, il part d'un état neuf, sans script d'arrivée. Toutes les coordonnées sont logiques (640 × 400).

| Geste | Effet |
|---|---|
| Glisser une zone | La déplacer, avec son point d'approche. |
| Glisser un coin | Redimensionner la zone. |
| Glisser un point de pied (rond) | Déplacer un accessoire ou un personnage, avec son point d'approche. |
| Glisser le carré au-dessus du pied, ou molette | Régler la hauteur. |
| Glisser un petit rond (plein ou creux) | Placer le point d'approche : l'endroit où le héros va avant d'agir. |
| Glisser un sommet de la zone marchable ou d'un trou | Le déplacer. |
| Double-clic sur un bord de la zone marchable | Ajouter un sommet. |
| Alt-clic sur un sommet | Le supprimer. Sur un trou réduit à 3 sommets, supprime le trou. |
| Glisser une ligne d'échelle orange | Changer sa profondeur (y). Le facteur d'échelle se règle dans le panneau. |
| Glisser un triangle rose | Déplacer un point d'entrée. |

Le panneau de l'éditeur contient :

- **Enregistrer le layout** : écrit `games/<GAME>/layout/<lieu>.json`, coordonnées arrondies à l'unité. La page se recharge alors avec le fichier enregistré.
- **Recharger (annuler)** : abandonne les modifications non enregistrées.
- **zones cachées** : montre aussi les zones et accessoires dont la condition de visibilité est fausse (en pointillés).
- **Sélection** : l'élément touché et ses valeurs.
- **À placer** : un bouton par hotspot, accessoire ou acteur défini dans le lieu mais absent du layout. Il le crée au centre, prêt à être déplacé.
- **Zone marchable** : créer la zone, ajouter un trou.
- **Échelle de profondeur** : créer l'échelle, régler les facteurs du fond et de devant.
- **Entrées** : ajouter un point d'entrée par son nom (`default` est celui utilisé par défaut).
- **Room width** : la largeur logique d'un lieu large (640 = pas de défilement) et un curseur de caméra pour regarder autour en plaçant.

Pour un accessoire qui a une position par état (`states` dans le layout, par exemple le tabouret tiré), l'éditeur modifie la variante de l'état affiché.

## Préparer les images et les sons

Avant `npm run assets`, une planche générée se découpe en sprites détourés avec `tools/cut-sheet.py <planche.png> <id-planche>`
(et les outils `tools/talk-kit.py`, `tools/talk-apply.py`, `tools/talk-normalize.py` pour les bouches qui parlent) :
voir `docs/fr/PROMPTS.md`. Les prompts eux-mêmes viennent de `npm run prompts` (`--missing` pour les planches pas
encore découpées), qui écrit `games/<id>/prompts.md`. Avec `"artStyle": "pixel"` dans `site.json` (ou `--pixel`),
le découpage réduit aussi chaque case 4× (`--scale`), la limite à 32 couleurs exactes (`--colors`) et écrit des PNG
indexés ; `npm run assets` écrit alors du WebP sans perte (voir PROMPTS.md, « Style graphique »).

```bash
npm run prompts    # un prompt prêt à coller par planche + les commandes de découpe → games/<id>/prompts.md
npm run assets     # prépare dans public/assets/ les images et sons cités par le contenu
```

`tools/refs.ts` liste les images et les sons cités par le contenu (lieux, personnages, objets, carte, paramètres des mini-jeux, `skin`,
écrans titre et générique, `ending.scratch`, et `extraImages` de `index.ts`), puis `tools/assets.py` les prépare.
La commande écrit `games/<GAME>/assets.gen.json` et ne retraite que ce qui a changé.

Sources par défaut d'un jeu :

| Quoi | Source | Sortie |
|---|---|---|
| image `planche/case` | `games/<id>/art/planche/case.png` | `public/assets/img/planche/case.webp` (rognée, 420 px au plus) |
| décor `decor/<nom>` | `games/<id>/art/decor/<nom>.png` | `public/assets/img/decor/<nom>.webp` (1280 × 800) |
| vidéo | `games/<id>/art/decor/<nom>.mp4` | `public/assets/video/<nom>.mp4` (720p, muette) |
| musique, bruitage | `games/<id>/audio/music/<fichier>`, `games/<id>/audio/sfx/<fichier>` | `public/assets/audio/{music,sfx}/<fichier>` |

`games/<id>/sources.json` remplace ces motifs (`{id}`, `{name}`, `{file}`). Un motif peut être une liste de candidats essayés dans l'ordre ;
un motif audio peut fixer son débit (`{ "path": …, "rate": "64k" }`). Un `.mp3` demandé peut venir d'un `.ogg` du même nom ;
un son sans source mais déjà présent dans `public/assets` est gardé tel quel. `overrides` traite une image à part :

```json
{
  "images": "private/extract/{id}.png",
  "decors": "private/asset/decor_{name}.png",
  "video": "private/asset/decor_{name}.mp4",
  "music": [{ "path": "private/audio/rendered/{file}", "rate": "64k" }, "private/audio/{file}"],
  "sfx": ["private/audio/sfx/{file}", "private/audio/sfx/densif/{file}", "private/audio/{file}"],
  "overrides": {
    "decor/carte_france": [
      { "src": "private/asset/decor_carte_france.png", "keyed": true, "fit": 1100, "quality": 85 },
      { "src": "private/asset/decor_carte.png", "crop": [75, 590, 400, 880], "size": [1100, 982] }
    ],
    "decor/fuite_souk": { "src": "private/asset/decor_fuite_souk.png", "height": 800 }
  }
}
```

Options d'un override : `keyed` (fond uni relié au bord rendu transparent, puis `fit` px au plus), `crop` [x0, y0, x1, y1], `size` [w, h],
`height` (largeur proportionnelle), `quality`. C'est le `sources.json` de le jeu d'exemple, dont les sources restent dans `private/`.

## Vérifier le contenu

```bash
npm run validate   # références cassées, textes vides ou trop longs, Regarder manquants, flags jamais posés ou jamais lus
npm run solve      # témoin rapide : trouve un chemin jusqu'à la fin
npm run solve -- --prove # preuve exhaustive : signale les états accessibles sans chemin vers la fin
npm run solve -- --from=<checkpoint> --max=50000
npm run solve -- --prove --workers=4 [--batch=64] [--time=60]   # workers de preuve (3.5) : le même résultat quel que soit leur nombre ; une grosse preuve ×2,5 avec 4 (BENCH.md « 3.5 »)
npm run solve -- --prove --ownership=off   # sans le propriétaire canonique (qui porte un objet libre, mis en commun dans les preuves depuis la 3.5)
npm run solve -- --dominance             # un témoin avec dominance (3.5 ; n'élague rien sur les jeux fournis, BENCH.md)
npm test           # tests Node du moteur, des outils et du jeu sélectionné (sans les tests lourds du solveur, 4.1.3)
npm run test:heavy # les tests du solveur gourmands en CPU (audits des abstractions, propriétaire canonique, preuves memo et ownership, preuve du chapitre de référence) : chaque nuit, des minutes chacun
npm run test:coverage   # la suite sous couverture V8, contre les planchers de vite.config.ts ; puis `npx tsx tools/coverage-ratchet.ts --strict` échoue sur un plancher d'au moins trois points sous ce que les tests atteignent (CI sur main et les tags, release-check, 4.1.8 ; sur une pull request il avertit, 4.1.9)
npm run quality:baseline -- --check [--dist]   # le comportement de la 4.0.0 conservé (4.1.0) : témoins, preuves, sauvegardes de référence, surface publique, première visite (tests/quality-baseline.json ; sans --check : l'écrit, et avec lui les trois chiffres des README : un test de plus ou un bundle plus léger demande de le lancer, 4.1.8)
npm run test:assets # tests Python des images et du pipeline d'assets
npm run e2e        # parcours dans Chromium en paysage téléphone (serveur de dev lancé)
```

`validate` et `solve` sortent avec le code 1 pour un problème bloquant. `solve` sort avec le code 2 si son budget
d'états est épuisé : c'est `truncated`, jamais une preuve. `npm run build` exige un chemin gagnant ;
`npm run prove:game` est la porte exhaustive explicite contre les softlocks et `npm run release-check` l'inclut.

```bash
npm run solve -- --chapters        # une recherche bornée par checkpoint avec `goals`, puis du dernier à la fin
npm run solve -- --prove --chapters   # la preuve par chapitres : chaque chapitre prouvé depuis CHAQUE état frontière atteignable du précédent ; un checkpoint qui n'en égale aucun est une erreur
npm run validate -- --report       # le profileur de contenu : lieux, objets, personnages, ce qui est mince (Markdown)
npm run page:world                 # la carte du monde en page (sorties, gotos, lieux inaccessibles, source DOT)
npm run page:puzzles               # le graphe de puzzles en page : ce que chaque règle exige et change, une fiche par objet / flag
npm run bench -- --matrix [--eras] [--max=20000]   # la table de référence 3.3 (--eras : personnages confinés à leur époque, le jeu de référence) : la preuve sur 20/40 lieux × 1/2/3 personnages, où part le temps (BENCH.md)
npm run bench -- --rooms=40 [--prove --v3]   # un jeu généré de cette taille, chaque outil chronométré dessus ; --prove ajoute la preuve exhaustive, --v3 le génère avec des ids stables (docs/fr/BENCH.md)
npm run i18n -- extract [--lang xx]   # tables de traduction (games/<id>/locales/<xx>.json) ; `status` pour la couverture
npm run solve -- --audit-abstractions   # la preuve avec les abstractions contre la recherche explicite, chaque saut de la mémoire lancé quand même : 0 identique, 1 divergence, 2 la recherche explicite ne tient pas dans --max (BENCH.md « 3.3.1 »)
npm run audit:corpus -- --seeds=500     # la même chose sur des jeux aléatoires (simples, objets libres, trois personnages), chaque nuit en CI (3.6) : 1 sur une divergence
npm run audit:corpus -- --from=126 --seeds=125 --json=s.json   # une tranche : essayés, comparés, partiels, divergents par sorte (3.6.1)
npm run audit:corpus -- --shard=1/4 --total=500 --json=s1.json  # tranche 1 sur 4 des graines 1–500, réparties également (3.7.1)
npm run audit:corpus -- --merge s0.json s1.json … --total=500   # tranches additionnées ; échoue sur une graine manquée ou lancée deux fois (3.7.1)
npm run solve -- --profile         # de quoi les états sont faits, ce que la recherche a coûté, ce que chaque abstraction a fait (docs/fr/BENCH.md)
npm run solve -- --por=stubborn    # réduction d'ordre partiel : les actions commutantes une à la fois (moins d'états, même preuve)
npm run replay -- session.json     # rejoue un fichier de session sur le vrai moteur, imprime le journal et l'état final
npm run ids [-- --write --map]     # ids stables (schéma 3) écrits dans les sources, locales renommées, l'étape de migration des sauvegardes (docs/fr/UPGRADING.md)
npm run ids -- --lines [--write --map]   # un id sur chaque objet say / toast / guide, ligne de liste, indice et réaction par sorte (--lines=all : les chaînes nues aussi, exigé pour une release traduite ou doublée) : traductions et voix indexées par lui (UPGRADING §9, §10)
npm run i18n -- voices             # les lignes avec un id et sans clip de voix, les clips qu'aucune ligne ne réclame
npm run voices -- status [--lang xx]                 # par langue : les lignes avec un id par statut (draft, record, recorded, approved), les clips, les orphelins
npm run voices -- export --lang xx [--json] > t.csv  # le tableau des comédiens : id, qui, le texte dans cette langue, statut, fichier, comédien, note
npm run voices -- import t.csv --lang xx             # leurs statuts, comédiens et notes reviennent dans games/<id>/voices.json (lignes inconnues refusées)
npm run voices -- check [--lang xx] [--release]      # chaque clip mesuré avec ffmpeg : codec, fréquence, durée pour son texte, niveau (≈ −16 LUFS), crête ; --release : une ligne approuvée exige son clip
npm run validate -- --release      # en plus : provenance, provisoires, et un id stable sur chaque ligne d'un jeu livré dans une autre langue que la sienne ou doublé
npm run verify:release             # validate --release + weight --release + statut i18n + playtests stricts : une étape de release-check
npm run verify:commercial          # verify:release, puis aucune exception, aucun provisoire, aucune licence NC/ND, chaque source vérifiable, puis verify:dist
npm run verify:dist                # chaque fichier de dist/ justifié : code, assets verrouillés (leurs octets revus), données nommées, polices, icônes, licenses/ (3.7.1)
npm run provenance [-- --lock]     # les assets livrés par licence, ce qui a changé depuis le verrou relu ; --lock enregistre les fichiers après une relecture
npm run weight [-- --release --json --stems]   # ce qu'un téléphone télécharge avant le premier lieu, par lieu et par chapitre, face à assetBudgets (les mix uniques ; les stems des partitions sur leur ligne, --stems les compte)
npm run playtests [-- --strict --out=.cache/playtests]  # les sessions partagées par les joueurs (games/<id>/playtests) rejouées et cumulées : temps par lieu, blocages, indices, heatmap
npm run playtests -- --strict --require=5 --require-completed=3 --require-devices=2   # quotas terrain (3.7.1) : --strict seul ne demande aucun nombre de sessions
npm run verify:field               # verify:commercial, puis ces quotas : ce qu'il faut à une release testée par des joueurs (pas une étape de release-check, D12)
npm run e2e:perf -- <url> [--renderer=canvas|dom --cpu=4 --min=30 --room=<id>]   # images par seconde pendant que le héros marche, CPU ralenti (le substitut du téléphone)
npm run e2e:music -- <url> [--only=offline|live|game --live=chromium|webkit]   # le directeur musical : 30 min hors ligne sans dérive, 100 changements sans clic, gigue en temps réel, les stems du thème dans le jeu
npm run e2e:music -- <url> --only=reference [--browser=webkit]   # GAME=reference : deux partitions, des ponts, une restauration et un arrêt en pleine transition, le pic décodé (Chromium et WebKit, 3.8)
npm run e2e -- <url> --renderer canvas  # le jeu entier dessiné par le peintre Canvas
npm run e2e:visual -- <url> [--update] # chaque lieu, figé, contre tests/visual/<jeu>/*.png (0,5 % des pixels au plus)
npm run e2e -- <url> --lang fr           # le jeu entier dans cette langue ; échoue sur tout texte anglais par défaut du moteur visible
npm run e2e:a11y -- <url> [--only=axe,keys,storage] [--allow-skip]   # axe sur la conversation, la carte, les emplacements, les confirmations, chaque mini-jeu ; chaque mini-jeu gagné au clavier ; une ancienne sauvegarde mise à niveau (E2E_BROWSER=chromium|webkit ; sortie 3 : une vérification que le navigateur ne peut pas automatiser)
npm run docs:screenshots [-- --only=game|studio --keep-png]   # les images du README depuis le bundle de production et le Studio, en WebP dans docs/img/ (Python avec Pillow)
npm run docs:links [-- --timeout=10000]                       # chaque lien externe des docs demandé une fois, statuts par domaine ; une personne le lance avant une release, jamais la CI (le réseau n'est pas un test)
npm run ci:plan [-- --base=origin/main | --files=a,b | --all]   # les jobs lourds de la CI dont un changement a besoin (4.1.9, tools/ci-plan.ts) : chaque fichier changé classé par la première règle qui lui correspond, une ligne de JSON (un booléen par porte : node24, e2e, reference, reality, pwaFirefox, windows, secondGame, freshInstall, upgrade, auditDeps) ; le workflow, le plan, une configuration partagée, le cœur du moteur et un chemin qu'aucune règle ne connaît lancent tout ; lecture seule
npx tsx tools/api-doc.ts [--check]                            # les signatures et la stabilité de l'API publique (@public | @extension, 4.1.8) dans docs/en/API.md et docs/fr/API.md ; tests/api-doc.test.ts échoue quand une page est en retard ou qu'un export n'a ni description ni stabilité
npm run lint [-- --prove | --static | --json]   # lint de contenu : conditions insatisfaisables, règles masquées, faux indices, indices bloqués, actions jamais jouées (alias de lint:content depuis la 4.1.0)
npm run quality   # code du moteur (4.1.0) : formatage et lint Biome, tsconfig.json et tsconfig.strictest.json, puis le lint de contenu
npm run doctor [-- --release]      # vérifie Node, modules Python, ffmpeg et navigateurs Playwright ; --release (4.1.8) exige Python, ses modules et ffmpeg, comme release-check, et Chromium comme toujours (release-check n'ouvre aucun navigateur : Firefox et WebKit restent optionnels)
npm run check                      # vérifie les types et lance les tests Node
npm run tsc -- …                   # le compilateur TypeScript 7 lui-même (4.1.8 ; le lien `tsc` peut appartenir au paquet typescript6 des outils) : `npm run check` et `quality` l'appellent
npm run build:game                 # les portes du jeu (verify:game), le bundle, verify:dist, le contrôle des spoilers, l'audit des assets : ni tsc ni suite unitaire (la CI les lance une fois)
npm run verify:game                # validation, témoins globaux/par chapitre et couverture des traductions
npm run prove:game                 # preuve exhaustive globale/par chapitre ; échoue sur softlock ou troncature
npm run release-check              # ce que la CI lance, d'un coup : doctor --release, quality, build, couverture et son ratchet strict, verify:release, preuves, le cross-check Rust, la mutation du cœur, les paquets avec `npm publish --dry-run`, les audits de dépendances
```

**Lint.** `npm run lint` dit ce que `validate` ne peut pas dire (il vérifie formes et références) et ce que `solve`
ne dit pas fort (il répond « ça se finit ? ») : depuis le graphe de puzzles, une condition que rien ne pose
(`cond-never-true`, une erreur), une règle qu'une autre attrape avant (`rule-shadowed`), un objet qu'aucune règle
n'exige (`item-red-herring`) ou que rien ne donne (`item-never-gained`), un indice qui attend ce que rien ne pose
(`hint-stuck`, une erreur) ou qui a le même `until` qu'un indice antérieur (`hint-never-fires`), un sujet, une option
de choix ou un écouteur morts, un choix à une seule option, une sortie conditionnée sans ligne `locked`, une action
qui ne change que ce que rien de vivant ne lit (`action-dead`, info), une cible derrière un lien de marche qu'une
condition ferme et dont la règle ne vérifie pas cette condition (`walk-link-gate` : le lien arrête la marche, jamais
l'action) ; après une passe du solveur, le fallback d'un signal requis que le témoin du monde fermé ne joue jamais (`fallback-unplayed`, un avertissement), une action vivante
que le témoin n'a jamais jouée et un lieu jamais atteint (`rule-never-run`, `room-never-reached` : info avec le
témoin, avertissements avec un `--prove` mené à terme ; une preuve tronquée les garde en info et le dit, elle ne
déclare jamais rien inatteignable), et une action vivante jouée sans jamais changer l'état (`rule-no-effect`, info :
un sujet qui ne fait que parler, un `set` déjà vrai). L'atteignabilité compte chaque essai du solveur, qu'il ait changé
l'état ou non. Chaque constat nomme son lieu et son chemin (celui de l'onglet Rooms), son id stable et quoi faire.
Codes de sortie : 0 propre, 1 une erreur non ignorée, 2 la recherche a été tronquée (`--json` porte `status` et
`truncated`). `lint: { ignore: ['code', 'code:<id>', 'code:<lieu>/<chemin>'] }`
dans `game.ts` garde un faux indice voulu. L'onglet Check du Studio montre la même liste avec des liens vers Rooms ;
l'outil MCP `lint` la renvoie en Markdown. `verify:game` le lance (la CI aussi).

**Cache de preuve.** Une exécution du solveur ne dépend que du code du moteur, du jeu (contenu, plans, commandes
personnalisées, et les sources du dossier du jeu) et des options : `npm run solve` (tous modes), `--chapters` et
`npm run lint` gardent chaque résultat dans `.cache/proofs/` et le rendent quand rien de cela n'a changé, en le disant
(`(from the proof cache, key …)` ; `cached` dans `--json`). Le build, `verify:game`, `prove:game` et `release-check`
posent plusieurs fois les mêmes questions ; sur la démo, une preuve en cache prend 0,2 s au lieu de 2,4 s.
`--no-cache` ou `PROOF_CACHE=0` relance ; `PROOF_CACHE_DIR` le déplace ; une erreur du moteur n'est jamais gardée. Les
tests appellent le solveur directement et ne s'en servent jamais.

**Un seul statut.** Une exécution du solveur et une preuve par chapitres portent un statut, son code de sortie et sa
phrase (`src/engine/tools/status.ts`) : `npm run solve` affiche la phrase et sort avec le code, `--json` porte
`status`, `exit` et `headline`, l'onglet Check du Studio montre la phrase, l'outil MCP `solve` rend les trois. Aucun
ne formule son propre verdict.

| Statut | Sortie | Sens |
|---|---|---|
| `solved` | 0 | la fin (ou le but d'un chapitre) est atteinte ; avec `--prove`, elle reste atteignable depuis tout état atteignable |
| `softlocks` | 1 | des états atteignables d'où on ne peut plus l'atteindre (`softlockCount`, `softlockCauses`) |
| `unsolved` | 1 | elle n'est atteinte depuis aucun état exploré |
| `truncated` | 2 | la recherche s'est arrêtée à `--max` états : rien n'est prouvé |
| `broken` | 1 | un invariant est vrai sur un état atteignable (avant la 3.3 : `solved` avec la sortie 1) |
| `error` | 1 | le moteur a échoué pendant l'exploration |
| `checkpoint_mismatch` | 1 | chapitres seulement : chaque chapitre est prouvé, mais un checkpoint n'est aucun de ses états frontière atteignables |

**Intégration continue.** Chaque push sur `main`, `v3` ou `v3-*` lance `npm run build` (vérifications, tests Node et
Python, `verify:game`, le bundle, les audits de spoilers et d'assets), `npm run prove:game` sur le jeu d'exemple,
`npm run audit:deps`, puis l'e2e de production en Chromium (le parcours propre à la démo) et WebKit (le rejeu
générique), tous deux bloquants, le jeu entier au clavier (Chromium et WebKit) et le jeu entier en français (Chromium), tous
bloquants depuis la 3.3.1. Un e2e ne passe que si la passe du solveur
est `solved` (code de sortie, statut et étapes vérifiés) et si le moteur lui-même annonce la fin (`state.done`) : un
jeu tronqué ou non résolu est un échec, jamais « le meilleur chemin rejoué quand même ». `main` déploie Pages. Le workflow `prove`,
hebdomadaire ou à la demande, lance la preuve et le bench sur un jeu de 100 lieux en schéma 3 dans un budget et
dépose `bench.md`. Un tag `v3.x` lance `npm run release-check` et publie la release GitHub avec la section
correspondante de `CHANGELOG.md` (`scripts/release-notes.mjs`). Dependabot propose chaque semaine les mises à jour
npm et actions, chaque mois pip.

**Playtests.** Sur un téléphone, **Partager la session** dans le menu pause envoie la session en fichier (Web Share,
sinon un téléchargement) : des ids et des index seulement, aucun texte, aucun journal. Déposez-le dans
`games/<id>/playtests/` (commité ; `npm run audit` le couvre). `npm run playtests` rejoue chaque fichier sur le contenu
courant et cumule : temps de jeu par lieu (un trou de plus d'une minute est une pause), où les joueurs bloquent (la
même action trois fois sans effet), indices montrés, mini-jeux joués, où chacun s'est arrêté, et une heatmap avec les
mêmes clés que celle du solveur (`--out` écrit `report.md`, `report.json`, `heat.svg`). Une session que le contenu a
dépassée est signalée comme divergente ; avec `--strict` (la porte de release : `release-check` et le workflow
hebdomadaire `prove`) c'est une erreur, code 1 : réenregistrer ou supprimer. `verify:game` le lance sans `--strict`,
donc la CI rejoue chaque playtest commité sans qu'un changement de contenu bloque un push. L'onglet Check du Studio montre le même rapport et laisse la chaleur du graphe
de puzzles venir des joueurs ; l'outil MCP `playtests` renvoie le Markdown.

**Sessions.** Le moteur enregistre chaque entrée depuis le début de la partie ou le chargement d'une sauvegarde
(actions, carte, changements de joueur, pas de script) avec les réponses données en chemin (choix, tirages
aléatoires). Le menu de sauvegarde du jeu, le panneau dev et l'onglet Play du Studio l'exportent en
`<jeu>-session.json` ; `npm run replay` la rejoue sans affichage et sort en code 1 à la première entrée dont l'issue
diffère de l'enregistrement (`--upTo=N` s'arrête avant, `--json` pour les scripts). Le rapport de bug d'un testeur,
c'est ce fichier et une capture. La solution du solveur est aussi une session (`npm run solve -- --json` donne
`steps`) : c'est elle que `npm run e2e` joue au doigt.

`solve` signale aussi les **invariants** (`GameDef.invariants`) devenus vrais, avec le chemin. Le validateur avertit des
lieux que rien n'atteint et des sorties déclarées sans retour.
`validate` vérifie aussi les paramètres obligatoires des mini-jeux (`required` de chaque mini-jeu), les images citées dans leurs `params`,
chaque id de `skin` (images du manifeste, sons de `audio`) et `ending.scratch`.
`games/demo/e2e.mjs` est l'exemple d'un script `npm run e2e` propre à un jeu : il part de l'écran titre, joue pour de vrai les mini-jeux tuyaux et pioche ainsi que le ticket à gratter de la fin scellée au lieu de les passer, puis vérifie la carte finale.

## Provenance des assets

`games/<id>/provenance.json` dit d'où vient chaque asset livré : des entrées `{ match, source, licence, author?, url?,
prompt?, status: 'final' | 'placeholder', note? }`, où `match` couvre des clés d'assets avec `*` (`img:<id d'image du
manifeste>`, `sfx:<fichier>`, `music:<fichier>`, `voice:<fichier>`, `video:<fichier>`). `npm run validate` vérifie un
jeu qui a le fichier (chaque asset couvert par une seule entrée : deux entrées qui couvrent le même asset sont une
erreur, quel que soit leur ordre ; chaque entrée complète) ; `npm run validate -- --release` exige le fichier, et un
provisoire est une erreur sauf si une entrée `releaseExceptions: [{ match, reason }]` nomme cet asset (une exception
ne couvre jamais un provisoire ajouté plus tard). Une release exige aussi une politique de licences,
`licences: { allow: ['CC BY 4.0', 'own work'] }` (toute autre licence échoue sauf si une exception nomme l'asset), et
`provenance.lock.json` : `npm run provenance -- --lock` écrit, après une relecture, l'empreinte SHA-256 et la taille de
chaque fichier livré avec ce que son entrée affirmait (motif, licence, statut). `validate --release` échoue ensuite sur
un fichier modifié, un asset livré depuis, un fichier manquant ou une entrée modifiée depuis la relecture ; un
`validate` simple ne fait qu'avertir. `npm run provenance` liste les assets par licence et ce qui a changé depuis le
verrou (sortie 1 quand quelque chose est à relire). Les fichiers sont lus dans `public/assets` (`ASSETS_DIR` pour une
fixture). **Poids.** `npm run weight` additionne ce qu'un téléphone télécharge, d'après les fichiers construits et le graphe
d'assets (ENGINE « Assets ») : avant que le premier lieu soit jouable (le shell que le service worker précache, lu dans
`dist/sw.js`, compressé comme l'envoie un hébergeur statique, avec les fichiers qu'une première visite paie deux fois ;
le titre, les icônes de la colonne, le sac au départ, le premier lieu), par lieu (décor, accessoires dans tous leurs
états et images d'animation, chaque personnage qui peut s'y tenir avec ses variantes, ses bouches et son portrait, sa
musique, et ce que ses commandes jouent ou montrent : bruitages, changements de musique, voix, icônes des objets
gagnés, correspondants au téléphone, images et sons d'un mini-jeu), et par chapitre (chaque lieu où un joueur peut se
trouver pendant ce chapitre, d'après la preuve par chapitres), avec la mémoire décodée des images (largeur × hauteur ×
4). `assetBudgets: { initialKB, roomKB, chapterKB }` dans `game.ts` sont les limites ; en dépasser une, ou un fichier
manquant, sort avec 1. Elles comptent le mix unique de chaque morceau, ce que joue tout appareil. Depuis la 3.6, le
reste a aussi ses budgets :
- `backgroundScoreKB` : les stems des partitions, téléchargés une fois le lieu jouable là où le directeur les joue ;
- `offlineTotalKB` : tout ce que garde le préchargement complet, application de base comprise ;
- `decodedAudioMB` : la plus grosse partition décodée en mémoire (son `pcmBytes` ; inconnu compte comme dépassé) ;
- `transitionPeakMB` (3.6.1, exigé avec `audio.transitions`) : le plus de décodé à la fois, les deux partitions de la
  pire transition et son pont, plus le plus gros stinger (`{ music: { stinger } }`). Ponts et stingers sont mesurés
  par ffprobe ; non mesuré compte comme dépassé. Le directeur tient le côté exécution : `audio.maxDecodedMB` plafonne
  chaque buffer qu'il garde, et une transition qui le dépasse coupe, sans son pont (docs/fr/AUDIO.md).
- `initialJsKB` (3.9) : le JavaScript compressé (gzip) qu'une première visite exécute (l'entrée et ses imports
  statiques), mesuré sur le build par `npm run verify:dist`, pas par `weight` : les mini-jeux, le panneau de dev et le
  Studio se chargent à la demande (`src/engine/BOUNDARIES.md`). La démo exécute 122 Ko, le chapitre de référence
  124 Ko, tous deux tenus à 140.
 `--release` (une étape de `verify:release`) échoue aussi quand un budget n'est pas fixé.
`--json`. `npm run e2e:weight -- <url>` (bloquant en CI depuis la 3.4) vérifie la prédiction contre une vraie première
visite dans Chromium, préchargements coupés : chaque requête dans la portée initiale prédite, les octets à 10 % près ou
en dessous.
`npm run new-game` en écrit un pour les images empruntées à la démo
(toutes provisoires, CC BY 4.0) ; celui de la démo n'a aucune exception : chacun de ses assets est CC BY 4.0 depuis la 3.7.
`npm run verify:release` (validate `--release`, `i18n -- status`, playtests stricts) est une étape de
`npm run release-check`, donc le workflow de release le lance. Ce qu'une exception laisse passer est affiché par son
nom comme accepté, pas comme un avertissement à corriger. **Une release commerciale.** Un `verify:release` vert ne veut
pas dire que chaque asset peut être vendu : une exception est une raison, pas une licence. `npm run verify:commercial`
(`verify:release`, puis `validate --commercial`) refuse toute entrée `releaseExceptions`, tout provisoire, toute licence
non commerciale ou sans modification (`NC`, `ND`), et toute entrée sans `author` ou sans source vérifiable (une `url`,
ou un fichier du dépôt nommé dans `source`). Il vérifie que les affirmations sont complètes et permettent la vente,
pas qu'elles sont vraies. La démo le passe depuis la 3.7 (son thème est écrit pour le projet) ;
`tests/fixtures/release-game` y échoue exprès. **Ce que l'archive contient (3.7.1).** Les vérifications ci-dessus
lisent le graphe d'assets du jeu ; l'archive, c'est ce que Vite copie dans `dist/`, et `public/` est partagé par les
jeux du dépôt. Chaque build se termine donc par `tools/dist.ts seal` (un plugin Vite) : les assets qui ne sont pas
ceux du jeu sont retirés, et `dist/licenses/` est écrit : la `LICENSE` du moteur, `LICENSE-ASSETS` (celle du jeu s'il
en a une), `CREDITS.md` tiré de sa provenance, `THIRD_PARTY_NOTICES.txt` (la licence de chaque paquet dont le bundle a
pris du code, celle de Workbox pour le service worker, l'OFL des polices) et `assets-manifest.json` (chaque fichier :
chemin, auteur, source, licence, SHA-256, statut). Puis `npm run verify:dist` (une étape de `npm run build`, donc de la
release) classe chaque fichier de `dist/` : code, asset verrouillé dont les octets sont ceux revus, fichier de données
nommé par le jeu (`ending.file`), police, icône, notice. Tout le reste échoue, comme un fichier verrouillé ou une notice
manquants. La release joint le manifeste des assets à côté de l'archive. Traductions : un texte identique à la source fait échouer
`npm run i18n -- status`, sauf si `i18n: { same: [chemins] }` dans `game.ts` le liste (un nom, « OK », une flèche).
`npm run audit` est une autre vérification : il garde les noms d'un projet privé hors du dépôt public.

## La fin scellée

```bash
mkdir -p games/<GAME>/private && cp games/<GAME>/ending.config.example.ts games/<GAME>/private/ending.config.ts   # puis remplir les textes (corriger le chemin de l’import)
npm run seal -- --outcome=<clé>     # une des clés de `outcomes` : chiffre uniquement l'issue choisie
npm run build && npm run check:spoilers   # vérifie qu'aucun texte d'aucune issue n'est en clair dans dist/
```

Les clés de `outcomes` sont libres (`scripts/seal-types.ts`, type `EndingConfig`) ; la clé scellée est comparée au flag du pronostic (`ending.guess.flag`).
Sans `games/<GAME>/private/ending.config.ts`, `npm run seal` utilise l’exemple commité. Le mot de passe de la configuration doit être identique à `ending.password` dans `games/<GAME>/game.ts`.
Le format du dossier (`ticket`, `headline`, `message`, `photos`, `lines`, `outcome`) ne change pas : un `dossier.bin` déjà scellé reste valide.

## Déployer

`npm run build` produit un `dist/` statique (le jeu, ses assets, le service worker). N'importe quel hébergeur statique convient.

**GitHub Pages (intégré).** Le workflow CI (`.github/workflows/ci.yml`) lance les vérifications à chaque push et, sur `main`,
publie `dist/` sur Pages. À activer une fois dans les réglages du dépôt : Pages → Source → « GitHub Actions ». Le site vit
sous `https://<utilisateur>.github.io/<dépôt>/`, donc le workflow construit avec `BASE_PATH=/<dépôt>/` : tous les chemins
(assets, polices, manifeste, service worker, fichier de la fin scellée) respectent cette base. Un domaine à la racine n'a pas besoin de `BASE_PATH`.

```bash
BASE_PATH=/mon-depot/ npm run build      # la même chose en local
```

**Clever Cloud (ou tout hôte Node).** `npm start` sert `dist/` avec sirv. Sur Clever Cloud : une application Node avec
`CC_NODE_DEV_DEPENDENCIES=install` (Vite est une dépendance de dev) et `CC_POST_BUILD_HOOK=npm run build:web`, puis `clever deploy`.

```bash
npm run assets                           # si des images ou des sons ont changé (les fichiers générés sont commités)
npm run build                            # vérifications locales : types, tests, build, spoilers, audit
node scripts/e2e.mjs https://<votre-site>/   # joue la version en ligne de bout en bout
```

`games/<id>/private/` n'est jamais envoyé : il est exclu par `.gitignore`. **Avant de partager un jeu à fin scellée** : sceller
la vraie issue (`npm run seal -- --outcome=…` avec `games/<id>/private/ending.config.ts`), puis `npm run build`, commit, déploiement.

## Tous les autres scripts

Les scripts ci-dessus sont ceux dont un jeu a besoin. Le reste de `package.json` est listé ici pour que chaque
`npm run` ait une ligne (4.1.7 ; un script absent de cette page fait échouer `tests/scripts-documented.test.ts`) :

| Script | Quoi |
|---|---|
| `npm run preview` | sert `dist/` sur 127.0.0.1 (ce vers quoi les scripts e2e sont pointés après un build) |
| `npm start` | sert `dist/` sur toutes les interfaces au port `$PORT` (8080 par défaut) avec `sirv`, via `scripts/start.mjs` (un lanceur Node : il tourne aussi sous Windows, 4.1.8) : ce qu'un hébergeur comme Clever Cloud lance |
| `npm run test:node` | la suite unitaire sans les tests liés à Python ni ceux qui saturent le processeur (`npm run check` la lance ; les lourds tournent la nuit) |
| `npm run test:mutation:core [-- --set=core\|reality\|all --file=… --fresh --hash --doc]` | les tests de mutation des modules dont dépendent une sauvegarde, une session, une condition ou un signal (`docs/dev/MUTANTS.md`) ; un rapport dont le hash des entrées (sources, tests, configurations, lockfile) est l'actuel est réutilisé sauf `--fresh` ; `--hash` affiche ce hash (la clé du cache de la CI) ; `--doc` écrit la table des survivants nommés dans MUTANTS.md |
| `npm run e2e:smoke` | le parcours générique du build de production (le chemin du solveur rejoué au tactile) |
| `npm run e2e:pwa [-- --serve=dist --update --interrupted --reinstall --allow-skip]` | la PWA dans un vrai navigateur (`E2E_BROWSER`) : installée, tout le jeu préchargé puis ouvert hors ligne ; avec `--serve=dist` le script sert lui-même le build et peut en publier un second : `--update` (la bannière, la sauvegarde gardée, le nouveau worker aux commandes), `--interrupted` (le chargement du worker échoue : pas de bannière, l'ancien sert), `--reinstall` (worker et caches supprimés, réinstallés, la sauvegarde gardée) ; `--allow-skip` accepte la navigation hors ligne de WebKit, que Playwright ne sait pas piloter |
| `npm run e2e:studio`, `e2e:taps`, `e2e:reality` | le Studio, les verbes par défaut, le Reality Bridge, chacun dans un vrai navigateur |
| `npm run migrate` | un projet de jeu passé à cette release (`web-scumm migrate` ; `docs/fr/UPGRADING.md`) |
| `npm run lint:content`, `lint:code` | le lint du contenu seul (`npm run lint` l'enchaîne avec une passe du solveur), le lint de Biome seul |
| `npm run format`, `format:check` | le formatage de Biome, écrit ou vérifié (`npm run quality` vérifie) |
| `npm run mcp` | le serveur MCP du jeu courant sur stdio (`docs/fr/MCP.md` ; `npm run -s mcp` pour un client) |
| `npm run icons` | `public/icons/*.png` et `public/og.png` depuis le `site.json` du jeu |
| `npm run audit:assets` | chaque fichier de `dist/` justifié avec sa licence (`npm run build:game` le lance) |
| `npm run audio -- …` | le pipeline de musique et de bruitages Mega Drive (`docs/fr/AUDIO.md`) |
| `npm run build:studio-demo`, `studio-snapshot`, `studio-apply <patch>` | le build statique du Studio, son instantané seul, un patch de démo appliqué à votre copie (`docs/fr/STUDIO.md`, « Mode démo ») |
| `npm run pack [-- --publish-dry-run]` | les archives `web-scumm`, `create-web-scumm` et `web-scumm-bridge` qu'une release livre (`docs/fr/PACKAGE.md`), depuis les seuls fichiers suivis : un fichier non suivi sous une racine livrée fait refuser l'emballage (4.1.8) ; `--publish-dry-run` montre ce que `npm publish` enverrait |
| `npm run fresh-install`, `upgrade-check` | un jeu créé depuis l'archive et joué jusqu'à sa fin, `create-web-scumm` installé depuis sa propre archive et lancé, le Bridge installé et servant ; un jeu fait sur la release précédente migré, mis à niveau et joué (la CI lance les deux) |
| `npm run ship -- <checks\|merge\|main\|tag\|watch\|verify\|chain> …` | la chaîne de release en commandes (4.1.8) : attendre les checks d'une pull request (une relance d'un job en échec), la fusionner, attendre la CI de `main` sur la fusion, taguer et pousser, suivre la CI du tag puis le run de release, télécharger la release et vérifier ses sommes et ses attestations ; `chain <pr> <version>` enchaîne tout. Chaque commande écrit son PID dans `.cache/pids/` |
| `npm run page:storyboard`, `page:review`, `page:placement`, `import-layout` | les pages de relecture pour téléphone et l'import de la page de placement (`docs/fr/PAGES.md`) |
| `npm run bridge -- …` | la ligne de commande du Reality Bridge (`docs/fr/REALITY-OPS.md`) |
| `npm run solve:reality`, `reality:spike`, `reality:xcheck` | le solveur sous chaque scénario de réalité, une sonde de charge du Bridge, la contre-vérification Rust du protocole (`docs/fr/REALITY.md`) |
