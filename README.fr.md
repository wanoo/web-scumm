<p align="center"><img src="docs/img/logo.png" width="128" height="128" alt="Le logo de web-scumm : un aventurier en pixel art"></p>

# web-scumm

**Écrire un point-and-click comme des données, prouver qu'on peut le finir, le livrer sur un téléphone.**

web-scumm est un moteur façon SCUMM pour le navigateur, un Studio visuel pour fabriquer le jeu, et une chaîne d'outils
qui vérifie le contenu, prouve que chaque énigme a une issue, et construit un jeu web qui s'installe sur un téléphone
et se joue hors ligne. Un jeu, ce sont des pièces, des accessoires, des règles et des répliques, toutes en données
simples : une personne les écrit, un assistant IA les écrit, un solveur les lit.

*[English version](README.md)*

| | |
|---|---|
| 🎮 **Jouer** | [La Clé du garde-manger](https://wanoo.github.io/web-scumm/), le jeu d'exemple, sur téléphone en paysage ou sur ordinateur |
| 🛠 **Studio** | [Ouvrir le Studio](https://wanoo.github.io/web-scumm/studio.html) en mode démo : modifiez le jeu d'exemple, vos modifications restent dans votre navigateur |
| ⏱ **Commencer** | [Une première pièce en quinze minutes](docs/fr/TUTORIAL.md), puis [faire son propre jeu](#faire-son-propre-jeu) |
| 📚 **Docs** | [La méthode](docs/fr/WORKFLOW.md) · [le format du contenu](docs/fr/CONTENT_GUIDE.md) · [toutes les pages](#documentation) |

![La Clé du garde-manger : le salon de Grand-mère, neuf verbes, le sac](docs/img/v36-hero.webp)

## Trois commandes

```bash
npm install && npm run new-game lamp "The Lamp"   # un jeu complet d'une pièce, depuis le modèle
npm run dev                                       # y jouer ; npm run studio ouvre le Studio à côté
npm run verify:game && npm run build              # vérifié, prouvé, construit dans dist/ pour n'importe quel hébergement statique
```

Il faut Node 22.12 ou plus récent. Python 3 et ffmpeg servent aux outils d'image et au pipeline sonore : optionnels, et
`npm run doctor` dit lequel manque. Windows, macOS et Linux ([SUPPORT](docs/fr/SUPPORT.md) a la matrice).

## Ce que vous obtenez

| Pour | web-scumm donne |
|---|---|
| **Le joueur** | neuf verbes classiques et un sac, des dialogues à sujets et à choix, des indices donnés par un personnage, des cinématiques et des coups de téléphone, des pièces plus larges que l'écran, plusieurs personnages jouables, sept mini-jeux, une fin scellée optionnelle, l'autosauvegarde et des emplacements, des traductions, des réglages, le tactile, la souris et le clavier, le jeu entier hors ligne après la première visite |
| **L'auteur** | un storyboard d'abord, puis des pièces, des accessoires à états, des personnages, des objets, des règles, des sujets, des indices, des scripts et des événements, en données sans aucun code ; vingt mécaniques célèbres du genre écrites avec ([CLASSICS](docs/fr/CLASSICS.md)) |
| **L'artiste** | un prompt pour chaque planche de sprites, objet et décor dans un seul style, des planches découpées en sprites, une musique chiptune arrangée depuis un MIDI et des bruitages tirés d'une même palette ([PROMPTS](docs/fr/PROMPTS.md), [AUDIO](docs/fr/AUDIO.md)) |
| **Le studio** | un Studio visuel sur le vrai moteur (pièces, storyboard, assets, vérifications, jeu, notes avec un assistant), les mêmes opérations en outils MCP pour n'importe quel client IA, et une ligne de commande ([STUDIO](docs/fr/STUDIO.md), [MCP](docs/fr/MCP.md), [TOOLS](docs/fr/TOOLS.md)) |
| **La release** | un validateur pour les références cassées et les lignes non traduites, un solveur qui prouve un chemin jusqu'à la fin et nomme chaque état où elle est perdue, des sauvegardes qui se chargent d'une version à l'autre, la licence de chaque fichier livré, ce qu'un téléphone doit télécharger, de vrais navigateurs à chaque changement ([ENGINE](docs/fr/ENGINE.md), [BENCH](docs/fr/BENCH.md)) |
| **L'extérieur** | un jeu peut réagir à un fait du monde (un e-mail répondu, un webhook appelé) par un signal signé, sans que son contenu touche au réseau ([REALITY](docs/fr/REALITY.md)) |

## Ce que voit le joueur

<table>
<tr><td width="50%" valign="top"><img src="docs/img/v36-player-scene.webp" alt="Parler à Grand-mère : ses sujets dans la colonne de droite" width="100%"><br><sub>Des conversations à sujets, à choix, avec transcription</sub></td><td width="50%" valign="top"><img src="docs/img/v36-player-minigame.webp" alt="Le mini-jeu des tuyaux : amener l'eau aux champignons" width="100%"><br><sub>Des mini-jeux, jouables au tactile ou au clavier</sub></td></tr>
<tr><td width="50%" valign="top"><img src="docs/img/v36-player-map.webp" alt="La carte du monde avec les personnages épinglés" width="100%"><br><sub>Une carte du monde, des personnages qui se déplacent entre les lieux</sub></td><td width="50%" valign="top"><img src="docs/img/v36-player-ending.webp" alt="La carte finale : Pixel a trouvé les sardines" width="100%"><br><sub>Une fin qui se souvient de ce que le joueur a deviné</sub></td></tr>
</table>

## Ce que voit l'auteur

<table>
<tr><td width="50%" valign="top"><img src="docs/img/v36-studio-rooms.webp" alt="Studio, onglet Rooms : le garde-manger sélectionné, ses lignes look et ses réactions modifiables" width="100%"><br><sub><b>Rooms</b> : le vrai moteur, un éditeur de placement par-dessus, chaque ligne modifiable sur place</sub></td><td width="50%" valign="top"><img src="docs/img/v36-studio-storyboard.webp" alt="Studio, onglet Storyboard : tableaux et panneaux, 100 % implémentés" width="100%"><br><sub><b>Storyboard</b> : l'histoire panneau par panneau, confrontée au jeu</sub></td></tr>
<tr><td width="50%" valign="top"><img src="docs/img/v36-studio-assets.webp" alt="Studio, onglet Assets : la planche de Pixel, case par case, avec où chaque case sert" width="100%"><br><sub><b>Assets</b> : chaque planche et chaque case, où elle sert, le prompt pour la faire</sub></td><td width="50%" valign="top"><img src="docs/img/v36-studio-check.webp" alt="Studio, onglet Check : validateur, chemin du solveur et santé du solveur" width="100%"><br><sub><b>Check</b> : le validateur et le solveur, relancés après chaque enregistrement</sub></td></tr>
</table>

<img src="docs/img/v36-proof-graph.webp" alt="Le graphe des énigmes avec le chemin critique et la chaleur du solveur" width="420" align="right">

Le graphe des énigmes montre à quoi mène chaque objet, drapeau et pièce. Avec **Critical path**, ce qui ne mène pas à
la fin s'estompe. Avec **Heat**, les règles que le solveur a le plus traversées passent au rouge. Le Studio a aussi un
onglet Play avec un explicateur de règle et le replay des sessions, des notes partagées avec l'IA, et un Assistant qui
marche avec n'importe quel modèle.

<br clear="right">

## Comment un jeu s'écrit

Tout est données : pièces, accessoires à états, personnages, objets, règles, sujets, indices, scripts, événements.
Il n'y a pas de code dans le contenu, donc chaque outil peut le lire, le vérifier et le jouer.

```ts
export const garden: RoomDef = {
  id: 'garden', name: 'Le jardin', decor: 'garden',
  props: { tank: { name: 'citerne', states: { full: 'tank_full', empty: 'tank_empty' } } },
  actors: { grandpa: { char: 'grandpa' } },
  exits: { back_door: { name: 'porte du fond', to: 'house', entry: 'garden' } },
  on: [
    { verb: 'use', a: 'pipe', b: 'tank', if: '!tank_drained',
      do: [{ minigame: 'pipes', params: { /* voir games/demo */ } }, { lose: 'pipe' }, { set: 'tank_drained' }, { prop: ['tank', 'empty'] }] },
  ],
  talk: { grandpa: [{ topic: 'Où est la clé ?', if: '!tank_drained', do: [{ say: ['grandpa', 'Tombée dans la citerne. Plouf.'] }] }] },
  hints: [{ until: 'tank_drained', lines: ['Utilise le tuyau sur la citerne.'] }],
};
```

Une règle est un verbe, une cible, une condition et une liste de commandes. Le solveur joue ces règles comme le moteur
les joue, et c'est pour cela qu'il peut prouver le jeu : le même `Engine`, le même `resolve`, pas de second modèle du
contenu.

## Pourquoi une IA peut vraiment y travailler

- Le contenu est déclaratif, donc un assistant le lit et l'écrit comme n'importe quel fichier ; `AGENTS.md` tient
  les règles.
- Chaque opération est une commande, et les mêmes opérations sont des outils MCP pour Claude Code, Cursor, Codex,
  Gemini CLI ou n'importe quel client MCP ([MCP](docs/fr/MCP.md)). L'Assistant du Studio les donne à tout modèle.
- Après chaque changement, l'assistant peut valider, résoudre, rejouer une session et prendre une capture d'écran :
  il voit ses propres erreurs avant qu'une personne les voie. Chaque résultat reste relisible, dans le Studio et dans
  Git.

## Faire son propre jeu

**Dans son propre projet** ([PACKAGE](docs/fr/PACKAGE.md)) : le moteur s'installe depuis l'archive d'une release (la
publication npm est prévue pour la 4.2, puis `npx create-web-scumm mon-jeu`) :

```bash
T=https://github.com/wanoo/web-scumm/releases/download/v4.1.15/web-scumm-4.1.15.tgz
npx --package=$T web-scumm create mon-jeu "Mon jeu" --engine=$T
cd mon-jeu && npm install
npm run assets && npm run dev        # puis npm run verify, npm run build, npm run release
```

**Dans ce dépôt**, à côté des jeux d'exemple :

```bash
npm install
npm run doctor                       # Node et Chromium requis ; modules Python, ffmpeg, Firefox, WebKit optionnels
npm run new-game mon-jeu "Mon jeu"   # games/mon-jeu depuis le modèle, choisi comme jeu courant
npm run assets                       # prépare les images de remplacement
npm run studio                       # le Studio : pièces, histoire, assets, vérifications, jeu
```

Puis, avant que quelqu'un y joue : `npm run verify:game` (validation, un chemin jusqu'à la fin, chapitres,
traductions, lint, playtests), `npm run prove:game` (chaque état atteignable : softlocks et troncature font échouer),
`npm run build` (vérification des types, tests, bundle et audits, dans `dist/` pour n'importe quel hébergement
statique). `npm run dev` joue votre jeu sur cet ordinateur, `npm run dev:lan` sur votre téléphone.
[TUTORIAL](docs/fr/TUTORIAL.md) parcourt la première pièce ; [WORKFLOW](docs/fr/WORKFLOW.md) est toute la méthode.

## En chiffres

Mesuré sur ce commit de `main`, par les gates automatiques qui tournent à chaque changement (`npm run quality:baseline`
écrit les trois chiffres depuis `tests/quality-baseline.json`) :

| Quoi | Résultat |
|---|---|
| Tests unitaires | <!-- metric:tests -->1414<!-- /metric --> déclarations, sous Node 22 et 24, avec des planchers de couverture par module et des tests de mutation sur ce dont dépendent une sauvegarde, une session, une condition et un signal |
| Tests navigateur | le jeu d'exemple joué jusqu'à sa fin au tactile et au clavier dans Chromium et WebKit à la taille d'un téléphone, en anglais et en français, avec le peintre DOM et le peintre Canvas ; un second jeu et le jeu de référence aussi ; chaque mini-jeu gagné au clavier ; axe-core sur chaque écran |
| Sauvegardes | une sauvegarde figée par release de la 3.0.0 à la 4.1.15 se charge et atteint la fin |
| Preuve | chaque état atteignable du jeu d'exemple en quelques secondes ; un jeu de référence de 40 pièces en <!-- metric:referenceStates -->288<!-- /metric --> états ; 500 jeux aléatoires de chacune de trois sortes comparés à une recherche explicite chaque nuit, 0 divergence ([BENCH](docs/fr/BENCH.md)) |
| Un nouveau jeu | empaqueté, créé depuis l'archive, installé, vérifié, construit et joué jusqu'à sa fin par la CI ; un jeu fait sur la release précédente mis à niveau et sa sauvegarde jouée jusqu'à la fin |
| La première visite du joueur | <!-- metric:initialJsKB -->132<!-- /metric --> Ko de JavaScript, gzippés, tenus par un budget ; chaque octet téléchargé prédit par le graphe des assets |
| La release | construite depuis le commit testé par la CI, chaque fichier justifié avec sa licence, SBOM, sommes SHA-256 et attestation de provenance, jamais remplacée une fois publiée |

Ce que seules des personnes et de vrais appareils peuvent vérifier est listé, pas revendiqué : [FIELD](docs/fr/FIELD.md),
et les notes de chaque release disent quelles passes ont été faites.

## Documentation

| Lire | Pour |
|---|---|
| [TUTORIAL](docs/fr/TUTORIAL.md) · [WORKFLOW](docs/fr/WORKFLOW.md) | une première pièce en quinze minutes ; la méthode de la première idée à la release |
| [CONTENT_GUIDE](docs/fr/CONTENT_GUIDE.md) · [CLASSICS](docs/fr/CLASSICS.md) · [DESIGN](docs/fr/DESIGN.md) | écrire le contenu, les mécaniques célèbres, en faire un bon jeu |
| [STUDIO](docs/fr/STUDIO.md) · [TOOLS](docs/fr/TOOLS.md) · [MCP](docs/fr/MCP.md) | le Studio, chaque commande, les outils IA |
| [ENGINE](docs/fr/ENGINE.md) · [BENCH](docs/fr/BENCH.md) · [FIELD](docs/fr/FIELD.md) | comment marche le moteur, ce que la preuve peut et ne peut pas, ce que seuls des gens et de vrais appareils vérifient |
| [PROMPTS](docs/fr/PROMPTS.md) · [AUDIO](docs/fr/AUDIO.md) · [PAGES](docs/fr/PAGES.md) | les images, le son, les pages de relecture |
| [REALITY](docs/fr/REALITY.md) · [REALITY-OPS](docs/fr/REALITY-OPS.md) | un jeu qui réagit au monde extérieur, et comment faire tourner son Bridge |
| [PACKAGE](docs/fr/PACKAGE.md) · [API](docs/fr/API.md) · [SUPPORT](docs/fr/SUPPORT.md) | un jeu dans son propre projet, l'API publique avec ses signatures, ce qui reste stable et sur quelles plateformes |
| [ARCHITECTURE](docs/fr/ARCHITECTURE.md) · [CODE_TOUR](docs/fr/CODE_TOUR.md) · [CONTRIBUTING](CONTRIBUTING.md) | comment le code est assemblé, une visite d'une demi-heure, comment le changer (et les décisions dans `docs/dev/adr/`) |
| [ROADMAP](docs/fr/ROADMAP.md) · [CHANGELOG](CHANGELOG.md) · [UPGRADING](docs/fr/UPGRADING.md) | d'où ça vient, chaque release, passer à une nouvelle version |

Chaque page existe aussi en anglais sous `docs/en/`, et un test garde les deux au même pas. `docs/dev/` est le
journal du travail.

## Releases

Release actuelle : [v4.1.15 « Remix »](https://github.com/wanoo/web-scumm/releases/tag/v4.1.15), la huitième et
dernière du programme 4.1.8 → 4.1.15 et la release candidate de la 4.2 : un jeu, plusieurs mondes depuis un manifeste
et une seed, les mêmes sur chaque runtime et chaque monde d'un catalogue prouvé ; une sauvegarde qui porte son monde ;
des codes de seed, le défi quotidien et les seeds Mystery ; la roue de code ; l'onglet Remix du Studio ; le DSL et
l'IR gelés. Sur les runs et les preuves de la 4.1.14, le solveur de la 4.1.13, le jeu en données de la 4.1.12, la
scène de la 4.1.11, le Bridge durable de la 4.1.10, les connecteurs de la 4.1.9 et la fondation de la 4.1.8. De la 4.1.1 à la 4.1.7 chaque
release n'a ajouté que de l'optionnel, et un jeu écrit pour l'une tournait sur la suivante ; depuis la 4.1.8 la lignée
4.1.x est une lignée d'incubation, où une release peut rompre un nom public ou un format, documenté et avec une
migration, jusqu'à la 4.2.0 qui rétablit le SemVer strict ([SUPPORT](docs/fr/SUPPORT.md)). L'histoire de la v1.3 à
aujourd'hui est dans la [ROADMAP](docs/fr/ROADMAP.md), chaque changement dans le [CHANGELOG](CHANGELOG.md).

## Plan du dépôt

```
src/engine/      core (le DSL, le moteur), tools (validate, solve, lint, i18n…), dom (le joueur), minigames, reality
games/demo/      le jeu d'exemple : pièces, layouts, images, audio, locales, storyboard
games/_template/ copié par npm run new-game
tools/           les commandes, le Studio, le serveur MCP, les pipelines d'image et d'audio, les plugins Vite
bridge/          le Reality Bridge (le paquet web-scumm-bridge)
scripts/         les tests navigateur, la fin scellée, new-game, les captures du README
docs/en docs/fr  la documentation ; docs/dev : le journal du travail, les décisions, les passes de chaque release
```

Les images de cette page viennent du bundle de production et du Studio, prises par `npm run docs:screenshots`.

## Licences

Code : MIT. Images, bruitages et thème du jeu d'exemple : CC BY 4.0 (attribution « Wano ») ; le thème est le *Lac des
cygnes* de Tchaïkovski (domaine public), relevé et arrangé pour le projet, si bien que le jeu d'exemple passe
`npm run verify:commercial`. Polices : SIL OFL. Voir `CREDITS.md`.

web-scumm est un projet indépendant. « Façon SCUMM » nomme un genre de jeu ; le projet n'est ni affilié à, ni
approuvé par, ni dérivé de LucasArts, Lucasfilm, Disney ou du projet ScummVM, et ne livre rien de leur code, de leurs
données ou de leurs images.
