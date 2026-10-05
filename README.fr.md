# web-scumm

**Créez un point-and-click complet avec une IA, et prouvez qu'il peut être terminé.**

Un moteur d'aventure à la SCUMM pensé pour le téléphone, un Studio visuel pour produire le jeu, et une chaîne qui le
vérifie, le prouve et le publie en jeu web jouable hors ligne. Il est né comme moteur d'un jeu familial de 9 lieux,
écrit et livré en une seule journée avec un assistant IA.

*[English version](README.md)*

| | |
|---|---|
| 🎮 **Jouer** | [The Pantry Key](https://wanoo.github.io/web-scumm/), le jeu d'exemple : téléphone à l'horizontale, ou ordinateur |
| 🛠 **Studio** | [Ouvrir le Studio](https://wanoo.github.io/web-scumm/studio.html) en mode démo : vos modifications restent dans votre navigateur |
| 🚀 **Démarrer** | [Créer son jeu](#créer-son-jeu) en quelques commandes |
| 📚 **Docs** | [La méthode](docs/fr/WORKFLOW.md) · [le format du contenu](docs/fr/CONTENT_GUIDE.md) · [toute la documentation](#documentation) |

![The Pantry Key : la maison de Grand-mère, neuf verbes, le sac](docs/img/v36-hero.webp)

**Nouveau en v3.7 « Field Proof » :** le jeu d'exemple peut être vendu : son thème, *Le Lac des cygnes* de
Tchaïkovski écrit et arrangé pour le projet, remplace un arrangement sous licence non commerciale, si bien que
`npm run verify:commercial` passe. Le chapitre de référence joue deux partitions reliées par des ponts, et le
navigateur vérifie qu'une transition peut être annulée, restaurée depuis une sauvegarde ou arrêtée sans laisser de son
derrière elle (la 3.6.1 « Audio truth » a donné à la musique ses trois intentions : jouer, restaurer, arrêter). Le
corpus de nuit tourne en quatre tranches et garde ses comptes.

**v3.6 « Production » :** le directeur musical a ses propres budgets (stems, hors ligne, audio décodé, un
plafond sur ce qu'il garde), ses stems sont mesurés avant une release, et une partition passe la main à une autre sur
un temps, une mesure, une phrase ou un marqueur, par un pont ; une sauvegarde garde où en était la musique. La preuve
met les objets en commun par groupe de personnages qui peuvent se rejoindre : des chaînes ouvertes à trois
personnages sont prouvées là où la 3.5 abandonnait
([les mesures](docs/fr/BENCH.md#36--la-mise-en-commun-par-groupe-une-fuite-et-un-corpus-5-octobre-2026)), et des jeux
aléatoires de trois sortes sont comparés à la recherche explicite chaque nuit (comptés essayés, comparés, partiels).

**v3.5 « Score » :** une musique qui suit le jeu. Un morceau est découpé en stems qui jouent calés ; le
mix change avec le lieu, le personnage actif ou un flag, à la mesure suivante, sans clic. La preuve tourne sur
plusieurs cœurs avec le même résultat, et met en commun les objets que les personnages peuvent se passer : les jeux à
deux personnages où les objets circulent librement sont prouvés
([la mesure](docs/fr/BENCH.md#35--les-workers-de-preuve-5-octobre-2026)). C'est un mixeur adaptatif à stems avec
transitions, pas iMUSE : pas de changement de tempo, pas de branches à l'intérieur d'une partition. La 3.4 « Stagecraft » avait apporté des
scènes en profondeur : un peintre Canvas, calques, masques, lumières, zones de marche et escaliers, le Studio structuré,
et un deuxième jeu, « Le Marché de nuit ».

## Bien plus qu'un moteur

| Étape | Ce que web-scumm apporte |
|---|---|
| **Écrire** | D'abord un storyboard, puis les lieux, les dialogues à choix, les indices et les règles, tout en données. |
| **Construire** | Des lieux placés à la souris, des personnages découpés dans des planches générées, un prompt pour chaque image, une musique et des bruitages chiptune. |
| **Vérifier** | Les références cassées, les répliques non traduites, la licence de chaque fichier livré, ce qu'un téléphone doit télécharger. |
| **Prouver** | Un chemin jusqu'à la fin, chaque état où la fin est perdue et pourquoi, des sauvegardes qui passent d'une version à l'autre, de vrais navigateurs. |
| **Livrer** | Un jeu web statique qui s'installe sur un téléphone, joue hors ligne, au toucher, à la souris ou au clavier. |

## La v3.6 en chiffres

Mesuré sur la release, cache de preuve coupé ([BENCH.md](docs/fr/BENCH.md)) :

| Quoi | Résultat |
|---|---|
| « Le Marché de nuit », 8 lieux, 2 personnages jouables | prouvé en 288 états, 1,2 s ; les abstractions auditées contre 83 672 états explicites |
| Une chaîne ouverte de 20 lieux, 2 personnages, 12 objets qui circulent | prouvée en 14 002 états, 19 s (hors de portée avant la 3.5) |
| Une chaîne ouverte de 14 lieux, 3 personnages, des objets qui circulent | prouvée en 93 480 états, 166 s (hors de portée avant la 3.6) |
| 900 jeux aléatoires, abstractions contre la recherche explicite | 549 verdicts comparés, aucune divergence (351 arrêtés partiels) |
| Une preuve de 40 000 états sur 4 threads | ×2,54 plus rapide, le même résultat que sur 1 |
| Le directeur musical, rendu hors ligne 30 minutes | 0 échantillon de dérive ; 100 changements de mix sans clic ; 0,02 ms de gigue en direct |
| Son marché mis en scène : 6 calques, parallaxe, 3 masques, deux sols | 50 images par seconde avec le CPU ralenti 4× (Canvas) |
| Une première visite | chaque octet récupéré par le navigateur était prédit par le graphe d'assets |
| Jeu de référence, 40 lieux × 3 personnages, structuré par époques | prouvé en 578 états, 4,1 s |
| Le jeu d'exemple, chaque état atteignable | prouvé en 2,5 s, puis 0,17 s depuis le cache de preuve |
| Le jeu d'exemple, chapitre par chapitre | prouvé en 3,7 s |
| Les 7 mini-jeux fournis | chacun gagné au clavier seul, dans Chromium et WebKit |
| Accessibilité | testée au clavier, aucune violation axe-core grave ou critique sur les écrans contrôlés (pas une conformité WCAG) |
| Assets livrés | empreinte et licence de chaque fichier verrouillées après relecture ; budgets de poids par lieu et par chapitre |

La preuve explore le jeu comme le moteur le joue et suppose les mini-jeux réussis. Le jeu de référence garde chaque
personnage dans son époque. Quand les objets circulent librement entre trois personnages, la recherche s'arrête encore
avant la fin, et BENCH.md le dit.

## Ce que reçoit le joueur

<table>
<tr><td width="50%" valign="top"><img src="docs/img/v36-player-scene.webp" alt="Parler à Grand-mère : ses sujets dans la colonne de droite" width="100%"><br><sub>Des conversations à sujets et à choix, avec leur transcription</sub></td><td width="50%" valign="top"><img src="docs/img/v36-player-minigame.webp" alt="Le mini-jeu des tuyaux : amener l'eau aux champignons" width="100%"><br><sub>Des mini-jeux, au toucher ou au clavier</sub></td></tr>
<tr><td width="50%" valign="top"><img src="docs/img/v36-player-map.webp" alt="La carte du monde, des personnages épinglés dessus" width="100%"><br><sub>Une carte du monde, des personnages qui changent de lieu</sub></td><td width="50%" valign="top"><img src="docs/img/v36-player-ending.webp" alt="La carte finale : Pixel a trouvé les sardines" width="100%"><br><sub>Une fin qui se souvient de ce que le joueur a deviné</sub></td></tr>
</table>

Neuf verbes classiques et un sac, des dialogues, des indices donnés par un personnage, des cinématiques et des appels
téléphoniques, des lieux plus larges que l'écran, plusieurs personnages jouables avec leur propre sac, des scripts et
des événements, sept mini-jeux, une fin scellée en option, sauvegarde automatique et emplacements, traductions,
réglages, toucher, souris et clavier, et le jeu entier hors ligne après la première visite.

## Ce que reçoit l'auteur

<table>
<tr><td width="50%" valign="top"><img src="docs/img/v36-studio-rooms.webp" alt="Studio, onglet Rooms : le garde-manger sélectionné, ses regards et réactions modifiables" width="100%"><br><sub><b>Rooms</b> : le vrai moteur, un éditeur de placement par-dessus, chaque réplique modifiable sur place</sub></td><td width="50%" valign="top"><img src="docs/img/v36-studio-storyboard.webp" alt="Studio, onglet Storyboard : planches et cases, implémenté à 100 %" width="100%"><br><sub><b>Storyboard</b> : l'histoire case par case, comparée au jeu</sub></td></tr>
<tr><td width="50%" valign="top"><img src="docs/img/v36-studio-assets.webp" alt="Studio, onglet Assets : la planche de Pixel, case par case, avec l'usage de chacune" width="100%"><br><sub><b>Assets</b> : chaque planche et chaque case, où elle sert, le prompt qui la fabrique</sub></td><td width="50%" valign="top"><img src="docs/img/v36-studio-check.webp" alt="Studio, onglet Check : validateur, chemin du solveur et santé du solveur" width="100%"><br><sub><b>Check</b> : le validateur et le solveur, relancés à chaque sauvegarde</sub></td></tr>
</table>

<img src="docs/img/v36-proof-graph.webp" alt="Le graphe des énigmes avec le chemin critique et la chaleur du solveur" width="420" align="right">

Le graphe des énigmes montre à quoi mène chaque objet, chaque drapeau et chaque lieu. Avec **Critical path**, ce qui
ne mène pas à la fin s'estompe. Avec **Heat**, les règles par lesquelles le solveur est le plus passé rougissent. Le
Studio a aussi un onglet Play avec l'explication des règles et le rejeu des sessions, des notes partagées avec l'IA, et
un Assistant qui fonctionne avec n'importe quel modèle.

<br clear="right">

## Créer son jeu

Il faut Node 22+, Python 3 pour les outils d'image (`pip install -r requirements.txt`) et ffmpeg pour le son.

```bash
npm install
npm run doctor                       # vérifie Node, les modules Python, ffmpeg et les navigateurs de test
npm run new-game my-game "My Game"   # games/my-game depuis le modèle, devient le jeu courant
npm run assets                       # prépare les images provisoires
npm run studio                       # le Studio : lieux, histoire, assets, vérifications, jeu
```

Puis, avant que quelqu'un y joue :

```bash
npm run verify:game   # validation, un chemin jusqu'à la fin, chapitres, traductions, lint, playtests
npm run prove:game    # chaque état atteignable : un softlock ou une recherche tronquée échouent
npm run build         # tests, bundle et audits, dans dist/ pour n'importe quel hébergement statique
```

`npm run dev` lance le jeu sur cet ordinateur, `npm run dev:lan` sur votre téléphone. Écrivez d'abord l'histoire dans
`storyboard.json`, puis les lieux avec [CONTENT_GUIDE](docs/fr/CONTENT_GUIDE.md) ouvert.
[WORKFLOW](docs/fr/WORKFLOW.md) décrit toute la méthode, étape par étape.

## Comment s'écrit un jeu

Tout est donnée : lieux, accessoires à états, personnages, objets, règles, sujets, indices, scripts, événements. Il n'y
a pas de code dans le contenu, donc chaque outil peut le lire, le vérifier et le jouer.

```ts
export const garden: RoomDef = {
  id: 'garden', name: 'The garden', decor: 'garden',
  props: { tank: { name: 'water tank', states: { full: 'tank_full', empty: 'tank_empty' } } },
  actors: { grandpa: { char: 'grandpa' } },
  exits: { back_door: { name: 'back door', to: 'house', entry: 'garden' } },
  on: [
    { verb: 'use', a: 'pipe', b: 'tank', if: '!tank_drained',
      do: [{ minigame: 'pipes', params: { /* voir games/demo */ } }, { lose: 'pipe' }, { set: 'tank_drained' }, { prop: ['tank', 'empty'] }] },
  ],
  talk: { grandpa: [{ topic: 'Where is the key?', if: '!tank_drained', do: [{ say: ['grandpa', 'It fell in the tank. Plop.'] }] }] },
  hints: [{ until: 'tank_drained', lines: ['Use the pipe on the water tank.'] }],
};
```

Une règle, c'est un verbe, une cible, une condition et une liste de commandes. [CLASSICS](docs/fr/CLASSICS.md) écrit
avec elles vingt mécaniques célèbres du genre : le duel d'insultes, une infirmière qui fait sa ronde, un arbre planté
dans le passé.

## Pourquoi une IA peut vraiment y travailler

- Le contenu est déclaratif : un assistant le lit et l'écrit comme n'importe quel fichier.
- Chaque opération est une commande, et les mêmes opérations sont des outils MCP pour Claude Code, Cursor, Codex,
  Gemini CLI ou tout client MCP ([MCP](docs/fr/MCP.md)). L'Assistant du Studio les donne à n'importe quel modèle.
- Après chaque modification, l'assistant peut valider, résoudre, rejouer et faire une capture : il voit ses propres
  erreurs.
- Chaque résultat reste relisible par une personne, dans le Studio et dans Git. `CLAUDE.md` et `AGENTS.md` en fixent
  les règles.

## Images et son

`npm run prompts` écrit des prompts d'image prêts à coller pour chaque planche de personnage, objet, décor et meuble,
tous dans un même style. `npm run assets` découpe les planches générées en sprites ([PROMPTS](docs/fr/PROMPTS.md)).
`npm run audio` arrange un MIDI pour les puces de la Mega Drive et rend les bruitages avec la même palette
([AUDIO](docs/fr/AUDIO.md)).

## Documentation

| Lire | Pour |
|---|---|
| [WORKFLOW](docs/fr/WORKFLOW.md) | la méthode, de la première idée à la release |
| [CONTENT_GUIDE](docs/fr/CONTENT_GUIDE.md) · [CLASSICS](docs/fr/CLASSICS.md) · [DESIGN](docs/fr/DESIGN.md) | écrire le contenu, les mécaniques célèbres, en faire un bon jeu |
| [STUDIO](docs/fr/STUDIO.md) · [TOOLS](docs/fr/TOOLS.md) · [MCP](docs/fr/MCP.md) | le Studio, chaque commande, les outils pour l'IA |
| [ENGINE](docs/fr/ENGINE.md) · [BENCH](docs/fr/BENCH.md) | le fonctionnement du moteur, ce que la preuve sait faire et ne sait pas faire |
| [PROMPTS](docs/fr/PROMPTS.md) · [AUDIO](docs/fr/AUDIO.md) · [PAGES](docs/fr/PAGES.md) | les images, le son, les pages de relecture |
| [PACKAGE](docs/fr/PACKAGE.md) | un jeu dans son propre projet : `npx create-web-scumm`, la commande `web-scumm` |
| [ROADMAP](docs/fr/ROADMAP.md) · [CHANGELOG](CHANGELOG.md) · [UPGRADING](docs/fr/UPGRADING.md) | d'où il vient, chaque release, passer à une nouvelle version |

Chaque page existe aussi en anglais sous `docs/en/`. `docs/dev/` contient le journal du travail avec l'autre
assistant.

## Releases

Release actuelle : [v3.5.0 « Score »](https://github.com/wanoo/web-scumm/releases/tag/v3.5.0) : un directeur musical
aux stems calés, des workers de preuve, et un propriétaire canonique des objets dans les preuves. L'histoire de la v1.3
à la v3.5 est dans la [ROADMAP](docs/fr/ROADMAP.md), chaque changement dans le [CHANGELOG](CHANGELOG.md).

## Plan du dépôt

```
src/engine/      core (le DSL, le moteur), tools (validate, solve, lint, i18n…), dom (le rendu), minigames
games/demo/      le jeu d'exemple : lieux, plans, images, audio, traductions, storyboard
games/_template/ copié par npm run new-game
tools/           les commandes, le Studio, le serveur MCP, la chaîne d'images
scripts/         les tests navigateur, la fin scellée, new-game, les captures du README
docs/en docs/fr  la documentation ; docs/dev : le journal de travail
```

Les images de cette page viennent du bundle de production et du Studio, prises par `npm run docs:screenshots`.

## Licences

Code : MIT. Images, bruitages et thème d'exemple : CC BY 4.0 (attribution « Wano ») ; le thème est *Le Lac des
cygnes* de Tchaïkovski (domaine public), écrit et arrangé pour le projet, si bien que le jeu d'exemple passe
`npm run verify:commercial` (3.7). Polices : SIL OFL. Voir `CREDITS.md`.
