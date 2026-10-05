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

## Moins d'ordres : la réduction d'ordre partiel (historique, v2.3)

> **Ne jamais utiliser la réduction d'ordre partiel pour certifier qu'un jeu n'a pas de softlock.** Mesurée en mode
> preuve en 3.3, elle a signalé un softlock qui n'existe pas ([plus bas](#après-v33-noop-memo--pas-de-réduction-dordre-partiel-dans-les-preuves-une-mémoire-des-no-ops-à-la-place)).
> `--por` ne s'applique qu'aux recherches de témoin : en mode preuve, le solveur l'ignore et le dit. Cette section est
> la mesure de la v2.3, gardée telle quelle.

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
c'est la différence entre une preuve et un dépassement de temps (dans une recherche de témoin : voir l'encadré). La
réduction est désactivée par défaut : la recherche simple est la preuve.

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
et les deux preuves s'arrêtent au budget en le disant. **C'est une limite de la recherche explicite telle qu'elle est
écrite, pas du moteur** : l'état garde le lieu exact de chaque personnage et le personnage actif, et un changement de
personnage est une transition à part entière, si bien que des états équivalents sont explorés des milliers de fois
(trois personnages libres dans 30 lieux : 81 000 combinaisons de positions avant le moindre flag). La piste solveur
de la 3.3 (ROADMAP) s'attaque précisément à cela. Découper en chapitres n'y change rien, car le premier chapitre
contient déjà le produit ; cela vérifie les checkpoints et prouve chaque chapitre depuis toutes ses entrées, ce dont
un long jeu à un personnage a besoin. Sans argument d'équivalence écrit, les réductions restent éteintes en mode
preuve, et la suite différentielle (`tests/por.test.ts`) montre pourquoi : les ensembles sleep inventent des
softlocks sur trois fixtures sur huit (les arêtes retirées nourrissent l'atteignabilité inverse qui les classe), les
ensembles stubborn s'accordent sur les huit. Un long jeu à plusieurs personnages se prouve personnage par personnage
(un checkpoint où les autres attendent) ou s'appuie sur le témoin, les témoins par chapitre et les playtests. Les
prochains pas du solveur, dans l'ordre (une relecture extérieure, LOG #38) : mesurer où part le temps (exécutions du
moteur, clones, hachages, file) ; une frontière de preuve sans ordre best-first ni chemins copiés ; le personnage
actif hors de l'état (les actions de chaque personnage proposées depuis un état canonique, un changement gardé
explicite seulement s'il a un effet) ; les **régions de mobilité** (les lieux reliés par des sorties réversibles et
silencieuses fusionnés en une région par personnage, les déplacements en macro-étapes dont le trajet est gardé pour la
solution) ; des interfaces de chapitre projetées sur ce que la suite lit ; une réduction sûre pour la preuve
(fermeture par dépendance, visibilité des objectifs et invariants, blocages, condition de cycle, puisque la propriété
est « depuis tout état atteignable la fin reste atteignable »), validée contre la recherche explicite sur des milliers
de jeux générés, chaque contre-exemple rejoué sur le vrai moteur ; puis des frontières en parallèle. Critère de
sortie : le jeu de stress de 40 lieux prouvé avec 1, 2 et 3 personnages, un nombre d'états qui ne croît plus comme le
produit des positions, aucun jeu généré où les verdicts réduit et explicite diffèrent, et une troncature qui reste une
troncature.

## v3.3 « Scale » : la matrice de référence (4 octobre 2026)

`npm run bench -- --matrix --max=20000` : la preuve exhaustive sur des chaînes générées de 20 et 40 lieux avec 1, 2 et
3 personnages jouables (12 objets, 30 flags, 1 marcheur, 2 scripts, 8 sujets). `Positions` compte les combinaisons
distinctes (personnage actif, lieu de chaque personnage) parmi les états ; la répartition du temps vient du profil du
solveur lui-même (`profile.timing`).

| Game | Proof | States | Engine runs | Time | Positions | Time split (run / clone / hash / queue / tries / other) |
|---|---|---|---|---|---|---|
| 20 rooms, 1 character | solved | 797 | 3 295 | 0.2 s | 20 | 47% / 21% / 13% / 3% / 6% / 7% |
| 20 rooms, 2 characters | truncated | 20 000 | 100 863 | 7.6 s | 800 | 45% / 23% / 9% / 15% / 2% / 4% |
| 20 rooms, 3 characters | truncated | 20 000 | 49 538 | 22.6 s | 13 858 | 9% / 5% / 2% / 83% / 0% / 1% |
| 40 rooms, 1 character | solved | 3 197 | 13 245 | 1.1 s | 40 | 46% / 25% / 13% / 6% / 3% / 5% |
| 40 rooms, 2 characters | truncated | 20 000 | 92 475 | 19.0 s | 3 200 | 30% / 16% / 8% / 42% / 1% / 3% |
| 40 rooms, 3 characters | truncated | 20 000 | 44 298 | 50.9 s | 18 796 | 6% / 3% / 1% / 89% / 0% / 1% |

Deux causes, mesurées. **Les états sont des positions** : avec deux personnages sur 20 lieux, les 800 positions font
exactement 20 × 20 × 2, toutes les combinaisons ; avec trois, les positions forment l'essentiel des états. **Le temps
part dans la file** dès que les états s'accumulent : la file best-first insère en O(n) (`splice`), 83 à 89 % du temps
avec trois personnages ; avec un seul, l'exécution du moteur (environ la moitié) et la copie des états (environ un
quart) dominent. Les branches de la 3.3 s'y attaquent dans cet ordre : un cœur de preuve exact (frontière en O(1),
pointeurs parents), puis le personnage canonique et les régions de mobilité pour les positions.

### Après `v33-proof-core` (exact : mêmes témoins, mêmes preuves, même sortie imprimée sur la démo)

La frontière est un tas binaire dans l'ordre de l'ancienne liste (score, puis arrivée), et un état garde un pointeur
vers son parent et son dernier pas au lieu d'une copie de tout le chemin et de la session.

| Jeu | Preuve | États | Exécutions | Temps | Positions | Répartition (moteur / copie / hachage / file / essais / reste) |
|---|---|---|---|---|---|---|
| 20 lieux, 1 personnage | résolue | 797 | 3 295 | 0.2 s | 20 | 48% / 22% / 13% / 1% / 7% / 7% |
| 20 lieux, 2 personnages | tronquée | 20 000 | 100 863 | 6.6 s | 800 | 53% / 27% / 11% / 0% / 3% / 5% |
| 20 lieux, 3 personnages | tronquée | 20 000 | 49 538 | 4.1 s | 13 858 | 53% / 29% / 10% / 0% / 2% / 5% |
| 40 lieux, 1 personnage | résolue | 3 197 | 13 245 | 1.1 s | 40 | 49% / 26% / 14% / 0% / 3% / 6% |
| 40 lieux, 2 personnages | tronquée | 20 000 | 92 475 | 11.4 s | 3 200 | 52% / 27% / 13% / 0% / 2% / 5% |
| 40 lieux, 3 personnages | tronquée | 20 000 | 44 298 | 6.2 s | 18 796 | 50% / 29% / 13% / 0% / 1% / 5% |

La file disparaît du profil (89 % → 0 %) et le cas le plus lourd va 8 fois plus vite pour les mêmes 20 000 états
(50,9 s → 6,2 s). Le nombre d'états ne bouge pas, comme il se doit : restent le moteur (environ la moitié), les copies
d'état (environ 30 %), et surtout le nombre d'états, auquel s'attaquent les branches suivantes.

### Après `v33-player-canonical` (mêmes verdicts, vérifiés contre la recherche explicite)

En mode preuve, des états qui ne diffèrent que par le personnage actif sont un seul état, et chaque état propose les
actions de chaque personnage (`Switch to X › action`) quand le changement ne modifie rien de ce que lit le solveur ; un
changement qui modifie quelque chose reste une étape explicite, et les invariants sont vérifiés du point de vue de
chaque personnage. Preuve de la démo : 6 528 → 3 480 états, même verdict.

| Jeu | Preuve | États | Exécutions | Temps | Positions |
|---|---|---|---|---|---|
| 20 lieux, 1 personnage | résolue | 797 | 3 295 | 0.2 s | 20 |
| 20 lieux, 2 personnages | tronquée | 20 000 | 153 282 | 12.7 s | 757 |
| 20 lieux, 3 personnages | tronquée | 20 000 | 79 081 | 5.5 s | 60 |
| 40 lieux, 1 personnage | résolue | 3 197 | 13 245 | 1.0 s | 40 |
| 40 lieux, 2 personnages | tronquée | 20 000 | 83 535 | 6.1 s | 44 |
| 40 lieux, 3 personnages | tronquée | 20 000 | 65 577 | 6.4 s | 112 |

Le personnage actif n'est plus un facteur (positions 18 796 → 112 à trois personnages), mais les chaînes de stress
restent tronquées : le lieu exact et le sac de chaque personnage fragmentent maintenant les états. C'est le travail
des régions de mobilité.

### Après `v33-mobility` : régions de mobilité, et la preuve de référence

Le lieu exact d'un personnage est remplacé par sa **région** : les lieux entre lesquels il peut marcher en silence
(sorties générées et voyages par la carte vers des lieux sans `onEnter`, dont rien ne lit le `visited`, et qu'aucune
condition ne nomme), la partie fortement connexe autour de lui vue avec son propre sac. La preuve propose les actions
de chaque lieu de la région sous la forme `Go to <lieu> › action` ; le trajet est joué une fois par lieu, chaque pas
vérifié (il arrive, il ne change rien de ce que lit le solveur), et un pas qui n'est pas silencieux relance la
recherche avec les lieux exacts (`profile.mobility.reason`). Le témoin d'une preuve par régions se rejoue sur le vrai
moteur.

**La référence** (`npm run bench -- --matrix --eras`, `makeStressGame({ eras: true })`) : chaque personnage confiné
dans son époque, l'objet qui ouvre la première serrure de l'époque suivante envoyé par une goulotte temporelle
(`{ transfer }`), goulottes à sens unique, marcheurs, scripts et sujets ; `softlock: true` ajoute une poubelle qui
détruit l'objet 0. Mode preuve, budget de 200 000 états :

| Jeu | Preuve | États | Exécutions | Temps |
|---|---|---|---|---|
| 20 lieux, 1 personnage | résolue | 83 | 1 787 | 0.2 s |
| 20 lieux, 2 personnages | résolue | 358 | 7 260 | 0.8 s |
| 20 lieux, 3 personnages | résolue | 481 | 11 277 | 1.1 s |
| 40 lieux, 1 personnage | résolue | 163 | 6 787 | 2.1 s |
| 40 lieux, 2 personnages | résolue | 678 | 25 660 | 6.5 s |
| 40 lieux, 3 personnages | résolue | 578 | 21 886 | 4.2 s |

L'objectif de la 3.3 est atteint sur elle : 40 lieux × 3 personnages prouvés en 578 états et 4,2 s. Sur des versions
à 12 lieux, la recherche explicite (les deux abstractions coupées) donne les mêmes verdicts avec 13 à 15 fois plus
d'états (2 906 contre 230 à deux personnages, 16 944 contre 1 100 à trois), et trouve le même softlock dans la
variante négative (`tests/reference-proof.test.ts`).

**La chaîne ouverte reste hors de portée, et c'est le jeu, pas l'abstraction.** Sans époques, chaque personnage peut
parcourir toute la chaîne et ramasser l'objet de n'importe qui : quel personnage porte quel objet est un vrai produit
que la preuve doit couvrir (budget de 20 000 états) :

| Jeu | Preuve | États | Temps |
|---|---|---|---|
| 20 lieux, 2 personnages | tronquée | 20 000 | 57.9 s |
| 20 lieux, 3 personnages | tronquée | 20 000 | 33.8 s |
| 40 lieux, 2 personnages | tronquée | 20 000 | 451.7 s |
| 40 lieux, 3 personnages | tronquée | 20 000 | 65.9 s |

Aucune réduction exacte ne peut retirer ces états ; un jeu construit ainsi se vérifie par le témoin, les témoins par
chapitre et les playtests, ou en bornant qui peut porter quoi. Avec un seul personnage, les régions réduisent aussi la
chaîne ouverte (40 lieux : 3 197 → 163 états).

### Après `v33-chapter-interfaces` : une recherche par chapitre, depuis tous les états frontière à la fois

Un chapitre se prouve désormais par **une seule** recherche qui part de tous ses états frontière ensemble et partage
ce qu'elle a vu (un état est sûr ou non quel que soit le départ qui l'a atteint) : il coûte l'union de ce que les
départs atteignent, pas la somme. En le comparant à la recherche explicite lancée depuis chaque départ, j'ai trouvé un
vrai défaut, antérieur à la 3.3 : un but de chapitre qui lit le sac du personnage actif (`{ has: 'token' }`) était
évalué sur le personnage que l'état fusionné avait gardé, et des états frontière se perdaient. Un état canonique
atteint maintenant le but dès qu'un personnage, vu comme actif, le satisfait. Sur la démo, la recherche partagée
abstraite trouve exactement les frontières de la recherche explicite à chaque chapitre
(`tests/reference-proof.test.ts`), avec 15 à 36 fois moins d'états.

| Démo | Avant la 3.3 | Maintenant | Objectif 3.3 |
|---|---|---|---|
| Preuve globale | 6 528 états, 4,4 s | 3 480 états, 4,5 s | moins de 5 s |
| Preuve par chapitres | 115 620 états, 90 à 147 s | 5,7 s | moins de 20 s |

La mobilité est coupée sur la démo, et le profil dit pourquoi (`no move of this game can be silent` : chaque lieu a
un `onEnter` ou est nommé par une condition), ce qui épargne aussi le calcul des régions à chaque hachage.

### Après `v33-noop-memo` : pas de réduction d'ordre partiel dans les preuves, une mémoire des no-ops à la place

**La réduction, mesurée en mode preuve.** Les ensembles de sommeil visitent tous les états mais sautent des arêtes :
une action déjà essayée dans un ordre qui commute n'est pas relancée. La preuve classe les états par atteignabilité
arrière sur ces arêtes, donc une arête sautée peut cacher le seul chemin vers le but. Sur le jeu par époques, c'est le
cas : 20 lieux × 3 personnages signale un softlock que la preuve simple n'a pas (40 × 3 aussi), pour moins de 2 % des
exécutions du moteur évitées et 20 à 25 % de temps en plus (`tests/por.test.ts`, « why proof mode keeps the reductions
off »). Les réductions restent coupées en preuve ; le coût est ailleurs : 78 % des exécutions de la démo (92 % sur le
jeu par époques) ne changent rien.

**La mémoire des no-ops.** Le moteur enregistre désormais ce qu'une exécution écrit (`Engine.writes`, à côté
d'`Engine.reads`), même une valeur déjà en place. Une exécution qui n'écrit rien de ce que le solveur hache est gardée
avec les valeurs qu'elle a lues ; la même action sur un état aux mêmes valeurs est un no-op aussi, et n'est pas
lancée. Elle ne retire aucune arête (un no-op est une boucle), donc la preuve est la même. Elle suppose que la trace
des lectures est complète : un saut sur 16 est lancé quand même et comparé, et une différence est une erreur, jamais
un saut silencieux. `tests/memo.test.ts` lance chaque saut quand même sur douze fixtures (témoin et preuve) et sur la
démo : mêmes verdicts, états, softlocks, témoins et compteurs d'atteignabilité. C'est une équivalence vérifiée sur ce
corpus, pas une preuve pour tout jeu : une future condition ou commande qui oublierait de déclarer une lecture la
casserait, et seule une vérification qui lance chaque saut le verrait (`npm run solve -- --audit-abstractions`, 3.3.1).

| Démo | Avant | Avec la mémoire |
|---|---|---|
| Preuve globale | 129 840 exécutions, 4,4 s | 40 191 exécutions, 2,2 s |
| Preuve par chapitres | 5,7 s | 3,3 s |
| Jeu par époques, 40 lieux × 3 personnages | 21 886 exécutions, 4,5 s | 10 647 exécutions, 3,5 s |

`npm run solve -- --profile` termine maintenant son en-tête par ce que chaque abstraction a fait, ou pourquoi elle
est coupée (la sortie reste en anglais) :

```
Abstractions (what each one did, or why it is off):
  canonical character   3048 switches folded, 0 kept explicit
  mobility regions      off (no move of this game can be silent)
  no-op memo            95625 runs skipped (5976 of them run anyway and identical), 522 kept, 4728 refused
```

### 3.3.0, mesurée sur la release (5 octobre 2026, cache coupé)

| Jeu | Statut | États | Exécutions du moteur | Temps | Budget 3.3 |
|---|---|---|---|---|---|
| Démo, preuve globale | solved | 3 480 | 40 191 | 2,2 s | 5 s |
| Démo, preuve par chapitres | solved | 5 chapitres | | 3,3 s | 20 s |
| Référence, 40 lieux, 1 personnage | solved | 163 | 764 | 1,8 s | |
| Référence, 40 lieux, 2 personnages | solved | 678 | 11 348 | 5,6 s | |
| Référence, 40 lieux, 3 personnages | solved | 578 | 10 647 | 3,5 s | 200 000 états, 60 s |

Avec le cache de preuve chaud, la preuve globale de la démo répond en 0,17 s et ses chapitres en 1,1 s. La matrice
ouverte (personnages non confinés à une époque, objets qui circulent librement) tronque toujours avec 2 et 3
personnages : voir « Après `v33-mobility` ».

## 3.3.1 : les abstractions auditées (5 octobre 2026)

`npm run solve -- --audit-abstractions` (`src/engine/tools/audit.ts`) prouve le jeu sélectionné deux fois : avec les
abstractions, chaque saut de la mémoire lancé quand même et comparé, et avec toutes coupées. Il échoue (sortie 1) sur
toute différence de verdict, d'invariants cassés, d'existence de softlocks, ou de flags, lieux et emplacements
atteints ; il dit `partial` (sortie 2) quand la recherche explicite ne tient pas dans le budget, parce qu'alors les
verdicts n'ont pas été comparés. Sur la démo : `same`, 3 480 états contre 6 528, 95 625 sauts tous identiques, 9,5 s.
`release-check` le lance.

`tests/audit.test.ts` lance le même audit sur 120 jeux aléatoires (`tests/gen/random-game.ts` : 2 à 4 lieux, 1 ou 2
personnages, `has` négatif, consommation, transferts, compteurs, `once` / `nth` / `cycle`, `if` imbriqués), et sur un
jeu par commande et par condition du DSL (les deux tables sont vérifiées contre les types `Cmd` et `Cond` : une
nouvelle variante sans exemple ne compile pas). Sur les 120 jeux aléatoires, 92 sont `same` (la recherche explicite :
26 résolus, 18 avec softlocks, 48 non résolus) et 28 `partial` à 3 000 états ; aucun n'a divergé.

Ce qu'il a trouvé, et qui est corrigé :

- **Un flag mort qui ne l'était pas.** La première règle écrite qui correspond répond. Un flag qui ne garde qu'une
  règle antérieure, laquelle ne touche que ce flag, semblait mort à l'analyse de vivacité ; pourtant il décide si
  c'est la règle antérieure ou une suivante qui répond. Le solveur fusionnait les deux états et perdait tout chemin
  passant par la règle suivante ; sur un jeu aléatoire, les abstractions atteignaient par hasard un flag que la
  recherche explicite n'atteignait pas. C'était un défaut de la recherche de base, pas d'une abstraction. Le graphe de
  puzzles relie maintenant la condition d'une règle antérieure à chaque règle suivante qu'elle peut masquer
  (`puzzleGraph`) ; la démo et le jeu de référence gardent exactement les mêmes nombres d'états.
- **Lieux atteints.** Avec le personnage canonique, un lieu où seul un autre personnage jouable se tenait manquait à
  `roomsReached` (et le lint pouvait donc le dire jamais atteint). Le point de vue de chaque personnage compte
  maintenant.

## 3.4 : le chapitre de référence (5 octobre 2026)

`games/reference`, « Le Marché de nuit » : 8 lieux, 9 objets, 5 personnages dont deux jouables (Pixel et Biscuit,
qui se passent des objets et s'ouvrent des lieux), un marché mis en scène (Canvas, 960 de large, 6 calques avec
parallaxe, 3 occultants, 2 zones de marche reliées par un escalier), un jardin sur deux plans (une échelle ouverte par
un flag, un saut réservé à Biscuit), un script autonome, un mini-jeu, un final sur la timeline. Mesuré sur un portable
M-series, cache coupé.

| Mesure | Résultat | Seuil |
|---|---|---|
| Témoin | 1 450 états, 0,6 s, 49 étapes | — |
| Preuve globale | résolue, 904 états, 1,9 s | aucun softlock |
| Preuve par chapitres (`lights`, `ending`) | 848 + 72 états, 16 états frontière, 2,0 s | chaque chapitre depuis chaque état frontière |
| `--audit-abstractions` | `same` : 904 états contre 83 672 en explicite, 36 144 succès du memo identiques, 40,8 s | aucune divergence |
| Images par seconde, CPU ÷4, Canvas | marché 50,2 i/s (47,3 à ÷8), jardin / ruelle / rue 60,2 i/s | ≥ 30 i/s |
| Première visite | 1 989 Ko transférés, 2 198 Ko prédits, rien hors de la prédiction | à 10 % près, rien hors |
| Lieux | 541 à 718 Ko chacun ; le chapitre entier 4 249 Ko | 3 000 Ko par lieu, 6 000 Ko par chapitre |
| Références visuelles | 8 / 8 lieux, 0,00 % | ≤ 0,5 % |

Joué jusqu'au bout par la CI : au clavier dans Chromium et WebKit, en français sans défaut anglais visible, et par le
harnais générique avec axe et un aller-retour de sauvegarde.

### 3.4.0, mesurée sur la release (5 octobre 2026, cache coupé)

| Jeu | Statut | États | Temps | Face à la 3.3.0 |
|---|---|---|---|---|
| Démo, preuve globale | résolue | 3 480 | 2,3 s | mêmes états (2,2 s) |
| Démo, preuve par chapitres | résolue | 5 chapitres | 3,6 s | mêmes chapitres (3,3 s) |
| Référence par époques, 40 lieux × 3 personnages | résolue | 578 (10 647 exécutions du moteur) | 3,9 s | mêmes états (3,5 s) |
| Le Marché de nuit, preuve globale | résolue | 904 | 1,9 s | nouveau |
| Le Marché de nuit, par chapitres | résolue | 2 chapitres | 2,0 s | nouveau |

La 3.4 a changé l'image, pas la logique : chaque nombre d'états est celui que la 3.3.0 mesurait ; les temps bougent
dans le bruit d'un portable.

## 3.5 : les workers de preuve (5 octobre 2026)

`npm run solve -- --prove --workers=N` (`src/engine/tools/solve-pool.ts`) : la recherche prend un lot de nœuds dans sa
frontière (64 par défaut, les meilleurs d'abord), chaque nœud part vers le worker libre, et les expansions reviennent
être fusionnées dans l'ordre du lot. Une expansion ne lit rien de la recherche (ni `seen`, ni la frontière) : ce sont
les essais du nœud joués sur le moteur, construits depuis le jeu et les options seuls (`makeExpander`), les mêmes dans
chaque fil. La fusion, dans le fil de la recherche, est l'endroit où `seen`, les buts, les arêtes et la frontière
changent. Le résultat dépend donc du lot et jamais du nombre de workers ; un seul worker, c'est la même recherche par
lots dans le fil de la recherche. Sans `--workers`, rien ne change : un nœud à la fois, les mêmes témoins et preuves
qu'en 3.4 (vérifié octet pour octet sur la démo et le chapitre de référence, témoin et preuve). Un worker qui ne
démarre pas, ou s'arrête, laisse ses nœuds au fil de la recherche (le résultat ne change pas ; `profile.workers.reason`
le dit) ; les commandes sur mesure arrivent aux workers par le module du jeu ; la réduction d'ordre partiel les tient
éteints. `--time` arrête une recherche, avec ou sans workers.

Mesuré avec `npm run bench -- --workers-table` sur un portable à 10 cœurs, cache coupé :

La chaîne ouverte, 20 lieux × 2 personnages, objets libres, arrêtée à 40 000 états :

| Workers | Preuve | États | Temps | Accélération | Résultat |
|---|---|---|---|---|---|
| aucun (un nœud à la fois) | tronquée | 40000 | 58,1 s | ×1,00 | `9806965f9b` |
| 1 | tronquée | 40000 | 55,0 s | ×1,06 | `530cfb4002` |
| 2 | tronquée | 40000 | 32,3 s | ×1,80 | `530cfb4002`, le même qu'avec 1 |
| 4 | tronquée | 40000 | 22,8 s | ×2,54 | `530cfb4002`, le même qu'avec 1 |
| 8 | tronquée | 40000 | 16,9 s | ×3,43 | `530cfb4002`, le même qu'avec 1 |

La référence par époques, 40 lieux × 3 personnages (résolue) :

| Workers | Preuve | États | Temps | Accélération | Résultat |
|---|---|---|---|---|---|
| aucun (un nœud à la fois) | résolue | 578 | 3,8 s | ×1,00 | `2717e116b8` |
| 1 | résolue | 578 | 3,9 s | ×0,99 | `17cf8b1721` |
| 2 | résolue | 578 | 2,4 s | ×1,59 | `17cf8b1721`, le même qu'avec 1 |
| 4 | résolue | 578 | 1,9 s | ×2,01 | `17cf8b1721`, le même qu'avec 1 |
| 8 | résolue | 578 | 1,7 s | ×2,20 | `17cf8b1721`, le même qu'avec 1 |

La porte de la 3.5 (×2 avec 4 workers sur une grosse preuve, le même résultat pour 1, 2, 4 et 8) est passée. Le
résultat sans workers a une autre signature : l'ordre d'une recherche par lots diffère (les mêmes états et le même
verdict, d'autres premiers chemins trouvés) ; `tests/workers.test.ts` vérifie les deux. Ce qui ne passe pas à
l'échelle : la fusion (les états passent d'un fil à l'autre, le fil de la recherche vérifie chacun), et le démarrage
des workers (environ 0,3 s) : une petite preuve, comme chacun des chapitres du jeu d'exemple, n'est pas plus rapide.
Les workers restent donc éteints sauf demande ; `--workers=auto` (les cœurs moins un, 8 au plus) est le réglage d'un
gros jeu.

## 3.5 : qui porte quoi (5 octobre 2026)

**Le propriétaire canonique** (preuves, actif par défaut avec le personnage canonique et les régions de mobilité ;
`--ownership=off`). Avec plusieurs personnages jouables, lequel porte un objet multiplie les états : trois personnages et
douze objets qui circulent librement, c'est la matrice ouverte que la 3.3 ne prouvait pas. Un objet qu'aucune condition
ne lit (son absence ne décide donc de rien : pas de `else`, pas de règle masquée par une qui l'exige), dans aucun
invariant ni but, perdu ou déplacé seulement par une action sur lui, et donné par aucune règle ni réaction par type
(`poolableItems`), est mis en commun tant que deux personnages quelconques peuvent se rejoindre : l'état garde combien
de chaque objet commun existent, pas qui les porte. Avant d'essayer les actions d'un personnage, les remises qui lui
donnent le pot commun sont jouées sur le moteur : l'autre porteur prend la main, les deux marchent jusqu'à un lieu que
leurs régions partagent, les objets sont donnés, la main revient, et chaque pas doit laisser l'état tel que la recherche
le voit. Un pas qui ne le fait pas relance la preuve sans mise en commun (`profile.ownership.reason`), comme la mobilité.

Vérifié contre la recherche explicite (`--audit-abstractions`, `tests/audit.test.ts`) : le chapitre de référence `same`,
288 états contre 83 672 ; 60 jeux aléatoires à objets libres, aucune divergence (32 comparés sous 3 000 états, dont 10
avec des remises jouées ; 44 comparés sous 20 000, dont 14 avec des remises, aucun divergent). La première version
divergeait sur 3 des 60 : le pot commun listait des objets que la recherche ignore par ailleurs (morts), et l'audit l'a
attrapé.

| Jeu | Sans le propriétaire | Avec |
|---|---|---|
| Le Marché de nuit (2 personnages) | 904 états, 2,0 s | 288 états, 1 559 remises, 1,2 s |
| Le jeu d'exemple | 3 480 états | les mêmes : pas de région de mobilité, donc pas de propriétaire |
| Chaîne ouverte, 20 lieux × 2 personnages, 12 objets | tronquée à 40 000 états (58 s) | **résolue**, 14 002 états, 19,4 s |
| Chaîne ouverte, 20 lieux × 3 personnages | tronquée | **toujours tronquée** à 200 000 états (154 s avec 4 workers) |

L'objectif de la 3.5, la matrice ouverte 20 × 3 dans le budget, **n'est pas atteint**. Le propriétaire ne s'applique
que tant que deux personnages quelconques peuvent se rejoindre, et dans la chaîne ouverte des portes fermées les
séparent la plupart du temps (1 817 remises sur 200 000 états). Comme décidé, cela ne bloque pas la 3.5 ; c'est la
question ouverte pour la suite.

**La dominance pour un témoin** (`--dominance`, témoins seulement : elle ne peut élaguer une preuve). Un état qui n'a
pas plus de progrès qu'un état déjà vu (tout le reste égal ; ses objets et flags booléens monotones, ceux dont rien ne
lit l'absence, un sous-ensemble) n'est pas exploré. Une recherche de témoin qui ne trouve rien avec elle est relancée
sans, elle ne rend donc jamais `unsolved` d'elle-même. Mesuré : elle n'élague rien sur le jeu d'exemple, le chapitre de
référence ni les jeux de stress. La recherche « le meilleur d'abord » atteint un témoin avant qu'un état dominé ne
sorte, et un état dominé ne sort qu'une fois les meilleurs épuisés, ce qui (quand l'absence n'est jamais lue) veut dire
que la recherche échoue de toute façon. Elle reste une option, éteinte par défaut.
