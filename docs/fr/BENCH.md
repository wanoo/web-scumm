# Banc d'essai : un jeu généré de n'importe quelle taille

*Version anglaise : [docs/en/BENCH.md](../en/BENCH.md). Les mesures v3.1 (4 octobre 2026, schéma 3, preuve exhaustive) sont à la fin. Chiffres mesurés le 3 octobre 2026 (v2.3.0) sur un
portable ; ils bougent avec la machine, les rapports non.*

`npm run bench -- --rooms=40 --players=3 --items=30 --flags=100 --npcs=5 --scripts=10 --topics=40 --max=200000`
génère un jeu de cette taille (`src/engine/tools/stress.ts`) et chronomètre chaque outil dessus. Le jeu est une
chaîne : l'objet de chaque lieu ouvre le verrou du suivant, les personnages jouables se relaient aux frontières de
chapitre, des promeneurs patrouillent entre deux lieux et émettent des événements, des horloges tournent un lieu sur
deux, des sujets enchaînent des flags, des babioles vont dans des bacs, dix migrations de sauvegarde artificielles
mènent à la version courante, un checkpoint avec objectifs clôt chaque chapitre, deux invariants surveillent le premier
objet. Pas d'art : les layouts sont des rectangles. Une version à dix lieux tourne dans `tests/bench.test.ts`.

## Résultats

| Étape | 40 lieux, 3 joueurs, 39 objets, 119 règles, 40 sujets, 10 scripts | 100 lieux, 5 joueurs, 119 objets, 300 flags, 100 sujets, 30 scripts |
|---|---|---|
| validate | 15 ms, 0 erreur | 41 ms, 0 erreur |
| rapport de contenu | 24 ms | 103 ms |
| graphe du monde + SVG | 1 ms | 2 ms |
| graphe de puzzles + SVG | 16 ms, 554 nœuds | 72 ms, 1 399 nœuds |
| textes : extraction + traduction | 4 ms, 697 textes | 8 ms, 1 752 textes |
| migration d'une sauvegarde v1 (10 étapes) | 2 ms | 4 ms |
| solve, chapitre 1 | 0,1 s, 156 états, 273 exécutions du moteur | 0,2 s, 343 états, 524 exécutions |
| solve, dernier chapitre | 0,1 s, 257 états, 466 exécutions | 7,6 s, 3 290 états, 5 435 exécutions |
| solve, jeu entier | 0,3 s, 624 états, 123 actions, 1 110 exécutions | 5,8 s, 2 901 états, 309 actions, 4 499 exécutions |

Tous les outils sauf le solveur sont linéaires et instantanés. Le solveur est celui à surveiller.

La v2.3 lui fait faire trois fois moins d'exécutions du moteur pour les mêmes états : une action qu'aucune règle
écrite ne peut répondre (quelles que soient les conditions) ne peut que retomber sur une ligne Regarder, une réaction
par kind ou le repli, donc elle n'est plus exécutée du tout (le profil les compte en *skipped*). Sur le jeu d'exemple :
2 076 exécutions sont devenues 280 pour les mêmes 35 états.

## Ce que le solveur fait d'un gros jeu

L'espace d'états d'un jeu d'aventure est le produit de tout ce qui peut varier indépendamment. Avant la v2.1 le
solveur hachait chaque flag, chaque objet et chaque position de script : la version à dix lieux de ce jeu, avec ses
horloges, ses promeneurs, ses flags « regardé » et ses babioles, atteignait la limite de 20 000 états après 54 secondes
sans finir.

La v2.1 demande au graphe de puzzles ce qui peut encore changer l'issue (`liveness` dans
`src/engine/tools/puzzle.ts`) : les lieux, les lieux de la carte, les joueurs, la fin et les objectifs de chapitre
sont vivants ; une action est vivante quand un de ses effets atteint quelque chose de vivant ; une chose (objet, flag,
accessoire, position d'un personnage, événement) est vivante quand une action vivante la lit. Le reste sort de l'état et
des actions essayées : un flag que seul son poseur lit (un marqueur « regardé »), une babiole qu'aucune porte n'exige,
une horloge que personne ne lit, un promeneur que personne n'attend, une chaîne de sujets qui finit dans un flag que
rien n'utilise. Le même jeu à dix lieux prend maintenant 102 états ; celui à quarante 624 ; celui à cent 2 901.

Ce qui multiplie encore les états, par construction, c'est ce qui compte : les choses vivantes indépendantes. Dix
objets facultatifs qui ouvrent chacun quelque chose, dans n'importe quel ordre, font 2^10 états. La réponse honnête
pour un jeu long reste :

1. **Les chapitres** (`checkpoints` avec `goals`, `npm run solve -- --chapters`) : chaque chapitre est prouvé depuis
   le checkpoint précédent, avec seulement ses propres choses vivantes. Le dernier chapitre ci-dessus coûte 3 290
   états ; le jeu entier 2 901, parce que la recherche globale abandonne ce que les chapitres précédents ont consommé.
2. **Les invariants** pour les bugs « plus jamais », vérifiés sur chaque état exploré.
3. Le graphe de puzzles pour voir, avant de résoudre, de quoi une chose dépend et ce qu'elle débloque.

Une résolution globale d'un jeu de 100 lieux et 5 joueurs en six secondes ne promet pas que chaque jeu de 15 heures
sera prouvé d'un coup. Elle dit que les outils du moteur suivent le contenu, et que le solveur dépense son budget sur
les puzzles.

## Quand ça devient lent : le profil

`npm run solve -- --profile` (le « Solver health » de l'onglet Check, l'outil `solve` avec `profile: true`) dit
pourquoi :

```
SOLVER PROFILE
  states explored       35
  engine runs           280  (211 changed nothing, 35 landed on a known state)
  actions not run       1808  (no rule could answer them)
  actions per state     22.3 on average, 27 at most (house, 3 items in the bag…)

What splits the states (states that would merge without it):
      13  room  (3 values)
       4  player hero  (11 values)
       3  flag lou_has_key  (2 values)
…
Use / give combinations per room (over its expansions):
  garden: 272 candidates, 2 answered by a rule, 271 could only fall back (100% useless)
Independent dimensions (their combinations multiply the states; a checkpoint between them would cut it):
  ⚠ item rope, item coin, item book: 8 of 8 combinations seen
Monotonic (never lost once gained): 9 flags, 1 items (shell_phone)
```

Chaque dimension de l'état (un objet dans le sac, un flag, l'état d'un accessoire, la position d'un script…) est notée
par le nombre d'états qui fusionneraient si on la retirait : le haut de cette liste, c'est de quoi la logique du jeu
est faite, ou le puzzle devenu combinatoire. Les groupes de dimensions à deux valeurs dont toutes les combinaisons
apparaissent évoluent indépendamment : un checkpoint avec objectifs entre elles rend la recherche de chaque chapitre
petite. La carte de chaleur du graphe de puzzles (onglet Check) montre les mêmes chiffres sur les règles et les lieux ;
« why is this live? » sur une fiche explique pourquoi le solveur garde une chose dans son état.

## Moins d'ordres : la réduction d'ordre partiel

Deux actions qui touchent des choses différentes commutent : prendre la corde puis la pièce, ou la pièce puis la
corde, mène au même état. Le solveur fusionne déjà les états (un hash) ; ce qu'il payait encore, ce sont les ordres
entre les deux : k ramassages indépendants avant une porte font 2^k états quand la recherche ne peut pas finir (la
preuve d'une impasse, une recherche tronquée). `npm run solve -- --por=sleep|stubborn` (`src/engine/tools/por.ts`)
utilise ce que le moteur a noté pendant chaque action (ce qu'elle a lu, ce qu'elle a changé, dans les dimensions de
l'état) et, pour les actions qu'une condition retient encore, ce que le graphe de puzzles dit qu'elles exigent :

| `tests/fixtures/por.ts`, k ramassages puis une porte qui ne peut pas s'ouvrir | états | exécutions du moteur |
|---|---|---|
| simple, k = 8 | 256 | 2 304 |
| `--por=sleep`, k = 8 | 256 | 1 535 |
| `--por=stubborn`, k = 8 | 9 | 81 |
| simple, k = 12 | 4 096 | 53 248 |
| `--por=stubborn`, k = 12 | 13 | 169 |

`sleep` ne saute que des exécutions du moteur (une action essayée avant une action indépendante n'est pas réessayée
au retour) ; `stubborn` n'explore qu'une action commutante à la fois, donc les états tombent aussi. Sur le jeu de
charge en chaîne ci-dessus rien ne commute et rien ne change ; sur un vrai jeu avec des quêtes annexes facultatives,
c'est la différence entre une preuve et un dépassement de temps. La réduction est désactivée par défaut : la recherche
simple est la preuve, et `tests/por.test.ts` vérifie que chaque fixture et le jeu d'exemple donnent le même verdict
dans les trois modes.

## v3.1 : schéma 3 et preuve exhaustive (4 octobre 2026)

`npm run bench -- --v3` génère le jeu de stress avec des ids stables (`assignIds`), comme un vrai jeu v3 ; `--prove`
ajoute la recherche exhaustive (`solve -- --prove` : tous les états atteignables, les softlocks). Même portable.

| Étape | 40 lieux, 3 joueurs (v3) | 100 lieux, 5 joueurs (v3) |
|---|---|---|
| validate | 11 ms, 0 erreur | 41 ms, 0 erreur |
| solve, jeu entier (témoin) | 0,13 s, 624 états, 123 actions, 1 110 exécutions | 3,0 s, 2 901 états, 309 actions, 4 640 exécutions |
| solve, dernier chapitre (témoin) | 63 ms, 257 états | 4,5 s, 3 290 états |
| solve, jeu entier, `--por=stubborn` | 0,16 s, 624 états, 0 différée (une chaîne : rien ne commute) | 2,9 s, 2 901 états, 0 différée |
| solve, jeu entier, `--prove` | **tronquée** à 50 000 états après 408 s, 119 411 exécutions | non tentée |

Le témoin n'a pas bougé entre v2.3 et v3.1 (mêmes états, mêmes exécutions : les ids stables ne changent rien à la
recherche). La preuve exhaustive, c'est autre chose : elle visite chaque état atteignable, la réduction d'ordre
partiel est coupée dans ce mode (une réduction ne doit pas retirer une branche perdante d'une preuve tant qu'elle n'a
pas sa propre preuve d'équivalence), et un jeu de 40 lieux dépasse déjà un budget de 50 000 états. `npm run
prove:game` est donc une porte de release pour un petit jeu (la démo se prouve en 1,3 s) et un travail hebdomadaire
borné pour un grand (`.github/workflows/prove.yml`) ; sur un jeu long, prouver chapitre par chapitre
(`--prove --chapters`), chaque recherche étant bornée par ses buts. Amener la réduction en mode preuve, avec les tests
d'équivalence de `tests/por.test.ts` pour preuve, est le prochain pas du solveur.

## v3.2 : causes des softlocks, preuve par chapitres, et où la preuve s'arrête (4 octobre 2026)

Une preuve rapporte désormais **chaque** état de softlock atteignable (`softlockCount`), regroupés par l'étape qui a
perdu la partie (`softlockCauses` : la première action qui mène d'un état encore gagnable à un état qui ne l'est
plus), et une preuve depuis « Nouvelle partie » explore aussi les choix de l'introduction (la preuve de la démo passe
de 2 176 à 6 528 états : elle n'avait prouvé que la réponse par défaut). `npm run solve -- --prove --chapters` prouve
chaque chapitre depuis **chaque** état frontière atteignable du précédent (chaque état où ses objectifs tiennent,
dédoublonné par ce que le chapitre suivant lit) et signale un checkpoint qui n'en égale aucun, avec les dimensions
qui diffèrent : il a trouvé trois des quatre checkpoints de la démo en désaccord avec le contenu (la place de Biscuit
et le tuyau déjà utilisé, un écouteur `once` déjà déclenché, le lieu où l'on trouve la clé), tous corrigés. Un seul
budget d'états couvre toute la preuve (`maxStates × 10`, au plus 1 000 départs par chapitre) : au-delà, le résultat est
`truncated`, jamais vert.

Même portable ; 12 objets, 30 flags, 1 marcheur, 2 scripts, 8 sujets ; `maxStates` 20 000 :

| Jeu | Preuve globale | Preuve par chapitres |
|---|---|---|
| démo (3 lieux, 4 chapitres) | résolue, 6 528 états, 4,9 s | résolue depuis 1/78/243/312/288 états frontière, 115 670 états, 89 s |
| 20 lieux, 1 personnage, 4 chapitres | résolue, 797 états, 0,2 s | résolue, 1 466 états, 0,4 s |
| 40 lieux, 1 personnage, 8 chapitres | résolue, 3 197 états, 1,1 s | résolue, 6 034 états, 2,3 s |
| 20 lieux, 2 personnages, 4 chapitres | **tronquée** à 20 000 états, 8,7 s | **tronquée** au chapitre 1, 6,8 s |
| 40 lieux, 3 personnages, 3 chapitres | **tronquée** à 20 000 états, 51 s | **tronquée** au chapitre 1, 26 s |

Ce que cela dit, simplement : la preuve exhaustive est complète et rapide pour une chaîne de 40 lieux à un seul
personnage ; avec plusieurs personnages jouables, les états atteignables se multiplient (le lieu et le sac de chacun)
et les deux preuves s'arrêtent au budget en le disant. Découper en chapitres n'y change rien, car le premier chapitre
contient déjà le produit ; cela vérifie les checkpoints et prouve chaque chapitre depuis toutes ses entrées, ce dont
un long jeu à un personnage a besoin. Sans argument d'équivalence écrit, les réductions restent éteintes en mode
preuve, et la suite différentielle (`tests/por.test.ts`) montre pourquoi : les ensembles sleep inventent des
softlocks sur trois fixtures sur huit (les arêtes retirées nourrissent l'atteignabilité inverse qui les classe), les
ensembles stubborn s'accordent sur les huit. Un long jeu à plusieurs personnages se prouve personnage par personnage
(un checkpoint où les autres attendent) ou s'appuie sur le témoin, les témoins par chapitre et les playtests. Le
prochain pas du solveur : l'argument des ensembles stubborn en mode preuve.

