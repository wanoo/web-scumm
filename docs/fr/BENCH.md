# Benchmark : un jeu généré de n'importe quelle taille

*Version anglaise : [docs/en/BENCH.md](../en/BENCH.md). Chiffres mesurés le 3 octobre 2026 (v2.1.0) sur un portable ;
ils bougent avec la machine, pas les rapports entre eux.*

`npm run bench -- --rooms=40 --players=3 --items=30 --flags=100 --npcs=5 --scripts=10 --topics=40 --max=200000`
génère un jeu de cette taille (`src/engine/tools/stress.ts`) et chronomètre chaque outil dessus. Le jeu est une chaîne :
l'objet de chaque salle ouvre la serrure de la suivante, des personnages jouables prennent le relais aux frontières de
chapitre, des promeneurs font la ronde entre deux salles et émettent des événements, des horloges tournent une salle sur
deux, des sujets enchaînent des flags, des babioles vont dans des poubelles, dix migrations de sauvegarde artificielles
mènent à la version courante, un checkpoint avec `goals` clôt chaque chapitre, deux invariants surveillent le premier
objet. Pas d'art : les layouts sont des rectangles. Une version à dix salles tourne dans `tests/bench.test.ts`.

## Résultats

| Étape | 40 salles, 3 joueurs, 39 objets, 119 règles, 40 sujets, 10 scripts | 100 salles, 5 joueurs, 119 objets, 300 flags, 100 sujets, 30 scripts |
|---|---|---|
| validate | 12 ms, 0 erreur | 38 ms, 0 erreur |
| rapport de contenu | 16 ms | 103 ms |
| carte du monde + SVG | 1 ms | 2 ms |
| graphe de puzzles + SVG | 5 ms, 554 nœuds | 24 ms, 1 479 nœuds |
| textes : extraction + traduction | 3 ms, 697 textes | 6 ms, 1 892 textes |
| migration d'une sauvegarde v1 (10 étapes) | 1 ms | 2 ms |
| solveur, chapitre 1 | 0,2 s, 157 états | 0,7 s, 344 états |
| solveur, dernier chapitre | 0,3 s, 257 états | 10,7 s, 3 290 états |
| solveur, jeu entier | 0,8 s, 624 états, 123 actions | 8,1 s, 2 901 états, 309 actions |

Tous les outils sauf le solveur sont linéaires et instantanés. Le solveur est celui à surveiller.

## Ce que le solveur fait d'un gros jeu

L'espace d'états d'un jeu d'aventure est le produit de tout ce qui peut varier indépendamment. Avant la v2.1 le solveur
hachait chaque flag, chaque objet et chaque position de script : la version à dix salles de ce jeu, avec ses horloges,
ses promeneurs, ses flags « regardé » et ses babioles, atteignait la limite de 20 000 états après 54 secondes sans finir.

La v2.1 demande au graphe de puzzles ce qui peut encore changer l'issue (`liveness` dans
`src/engine/tools/puzzle.ts`) : les salles, les lieux de la carte, les joueurs, la fin et les objectifs de chapitre sont
vivants ; une action est vivante quand l'un de ses effets atteint quelque chose de vivant ; une chose (objet, flag,
accessoire, position d'un personnage, événement) est vivante quand une action vivante la lit. Le reste sort de l'état et
des actions essayées : un flag que seul son poseur lit (un marqueur « regardé »), une babiole dont aucune porte n'a
besoin, une horloge que personne ne lit, un promeneur que personne n'attend, une chaîne de sujets qui finit dans un flag
que rien n'utilise. Le même jeu à dix salles prend maintenant 133 états ; celui à quarante, 624 ; celui à cent, 2 901.

Ce qui multiplie encore les états, à dessein, c'est ce qui compte : les choses vivantes indépendantes. Dix objets
facultatifs qui ouvrent chacun quelque chose, dans n'importe quel ordre, font 2^10 états. La réponse honnête pour un jeu
long reste :

1. **Les chapitres** (`checkpoints` avec `goals`, `npm run solve -- --chapters`) : chaque chapitre est prouvé depuis le
   checkpoint précédent, avec seulement ses propres choses vivantes. Le dernier chapitre ci-dessus coûte 3 290 états ;
   le jeu entier 2 901, parce que la recherche globale laisse tomber ce que les chapitres précédents ont consommé.
2. **Les invariants** pour les bugs « plus jamais », vérifiés sur chaque état exploré.
3. Le graphe de puzzles pour voir, avant de résoudre, de quoi une chose dépend et ce qu'elle débloque.

Résoudre globalement un jeu de 100 salles et 5 joueurs en huit secondes ne promet pas que chaque jeu de 15 heures sera
prouvé d'un coup. Cela dit que les outils du moteur suivent le contenu, et que le solveur dépense son budget sur les
énigmes.
