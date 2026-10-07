# Remix : plusieurs mondes d'un même jeu (4.1.15)

Remix permet à un même jeu de produire plusieurs parties vraiment différentes (où se trouve un objet, où un
personnage commence et quelle tournée il fait, un code et son indice, l'ordre de deux groupes d'énigmes, une réplique
de même intention) sans transformer l'histoire en contenu aléatoire. Chaque variation est déclarée par l'auteur, finie,
déterministe à partir d'une seed, et comprise par le validateur, le solveur, les sauvegardes, le replay, le Studio et
les outils de speedrun. La conception est l'ADR 0018 (`docs/dev/adr/0018-variation-manifest-and-world-variant.md`) ;
les décisions sont D25 à D28.

## Ce qui varie, et ce qui ne varie jamais

Une dimension fait varier une chose parmi des valeurs que l'auteur énumère, chacune avec sa valeur **histoire** (le
monde tel qu'il est écrit). `item-placement` met un objet sur l'une de plusieurs ancres taguées ; `actor-start` fait
commencer un personnage dans l'une de plusieurs salles ; `actor-route` choisit l'un de plusieurs scripts comme
tournée ; `coupled` tire ensemble un code et son indice ; `puzzle-order` choisit un ordre de groupes d'énigmes qui
garde les arêtes de l'auteur ; `presentation` choisit une réplique, une image, une palette ou un paramètre de minijeu.
Remix ne réordonne jamais les règles (leur ordre peut porter un sens), n'écrit jamais un texte, n'invente jamais une
dépendance : l'auteur écrit chaque branche avec les conditions que le DSL a déjà.

## Déclarer un manifeste

Le manifeste est `remix` dans `game.ts`. Celui du jeu d'exemple (`games/demo/game.ts`) déplace la clé du garde-manger :

```ts
remix: {
  schema: 1, algorithm: 'web-scumm-remix-1',
  modes: [
    { id: 'story', strategy: 'catalogue', dimensions: [] },
    { id: 'remix', strategy: 'catalogue', dimensions: ['key-spot', 'oranges-line'] },
  ],
  dimensions: [
    { id: 'key-spot', kind: 'item-placement', item: 'key', logical: true,
      anchors: [{ room: 'market', anchor: 'stall' }, { room: 'market', anchor: 'oranges' }, { room: 'market', anchor: 'lantern' }],
      story: { room: 'market', anchor: 'stall' } },
    { id: 'oranges-line', kind: 'presentation', target: 'line:market.take-oranges.l-oranges-are-not', logical: false, story: 0,
      values: [{ en: 'Oranges are not sardines…', fr: '…' }, { en: 'An orange. Round, bright…', fr: '…' }] },
  ],
  constraints: [{ kind: 'not-behind', item: 'key', action: 'house.use-key-pantry' }],
},
```

Une valeur logique différente de sa valeur histoire écrit le drapeau réservé `remix.<dimension>` au début de la partie
(`remix.key-spot` = `market.oranges`) ; le contenu le lit avec `{ flag: 'remix.key-spot', eq: 'market.oranges' }`. Le
monde histoire n'écrit aucun drapeau : chaque condition s'écrit pour les autres valeurs et l'histoire garde son texte.
`games/demo/rooms/market.ts` remet la clé dans l'histoire, dit où elle est cachée sinon, et laisse Pixel la prendre
sous les oranges ou dans la lanterne. Le validateur avertit d'une valeur qu'aucune condition ne lit.

## Ancres et placement d'objets

Une ancre est un emplacement tagué d'une salle, `anchors` dans `rooms/<salle>.ts` : `at` (le prop ou le hotspot sur
lequel il se trouve), `visible`, `reachableBy` (ce qu'il faut pour l'atteindre), `capacity` (1 par défaut : deux objets
ne le partagent jamais sauf s'il le dit) et `phase` (une étiquette par laquelle le Studio regroupe). Le validateur
refuse une ancre posée sur rien, une ancre dans une salle que le départ ne peut atteindre, et une ancre qu'on n'atteint
qu'avec l'objet qui y est placé ; la contrainte `not-behind` retire les ancres situées derrière une règle qui exige
l'objet. `exclusive` sépare des dimensions ; `requires` (`a=x` exige `b=y`) lie deux valeurs.

## Personnages, codes et ordres

`actor-start` change la salle de départ du personnage (chaque salle candidate doit déclarer un acteur pour lui), et le
solveur prouve que le personnage est là où chaque monde a besoin de lui. `actor-route` nomme des scripts : le `while`
de chacun lit le drapeau (`games/reference/game.ts`, `seller_rounds` et `seller_rounds_late`). `coupled` associe un
indice (un texte, ou un par langue) à une réponse : `{code:<id>}` dans n'importe quel texte devient la réponse et
`{hint:<id>}` l'indice, dans toutes les langues à la fois, après la traduction ; le contenu accepte la réponse par le
drapeau (`games/reference/rooms/hall.ts`, le mot de passe de la fête, et la devinette de Grand-mère dans
`kitchen.ts`). `puzzle-order` écrit la position de chaque groupe (`remix.festival-order.board` = 0 quand le panneau
vient d'abord).

## Variance de présentation

La cible d'une dimension `presentation` est `line:<id de réplique>`, `prop-img:<salle>.<prop>`, `palette:<personnage>`
ou `minigame:<id de règle>:<paramètre>` (un texte ou un décor de minijeu seulement : un paramètre qui pourrait décider
d'une victoire, comme les réponses d'une roue ou une difficulté, est refusé, puisqu'une preuve est indexée par le
monde logique). Elle tire du flux `cosmetic`, n'écrit aucun drapeau, ne prend aucune
contrainte, et reste hors de l'espace du solveur (D27) : deux mondes qui ne diffèrent que par la présentation
partagent leur preuve. Ajouter une dimension de présentation ne déplace aucun tirage logique.

## Seeds et mondes

Une seed est `story` ou un code `WS-XXXX-XXXX` : sept symboles en base32 de Crockford et un symbole de contrôle. La
saisie pardonne la casse, `I`, `L` et `O` ; un symbole faux est une erreur explicite, jamais un autre monde. Le même
jeu, le même manifeste, la même seed et la même version d'algorithme donnent le même `WorldVariant` (seed, algorithme
et version, empreinte du manifeste, mode, une valeur par dimension, un SHA-256) ; c'est testé dans Node, et la
vérification sur Chromium, WebKit et Firefox (`npm run e2e:remix`) est écrite mais n'a pas encore tourné.
Les tirages viennent du seul générateur à seed, un flux par dimension ; `Math.random` est interdit dans
`src/engine/core` par le linter et par un test. Un code ne dit rien du joueur (`docs/dev/threat-models/remix-seed.md`).

## Stratégies par mode

Chaque mode dit ce qui soutient ses mondes (D25). Un **catalogue** énumère chaque monde logique (10 000 au plus) et
chacun est validé et résolu : chacun est un gate de release. Un **générateur** construit un monde par construction ;
ses invariants sont testés par propriétés et son échantillon publié de seeds est résolu : on ne dit jamais que toutes
les seeds sont prouvées. Les jeux livrés n'utilisent que des catalogues. Mesuré le 7 octobre 2026 avec `npm run
verify:variants -- --prove --max=200000` (preuve exhaustive par monde logique, aucun blocage) : `demo`, histoire 1 et
remix 3 mondes ; `reference`, histoire 1, et remix, daily et mystery 24 mondes chacun. Le chemin générateur est exercé
par une fixture de test (`tests/fixtures/remix-extension.ts`, 527 280 mondes logiques) : 10 000 seeds donnent des
mondes valides (test par propriété), aucun n'est déclaré prouvé.

## Outils

`npm run remix -- --seed <code>` imprime un monde et son empreinte (`--json` le `WorldVariant` entier, `--mode`) ;
`--preview <code>` y ajoute `validate` et un témoin du solveur sur ce monde ; `--record=20` enregistre les seeds de
playtest. `npm run verify:variants` vérifie chaque mode : chaque monde d'un catalogue, l'échantillon d'un générateur
(`--sample`), avec la couverture par dimension et par couple, les valeurs jamais choisies, les dominantes sur 1 000
seeds (`--draws`), et un certificat par monde logique dans `.cache/proofs/variants/` ; `--prove` lance la preuve
exhaustive, `--out` écrit le rapport que la release publie. `npm run e2e:remix` compare les mondes et les roues de code
de 50 seeds sur les quatre runtimes.

## Sauvegardes, replays et speedruns

Une sauvegarde est l'enveloppe v4 (`SaveEnvelopeV4`) : l'enveloppe v3 et le monde. Une sauvegarde faite avant 4.1.15
reçoit le monde histoire. Une sauvegarde n'est jamais chargée dans un autre monde : `SaveWorldMismatch` nomme le monde
à reconstruire. La session enregistre le monde (`Session.variant`), et un replay le reconstruit depuis l'affectation
stockée, jamais depuis la seed avec un générateur plus récent. Les catégories de speedrun sont Story, Fixed (une seed
publiée), Random (tirée au départ et montrée), Mystery et Daily ; Fixed et Daily classent chaque seed à part
(`leaderboardKey`), et `worldVerdict` vérifie le monde d'une course contre ce que sa catégorie permet.

## Le défi du jour et Mystery

Le module quotidien du Bridge (`bridge/src/daily.ts`) signe la seed et les règles du jour pour 24 heures (`GET
/v1/daily`) ; le joueur vérifie le jeton hors ligne avec la clé publique de `remix.daily`. Mystery est un engagement :
`POST /v1/commit` publie le hash signé d'une seed et d'un nonce avant la course, `GET /v1/reveal/:id` la seed après.
La seed du jour ne dépend que du jour et une seed Mystery est fixée avant que son engagement soit signé : le Bridge ne
choisit jamais une seed après avoir vu des actions (D26). La clé quotidienne de la référence est une clé de test
publiée, ses défis montrent le mécanisme, pas la confiance ; le module n'est pas monté sur le serveur HTTP du Bridge
dans cette release.

## La roue de code

« The Extremely Legitimate Pirate Check » est un minijeu, `code-wheel` : deux disques tirés des personnages, symboles
et réponses du jeu ; tourner le petit disque jusqu'à placer un symbole sous un personnage et lire sa fenêtre. La seed
la tire du flux `copy-protection`, donc la même seed donne la même roue partout ; le validateur vérifie que chaque roue
a une solution ; le solveur la traite comme gagnable. Modes : `parody` (le défaut : trois mauvaises réponses et elle
laisse passer), `story`, `strict`, `cosmetic`, `disabled`, `daily`. Elle tourne avec des boutons, les flèches et une
manette, annonce chaque tour, liste la roue entière en texte, et ne s'anime pas sous mouvement réduit. `npm run
code-wheel -- --game <id> --format svg|pdf` imprime les disques, les repères de découpe, le trou central et un livret,
en couleur et en version économique (PDF avec Pillow). C'est une reconstitution ludique, jamais un DRM ; la direction
artistique est celle du jeu.

## Le joueur et le Studio

L'écran titre gagne **Remix** (après Nouvelle partie et Continuer) : l'histoire, un nouveau monde, une seed tapée ou
le défi du jour. La page redémarre dans le monde choisi. Le menu pause montre le code à copier, ou « caché jusqu'à la
fin » dans un mode masqué. Les options d'accessibilité ne touchent jamais la seed. Un lien nomme un monde (`?seed=`,
`?daily=`, `?world=`). L'onglet **Remix** du Studio liste les dimensions, prévisualise une seed, verrouille des
dimensions et relance les autres, compare deux mondes, dessine un ordre d'énigmes, compte couverture et biais, liste
les ancres et en ajoute une depuis la sélection de l'onglet Salles, et joue ou exporte un monde.
