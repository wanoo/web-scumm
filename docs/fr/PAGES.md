# Pages de relecture : valider depuis un téléphone

Trois pages HTML générées permettent à l'auteur de vérifier le jeu loin de l'ordinateur : le **storyboard**, la **page
de relecture des sprites** et la page de **placement**. Chacune est un fichier autonome unique (images intégrées, pas
de serveur), destiné à être publié comme artefact claude.ai : l'auteur annote depuis un téléphone, l'IA relit les
annotations et agit en conséquence.

```
npm run page:storyboard              # → dist-pages/storyboard.html   (nécessite games/<id>/storyboard.json)
npm run page:storyboard -- --md      # écrit aussi games/<id>/storyboard.md (texte brut pour les agents)
npm run page:review                  # → dist-pages/review.html
npm run page:placement                # → dist-pages/placement.html
npm run import-layout -- <file|dir>  # fusionne les layouts exportés dans games/<id>/layout/<room>.json (--dry pour prévisualiser)
```

Options : `--out <dir>` ou `--out <file.html>`. Le jeu est le jeu courant (`GAME=<id>`, sinon `package.json`
`config.game`) ; `GAME_DIR=<path>` pointe vers un dossier de jeu hors de `games/` (par exemple `tests/fixture`).

Les images viennent de `games/<id>/art/` (en suivant `sources.json` comme `npm run assets`), ou de
`public/assets/img/` préparé quand le manifeste du jeu les liste. Avec `python3` et Pillow installés, elles sont
réduites en vignettes WebP (en cache dans `.cache/pages/`) ; sans, les fichiers sont intégrés tels quels et la page
devient plus grosse. Garder une page sous 16 Mo (le générateur avertit au-delà).

## Les trois pages

**Storyboard** (`tools/pages/storyboard.ts`, schéma dans `tools/pages/storyboard-schema.md`). Une section par
tableau : le décor du lieu, l'objectif, puis chaque case avec son action, ses répliques (portrait, nom, texte), ses
sons, et un espace de notes. Suivent les sujets de conversation, les réactions optionnelles et les indices. Les notes
vont dans la collection `notes` (id de doc = id de case ; aussi `general`, `<board>__talk__<character>`,
`<board>__reactions`, `<board>__hints`). Ce que Claude écrit dans la collection `rewrites` sous le même id apparaît en
vert sous la note.

**Relecture des sprites** (`tools/pages/review.ts`). Chaque dossier de `games/<id>/art/` est une planche, chaque
image qu'il contient une case (les dossiers imbriqués, comme les kits de parole, sont inclus : la case est
`pose/t1`). Chaque case est marquée *utilisée* quand le jeu la référence (mêmes règles que `tools/refs.ts` et
`npm run assets`, donc les surcharges de `sources.json` comptent), avec les ids qui la citent. Les ids que le jeu
cite mais qu'aucun fichier ne fournit sont listés en haut. Par case : garder / refaire / inutilisé et une note,
enregistrés dans la collection `decide` (id de doc `<sheet>__<cell>`, valeur `{ choice, note, sheet, cell, used,
updatedAt }`). Filtres : tout, utilisé, non utilisé, à décider, à refaire.

**Placement** (`tools/pages/placement.ts`). Un lieu à la fois, sur son décor (640 × 400 unités logiques, mis à
l'échelle de l'écran). Glisser avec un doigt ou la souris :
- les accessoires et personnages par leur corps (les pieds = le point blanc), leur hauteur avec le point bleu, leur
  point d'approche avec le losange rose (« Add approach » en crée un) ; les personnages sont dessinés à leur échelle
  de profondeur, comme dans le jeu ;
- les zones cliquables (rectangles : déplacer, redimensionner avec le point du coin ; polygones : glisser les
  points) ;
- les points de la zone marchable (sélectionner « Walk area » ; toucher un point, puis « Add point » après lui ou
  « Delete point ») ;
- les entrées (anneaux ; le héros est dessiné en transparence sur `default`, à son échelle) et les deux lignes
  d'échelle (tirets bleus).

Tout ce qui est absent du layout est affiché au centre avec un badge « to place », en pointillés, et n'est écrit
qu'une fois déplacé. Chaque changement enregistre `{ room, layout }` dans la collection `layouts` (id de doc = id du
lieu). « Export room » donne le layout du lieu, sous la même forme que `games/<id>/layout/<room>.json` ; « Export
JSON » donne `{ "layouts": { "<room>": … } }`. La page ne modifie pas les positions par état, la rotation, `z` ni
`on` : ces clés sont conservées telles quelles. Pour un travail fin, utiliser l'éditeur en jeu (`npm run dev`, puis
`?edit=<room>`).

## La page du monde

`npm run page:world` dessine les lieux et les passages entre eux (sorties déclarées en trait plein, commandes `goto` en
pointillés, lieux sur la carte marqués), liste les lieux inaccessibles et les sorties sans retour, et imprime la source
DOT pour Graphviz. Lecture seule : pas d'annotations, pas de base d'artefact ; la même image est dans l'onglet Check du Studio.

## La page des puzzles

`npm run page:puzzles` dessine le graphe de puzzles : les choses (objets, flags, accessoires, lieux de la carte,
événements, personnages déplacés) en couleur, les actions (règles, sujets, scripts, écouteurs, objectifs de chapitre) en
blanc ; flèches grises pour ce qu'une action exige, pointillées quand c'est lu dans ses commandes, vertes pour ce qu'elle
produit, rouges tiretées pour ce qu'elle consomme. Toucher une chose affiche sa fiche : obtenu par, consommé par, utilisé
par, exige d'abord, débloque, en aval. La page liste ce qui est lu mais jamais produit et ce qui est produit mais jamais
utilisé, imprime le tableau récapitulatif et la source DOT. Lecture seule.

## Où vont les annotations

Chaque page affiche une ligne de statut en haut et un bouton **Export JSON**. Elle fonctionne selon trois modes :

1. **Publiée comme artefact, avec la capacité `db`** : chaque changement est enregistré dans la base de données de
   l'artefact (et la page suit les changements en direct, y compris ceux de Claude). Statut : « Connected ».
2. **Ouverte comme simple fichier** (un navigateur, une pièce jointe d'email) : les changements sont enregistrés dans
   le `localStorage` du navigateur. Export JSON copie les données dans le presse-papiers et télécharge un fichier
   `.json` : à renvoyer.
3. **Lecture seule** (le lecteur ne peut pas forcément écrire dans la base) : les modifications restent sur
   l'appareil ; Export JSON fonctionne quand même.

Une copie locale est toujours conservée, pour qu'une page rouverte sur le même appareil montre ce qui a été saisi,
même hors ligne.

## Publier et relire (Claude Code)

1. Générer la page, puis la publier avec l'outil Artifact, en déclarant la base de données : `capabilities: { db: {}
   }`. Republier sur la même URL après chaque régénération (même chemin de fichier dans la même session, ou passer
   `url`) : la base de données est conservée d'une version à l'autre.
2. Envoyer le lien à l'auteur. Seules les personnes avec droit d'édition (Contributor ou plus) peuvent écrire.
3. Lire les annotations avec l'outil **ArtifactData**, `action: "list"`, sur l'`url` de l'artefact :
   - storyboard : collection `notes` ; répondre en écrivant `rewrites/<panel id>` avec `{ "text": "…" }` (`set`) ;
   - relecture : collection `decide` ; lister les cases `redo` avec leurs notes, un prompt de régénération par
     planche ;
   - placement : collection `layouts` ; sauvegarder les documents dans un fichier JSON et les importer.
4. Si l'auteur a utilisé un simple fichier à la place, il envoie le JSON exporté : même contenu, à lire directement.

## Importer des layouts

```
npm run import-layout -- exported.json          # un fichier
npm run import-layout -- ./layouts/ --dry       # tous les .json d'un dossier, prévisualisation seulement
```

Fichiers acceptés : l'Export JSON de la page (`{ "layouts": { … } }`), l'Export room (`<room>.json`, le lieu est le
nom du fichier), un document de la base (`{ "room", "layout" }`), ou une liste de documents comme ArtifactData les
renvoie (`[{ "id", "data": { "room", "layout" } }]`).

Seules les clés présentes dans l'export changent : `hotspots`, `props`, `actors` et `entries` sont fusionnées id par
id (chaque objet fusionné en surface), `walk`, `scale` et `floor` sont remplacées quand elles sont présentes. Les
suppressions faites sur la page (« Unplace », « Remove approach ») ne sont donc pas importées : il faut supprimer ces
clés à la main ou dans l'éditeur en jeu. La commande affiche chaque changement (`+` ajouté, `~` modifié). Lancer
ensuite `npm run validate` et regarder le lieu (`?dev&at=<checkpoint>`).
