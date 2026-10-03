# web-scumm

Un moteur de point & click façon SCUMM pour téléphone, avec ses outils d'écriture et la méthode de travail avec une IA
qui a permis de livrer un jeu familial complet de 9 lieux en une seule journée. L'histoire s'écrit en données, les choses
se placent à la souris ou au doigt, un solveur prouve que le jeu se finit, et il se joue en paysage sur n'importe quel
téléphone, hors ligne après la première visite.

*[English version](README.md)*

| | |
|---|---|
| 🎮 **Jouer au jeu d'exemple** | https://wanoo.github.io/web-scumm/ (téléphone en paysage, ou ordinateur) |
| 🛠 **Essayer le Studio** | https://wanoo.github.io/web-scumm/studio.html (mode démo : les modifications restent dans le navigateur) |
| 📦 **Code source** | https://github.com/wanoo/web-scumm · version v2.2.0 |

## En images

![Trois lieux du jeu d'exemple](docs/img/banner.jpg)

| | |
|---|---|
| ![Écran titre](docs/img/title.jpg) *Écran titre, téléphone en paysage* | ![Dialogue](docs/img/dialogue.jpg) *Sujets de conversation, transcription, couleur par personnage* |
| ![Appel à deux voix](docs/img/phone-call.jpg) *Un appel à deux voix* | ![Carte](docs/img/map.jpg) *La carte, véhicules et marqueurs « du nouveau »* |
| ![Mini-jeu des tuyaux](docs/img/minigame-pipes.jpg) *Mini-jeu des tuyaux, voix d'indice en haut* | ![Mini-jeu de choix](docs/img/minigame-pick.jpg) *Choisir la bonne fleur* |
| ![Ticket à gratter](docs/img/ending-scratch.jpg) *La fin scellée : un ticket à gratter* | ![Carte finale](docs/img/ending-card.jpg) *La carte finale juge le pronostic du joueur* |
| ![Éditeur de placement](docs/img/editor.jpg) *L'éditeur de placement dans le navigateur (`?edit=house`)* | ![Page de placement](docs/img/placement-page.jpg) *La page de placement pour téléphone* |
| ![Studio, onglet Lieux](docs/img/studio-rooms.jpg) *Le Studio, onglet Lieux : le vrai moteur, la fiche de l'élément, textes édités en place* | ![Studio, onglet Storyboard](docs/img/studio-storyboard.jpg) *Le Studio, onglet Storyboard : cases, répliques, aperçu, notes* |
| ![Studio, onglet Check](docs/img/studio-check.jpg) *Le Studio, onglet Check : validateur, chemin du solveur, captures* | ![Studio, onglet Notes](docs/img/studio-notes.jpg) *Le Studio, onglet Notes : le journal partagé entre toi et l'IA* |
| ![Studio, onglet Assets](docs/img/studio-assets.jpg) *Le Studio, onglet Assets : chaque planche et chaque case, où elle sert, le prompt de génération, les dépôts* | ![Studio, un décor avec ses zones](docs/img/studio-assets-decor.jpg) *Un décor avec ses zones, accessoires et bande de sol superposés* |
| ![Studio, Assistant](docs/img/studio-assistant.jpg) *L'Assistant : n'importe quel modèle, les mêmes outils que le serveur MCP, à propos de l'élément sélectionné* | ![Studio, réglages de l'Assistant](docs/img/studio-assistant-settings.jpg) *Réglages : OpenAI, Anthropic, Mistral, Ollama ou un point d'accès maison, clé gardée dans ton navigateur* |

## État d'avancement
- Moteur, outils et jeu d'exemple : complets et jouables de bout en bout (validateur, solveur, 154 tests, parcours Playwright).
- Pages de validation (storyboard, contrôle des sprites, placement) : fonctionnelles, en HTML local ou en artefact claude.ai.
- **Studio** (`npm run studio`) : un environnement de création complet en local : lieux (WYSIWYG sur le vrai moteur), textes, storyboard, notes, **assets** (chaque image et son, prompts par planche, dépôts découpés automatiquement) et un **Assistant** qui branche n'importe quel modèle (OpenAI, Anthropic, Mistral, Ollama…) avec les mêmes outils que le serveur MCP. Voir `docs/fr/STUDIO.md`.
- **Générateur de prompts** (`npm run prompts`) : prompts prêts à coller pour chaque planche de personnage (marche, parole, assis, poses spéciales utilisées par les lieux), planche d'objets avec états, décors et meubles, tous avec le même bloc de style. Voir `docs/fr/PROMPTS.md`.
- **Discipline de couleur et préréglage pixel art** : chaque prompt généré porte les règles de couleur (4 tons par matière avec décalage de teinte, aplats, un seul contour) ; `artStyle: "pixel"` dans `site.json` bascule prompts, découpe (plus proche voisin, palette partagée, PNG indexé), pipeline (sans perte) et rendu en vrai pixel art. **Palette swap** dans le moteur : un personnage ou une variante recoloré à partir des mêmes sprites.
- **Studio** (v2.2) : l'**arbre de dialogue** d'un personnage (sujets, répliques, choix, branches avec leurs conditions) dans l'onglet Rooms et en outil MCP `dialogue_tree`, dérivé du DSL ; le **journal** du moteur (ce qui a répondu, événements, pas de script, déplacements, changements de joueur) dans l'onglet Play et le panneau dev.
- **Preuve** (v2.1) : **les classiques** (`docs/fr/CLASSICS.md` : vingt mécaniques célèbres écrites avec le DSL, cinq jouées et prouvées dans les tests) ; le **graphe de puzzles** (ce que chaque règle exige et change, une fiche par objet / flag : Check du Studio, `npm run page:puzzles`, outil MCP `puzzle_graph`) ; un **solveur** qui essaie chaque réponse d'un choix, garde exacts les compteurs qui baissent, joue les scripts un wait à la fois et laisse de côté ce qui ne peut pas compter ; un **jeu de charge généré** (`npm run bench`, `docs/fr/BENCH.md`) ; un seul **catalogue des commandes** vérifié par `tsc` ; des boucles avec sons d'image ; des traductions qui suivent un texte déplacé.
- **Ouverture** (v2.0) : **commandes custom** (`commands` dans `index.ts` : des `effects` déclarés pour le solveur, un `run` pour le navigateur) ; **traductions par extraction** (`npm run i18n`, `locales/<lang>.json`, un réglage Langue) ; l'onglet **Play** du Studio (le jeu à côté de son état en direct et d'un explicateur de règles : pourquoi cette action répond ça) ; micro-jeux de test par primitive dans `tests/fixtures/`.
- **Distribution** (v1.6) : **plusieurs personnages jouables** (`players`) : chacun son lieu, sa position et son sac ; boutons de bascule dans la rangée d'outils, `{ switchPlayer }`, `{ transfer }`, condition `{ player }` ; donner un objet à un personnage inactif le lui transmet ; le solveur bascule comme le joueur. Démo : Biscuit est jouable.
- **Image** (v1.5) : **lieux larges** (`width` dans le layout) avec une **caméra** qui suit le héros et des commandes `camera` (panoramique, centrer sur quelque chose) ; **animations d'accessoires à événements de frame** (`anims`, `{ play }`, `at: { image: [commandes] }`, aussi sur `anim` des personnages) ; **voix** sur les répliques (`audio.voices`, `say.voice`) ; un menu **Réglages** (vitesse et taille du texte, réduire les animations, police lisible, volumes musique / sons / voix).
- **Échelle** (v1.4) : **sorties déclarées** (`exits` : un hotspot et sa règle goto, générés) et la **carte du monde** que les outils en tirent (lieux inaccessibles, sorties sans retour ; Check du Studio, `npm run page:world`) ; **chapitres** (`goals` sur les checkpoints, `npm run solve -- --chapters`) et **invariants** ; **emplacements de sauvegarde** avec export / import et **migrations en données** entre `saveVersion` ; un **profileur de contenu** (`npm run validate -- --report`, Studio, MCP `content_report`).
- **Le monde vit** (v1.3) : des **scripts** qui tournent tout seuls entre les actions du joueur (un PNJ qui déambule, un gag d'ambiance, `loop` / `while` / `waitUntil` / `waitEvent`), des **événements** (`{ emit }` et écouteurs `events`, lieu puis jeu) et des **personnages mobiles** (`room` + `moveActor`, condition `{ actorIn }`). Tout en données : sauvegardé avec la partie, vérifié par le validateur, joué par le solveur. Voir « Le monde vit » dans `docs/fr/CONTENT_GUIDE.md` ; la feuille de route vers un moteur d'échelle LucasArts est dans `docs/fr/ROADMAP.md`.
- **Guide de conception** (`docs/fr/DESIGN.md`) : comment construire un bon jeu SCUMM avec ce moteur, avec la liste de contrôle avant de partager le lien.
- Essayer le Studio dans le navigateur : https://wanoo.github.io/web-scumm/studio.html (mode démo, les modifications restent dans ton navigateur).
- **Serveur MCP** (`npm run -s mcp`) : les mêmes opérations comme outils pour Claude Code, Cursor, Codex, Gemini CLI ou tout client MCP. Voir `docs/fr/MCP.md`.
- À venir : ajout et suppression de sujets de conversation et de réactions depuis le Studio, écoute des bruitages dans l'aperçu du storyboard.

## Ce qu'il y a dedans
- **Un moteur** (`src/engine`, TypeScript, sans framework) : les 9 verbes classiques, le sac, des dialogues avec
  transcription, des indices, une carte du monde avec véhicules, des cinématiques, des appels à deux voix, des
  mini-jeux (tuyaux, câbles emmêlés, choix d'image, cache-cache, course, caresses, ticket à gratter), une **fin
  scellée** facultative (chiffrée, dévoilée en jouant), sauvegarde, tactile et souris, mises en page téléphone et
  ordinateur, cache hors ligne.
- **Un format de contenu** en données pures : lieux, accessoires à états, personnages, réactions (`verbe` + cible +
  condition + commandes), sujets de conversation, indices. Aucune fonction, donc tout se vérifie.
- **Des outils** : validateur, solveur, éditeur de placement dans le navigateur, chaîne d'assets (planches générées
  par IA → sprites découpés → webp), kit de bouches pour la parole, pages de validation pour téléphone (storyboard,
  contrôle des sprites, placement) publiables en artefact claude.ai, parcours Playwright avec captures.
- **Une méthode de travail avec une IA** (`docs/fr/WORKFLOW.md`), un `CLAUDE.md`, des skills pour Claude Code et un
  gabarit de plan de production pour des sous-agents en parallèle.

## Démarrer
Il faut Node 22+, Python 3 avec `pip install -r requirements.txt` (Pillow, NumPy, SciPy pour les outils de sprites) et ffmpeg pour les sons.
```bash
npm install
npm run dev                  # ouvrir l'adresse sur le téléphone (même Wi-Fi), en paysage
npm run validate             # cohérence du contenu
npm run solve                # prouve que le jeu se finit, imprime le chemin
npm test                     # tests du moteur + parcours du jeu d'exemple
npm run build                # types, tests, bundle, contrôle des spoilers, audit → dist/
npm run studio               # le Studio sur /__studio/ : lieux WYSIWYG, textes, storyboard, notes, vérifications (local)
npm run -s mcp               # serveur MCP (stdio) qui expose les mêmes opérations à n'importe quelle IA
```

Faire son propre jeu :
```bash
npm run new-game mon-jeu "Mon Jeu"   # games/mon-jeu depuis le gabarit, devient le jeu courant
npm run assets                       # prépare les images de remplacement
npm run dev                          # ?edit=start pour placer, ?dev&at=start pour sauter à un checkpoint
```
Puis lire `docs/fr/CONTENT_GUIDE.md` et écrire `games/mon-jeu/rooms/*.ts`. L'histoire s'écrit d'abord dans
`storyboard.json` ; `docs/fr/WORKFLOW.md` décrit toute la méthode, `docs/fr/PROMPTS.md` comment générer des images cohérentes.

## Plan du dépôt
```
src/engine/      core (DSL, moteur, solveur, validateur), dom (rendu), minigames, ending, dev (éditeur)
games/demo/      le jeu d'exemple : game.ts, rooms/, layout/, art/, audio/, storyboard.json, site.json
games/_template/ copié par npm run new-game
tools/           validate, solve, refs, assets.py, cut-sheet.py, talk-*.py, pages/, audit-assets
scripts/         harnais e2e, seal (fin scellée), gen-icons, new-game
docs/en docs/fr  ENGINE, CONTENT_GUIDE, DESIGN (guide de conception), CLASSICS (les mécaniques célèbres, écrites avec le DSL), TOOLS, WORKFLOW, PROMPTS, PAGES, PRODUCTION.template
```

## Déployer
`npm run build` produit un `dist/` statique. Le workflow CI le publie sur GitHub Pages à chaque push sur `main`.
Tout hébergeur statique convient (Clever Cloud, Netlify, un nginx). `GAME=<id> npm run build` construit un autre jeu.

## Licences
Code : MIT. Images d'exemple : CC BY 4.0 (attribution « Wano »). Bruitages : Kenney, CC0. Polices : SIL OFL. Voir `CREDITS.md`.
