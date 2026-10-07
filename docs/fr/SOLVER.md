# Le solveur

*Version anglaise : [docs/en/SOLVER.md](../en/SOLVER.md). Les mesures sont dans [BENCH.md](BENCH.md) ; les commandes
dans [TOOLS.md](TOOLS.md). Cette page dit ce que le solveur prouve, comment il garde ce qu'il a vu, et où une preuve
s'arrête.*

## Ce qu'il prouve

`npm run solve` cherche un chemin de « Nouvelle partie » jusqu'à la fin (un témoin) ; `npm run solve -- --prove`
explore chaque état que le joueur peut atteindre et signale chacun de ceux d'où la fin est perdue (un softlock),
regroupés par le pas qui l'a perdue. Les deux font tourner le vrai moteur avec un présentateur muet (ADR 0003) : ce que
le solveur trouve, un joueur peut le faire, et ses chemins se rejouent comme des sessions (`npm run replay`). Depuis la
4.1.13, une cause de softlock porte ses entrées de session en plus de ses libellés : le chemin qui y mène se rejoue
aussi. Une recherche qui épuise un budget (états, temps ou mémoire) dit `truncated` : rien n'est prouvé alors, et le
code de sortie n'est pas 0. Une preuve ne dit jamais `proved` là où un budget l'a coupée.

## Comment un état est gardé

Un état, c'est ce que le contenu peut encore distinguer : les flags, objets, props, compteurs, scripts et positions
vivants (les dimensions, `solve/abstractions.ts`). Depuis la 4.1.13 (ADR 0015), la recherche garde un état vu comme un
indice dans des colonnes plates : son parent, la longueur de son chemin, son dernier pas, son lieu et son sac, chaque
chaîne internée une seule fois. Sa clé, ce sont ses paires (dimension, valeur) internées et triées : deux états ont la
même clé exactement quand leurs dimensions sont égales, aucune collision de hachage ne peut donc les fusionner. L'état
du moteur n'est gardé que tant que le nœud attend d'être développé. Sur les instances ouvertes de la matrice de preuve,
le tas baisse ainsi de 16 à 20 fois (1,6 Ko par état sur o21 au lieu de 31,6, BENCH.md « 4.1.13 ») ; le temps par
état est celui du moteur, et ne change pas. `--representation=objects` garde le stockage de la 4.1.8 : la référence à
laquelle les tests différentiels comparent (`tests/solver-oracle.test.ts` : 203 recherches, les mêmes verdicts,
chemins et ensembles atteignables).

## Ce qui replie les états : les abstractions

Une preuve replie les états qui ne diffèrent que par ce qui ne peut pas compter, chaque repli audité contre la
recherche explicite (`npm run solve -- --audit-abstractions`, `npm run audit:corpus` chaque nuit) : le personnage
canonique (qui tient les commandes), les régions de mobilité (les lieux entre lesquels on marche sans rien changer), le
propriétaire canonique (qui porte un objet qu'aucune condition ne lit), le mémo des no-ops (un essai dont on sait qu'il
ne change rien). La 4.1.13 ajoute les objets symétriques (`--symmetry`, désactivé par défaut) : deux objets que le jeu
traite pareil, échangés, donnent le même jeu, donc un état et son jumeau échangé n'en font qu'un. C'est mesuré contre
la recherche explicite sur des jeux générés avec des jumeaux ; il n'en trouve aucun dans les jeux fournis ni dans la
matrice. La dominance (un état sans plus de progrès qu'un état vu) n'élague que les témoins : dans une preuve elle change
des verdicts sur des jeux générés (`tests/dominance.test.ts`), elle y reste donc désactivée et le profil dit pourquoi.

## Lire le profil

`npm run solve -- --prove --profile` affiche ce que la recherche a coûté et, depuis la 4.1.13, de quoi les états sont
faits : le profil d'explosion. Les états gardés sont attribués à cinq familles (positions, inventaires, flags et
compteurs, ceux qu'un dialogue écrit, ceux qu'un script ou un événement écrit) : pour chacune, combien d'états
fusionneraient sans elle, c'est-à-dire ce qu'elle multiplie. Trois comptes disent ce qui n'est jamais devenu un état :
les symétries repliées, les essais qui n'ont rien changé, et les transitions tombées sur un état déjà vu (deux ordres
d'actions indépendantes). Chaque abstraction a sa ligne : ce qu'elle a fait, ou pourquoi elle est désactivée. Les
sous-puzzles indépendants (des groupes de dimensions qu'aucune règle ne relie) sont signalés, pas appliqués : prouver
chacun seul demanderait un argument de produit que la recherche ne fait pas. `docs/dev/PROOF-PROFILE.md` est ce profil
pour chaque instance de la matrice.

## Les longues preuves : budgets, points de reprise, mémoire

`--max` (états), `--time` (secondes) et `--mem` (Mo de tas) bornent une recherche ; chacun l'arrête en `truncated`.
`--checkpoint=<fichier>` écrit la recherche toutes les `--checkpoint-every` secondes (300 par défaut) et quand un budget
l'arrête : le stockage, la frontière dans son ordre, les compteurs. `--resume` la reprend depuis ce fichier, jusqu'au
même verdict et au même témoin qu'une recherche jamais arrêtée (`tests/checkpoint.test.ts` tue un vrai processus par
SIGKILL à 30 % et le reprend). Un instantané appartient à une recherche : le jeu et les options qui changent ce qui est
trouvé sont son empreinte, et une autre recherche l'ignore. Une recherche finie supprime son fichier.

## Les workers

`--workers=N` développe la frontière un lot à la fois sur des threads ; la fusion suit l'ordre du lot, donc le résultat
dépend du lot, jamais du nombre de workers (`tests/workers.test.ts`, `tests/partition.test.ts`). Depuis la 4.1.13, la
recherche partage sa table des états vus avec les workers (le hachage 64 bits de chaque état gardé) : un worker renvoie
sans son état moteur un état que la recherche a déjà gardé. Les clés exactes restent l'autorité : un « déjà gardé » du
worker que la recherche ne confirme pas est développé de nouveau dans le thread de la recherche. Chaque nœud va d'abord
au worker que son lieu désigne, et un worker inactif vole dans la file la plus longue. Les workers accélèrent une
exploration ; ils ne répondent pas à une explosion d'états.

## La matrice de preuve

`docs/dev/PROOF-MATRIX.md` est la classe de jeux sur laquelle le solveur est mesuré depuis la 4.1.13 : douze jeux
générés de 20 à 40 lieux et trois personnages jouables, six contraints (des murs entre les zones des personnages) et six
ouverts, avec objets transférables, puzzles croisés, dialogues, scripts, événements et actions destructrices.
`npm run prove:matrix` prouve chacun dans son propre processus sous les budgets publiés (10 000 000 états, 10 minutes sur
le Mac du mainteneur, 20 sur le runner, 4 Go) et échoue sur un faux verdict. Il tourne chaque nuit, jamais sur une pull
request. Là où une instance ne finit pas, le rapport d'écart de la matrice dit quel budget l'a arrêtée et quelle
dimension a grossi.
