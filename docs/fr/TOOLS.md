# Outils du moteur

Toutes les commandes se lancent à la racine du projet.

## Choisir le jeu (`GAME`)

Le dépôt peut contenir plusieurs jeux, chacun dans `games/<id>/`. Le jeu courant est, dans l'ordre :

1. la variable d'environnement `GAME` (`GAME=demo npm run dev`) ;
2. sinon `package.json` → `"config": { "game": "demo" }` ;
3. sinon `demo`.

La règle est codée une seule fois, dans `tools/game.ts`, et lue par `vite.config.ts` (alias `@game` → `games/<GAME>/index.ts`,
écriture des layouts de l'éditeur dans `games/<GAME>/layout/`), `tools/validate.ts`, `tools/solve.ts`, `tools/refs.ts` ; `tools/assets.py` refait la même lecture en Python.

`tsconfig.json` ne peut pas lire une variable : `npm run game` (`tools/select-game.ts`) réécrit ses deux chemins `@game` et `@game/*`
vers le jeu courant. `npm run dev` et `npm run build` le lancent d'abord ; après un `GAME=… npm run build`, `tsconfig.json` pointe sur ce jeu
(remettre le jeu par défaut avec `npm run game`). Vite et Vitest n'en ont pas besoin : ils résolvent l'alias dans `vite.config.ts`.

Les tests ne dépendent pas du jeu courant : les tests du moteur tournent sur `tests/fixture/` (un jeu minuscule), ceux d'un jeu importent
ses fichiers directement (`tests/demo.test.ts`, `tests/walkthrough.test.ts`).

## Jouer et déboguer

```bash
npm run dev        # serveur de dev, aussi joignable depuis un téléphone du réseau local
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
npm run solve      # prouve que la partie se termine ; liste les impasses et les objets jamais utilisés
npm run solve -- --from=<checkpoint> --max=50000
npm test           # tests du moteur sur tests/fixture (cœur, mini-jeux, outils), puis ceux de le jeu d'exemple
npm run e2e        # parcours dans Chromium en paysage téléphone (serveur de dev lancé)
```

`validate` et `solve` sortent en erreur (code 1) quand il y a un problème bloquant.

```bash
npm run solve -- --chapters        # une recherche bornée par checkpoint avec `goals`, puis du dernier à la fin
npm run validate -- --report       # le profileur de contenu : lieux, objets, personnages, ce qui est mince (Markdown)
npm run page:world                 # la carte du monde en page (sorties, gotos, lieux inaccessibles, source DOT)
```

`solve` signale aussi les **invariants** (`GameDef.invariants`) devenus vrais, avec le chemin. Le validateur avertit des
lieux que rien n'atteint et des sorties déclarées sans retour.
`validate` vérifie aussi les paramètres obligatoires des mini-jeux (`required` de chaque mini-jeu), les images citées dans leurs `params`,
chaque id de `skin` (images du manifeste, sons de `audio`) et `ending.scratch`.
`games/demo/e2e.mjs` est l'exemple d'un script `npm run e2e` propre à un jeu : il part de l'écran titre, joue pour de vrai les mini-jeux tuyaux et pioche ainsi que le ticket à gratter de la fin scellée au lieu de les passer, puis vérifie la carte finale.

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
