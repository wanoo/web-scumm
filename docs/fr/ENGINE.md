# Le moteur

Un moteur de point & click façon SCUMM, pour navigateur, pensé pour le téléphone en paysage.
Il ne connaît aucun jeu : un jeu est un dossier de contenu (`games/<jeu>/`) que le moteur lit. Le jeu courant se choisit avec `GAME=<jeu>`
(sinon `package.json` → `"config": { "game" }`, sinon `demo`) : voir `TOOLS.md`.

## Découpage

```
src/engine/
  core/         logique pure (aucun DOM) : état, conditions, réactions, scripts, conversations, indices
    types.ts      le format de contenu, commenté (la référence)
    engine.ts     la classe Engine : actions du joueur, résolution, interpréteur de commandes
    ports.ts      interface Presenter (ce que le cœur demande à l'affichage) + FakePresenter pour node
    cond.ts       évaluation des conditions
    define.ts     defineGame / defineRoom, clés stables des blocs once/nth/cycle/random
  dom/          l'affichage navigateur (implémente Presenter)
    app.ts        mise en page paysage, verbes, sac, répliques, menus, carte, mini-jeux, fin scellée, écran titre
    fonts.ts      polices par défaut (DotGothic16, Press Start 2P), remplacées par `skin.fonts`
    room.ts       la scène : décor, accessoires, personnages, tri en profondeur, marche, poses
    walk.ts       zone marchable (triangulation earcut + chemins navmesh), échelle selon la profondeur
    audio.ts      musique (fondu, pile, morceau ponctuel) et bruitages, avec Howler
    assets.ts     images et sons préparés par `npm run assets`
  minigames/    mini-jeux (plugins DOM) : pipes, stroke, pick, hide, runner, scratch, cables ; toutes leurs images viennent des `params`
  ending/       la fin scellée (facultative) : seal.ts (AES-GCM), card.ts (la carte finale), index.ts (déchiffrement, ticket, confetti)
  tools/        validateur et solveur (node)
  dev/          overlay de debug et éditeur de placement (dev uniquement)
```

Règle : `src/engine/` n'importe jamais `games/` et ne nomme aucune image, aucun son, aucun texte d'interface :
- les textes viennent de `GameDef.ui` ;
- les icônes, sons, polices et hauteurs par défaut viennent de `GameDef.skin` (voir `CONTENT_GUIDE.md`, « L'habillage ») ;
- les images des mini-jeux viennent de leurs `params` ;
- la fin scellée vient de `GameDef.ending`.

Un jeu est un dossier `games/<jeu>/` dont `index.ts` exporte `{ game, layouts, manifest, minigames?, extraImages? }`.
`src/main.ts` importe `@game` (alias vers `games/<GAME>/index.ts`) et ne sait rien d'autre du jeu.

Constantes de géométrie : la scène logique mesure 640 × 400 ; le sol descend au plus à `Layout.floor` (défaut 395, `FLOOR` dans `core/define.ts`) ;
un point d'approche enregistré à plus de 150 unités de sa cible (`NEAR`) est jugé périmé et recalculé.

Verbes : les ids sont libres (`verbs` du jeu). Quatre ont un sens pour le moteur : `look` (textes Regarder), `talk` (conversations, indices),
`give` et `use` (deux termes : objet du sac puis cible ; toucher un objet du sac sans verbe choisit `use`).

## Amorçage

`src/engine/boot.ts` `bootGame({ game, layouts, manifest, minigames, commands, locales, version, dev, sw })` est ce
qu'une page fait pour lancer un jeu : langue, polices, stockage de sauvegarde vérifié (premières erreurs gardées
jusqu'à ce que l'App puisse les montrer), l'`App`, `window.__game`, les outils de dev, le titre, le service worker.
`src/main.ts` l'appelle ; un jeu qui embarque le moteur aussi (docs/fr/UPGRADING.md §8). `pickLanguage`, `waitFonts`
et `openStore` sont exportés pour une page qui a besoin d'un autre ordre.

## Deux dispositions

- **Téléphone (écran tactile), en paysage** : la scène à gauche ; à droite, une colonne avec les 9 verbes en 3×3, le sac sur 3 colonnes et les icônes Carte / Menu / Son. La phrase s'affiche en bas de la scène.
- **Ordinateur (souris, écran d'au moins 720 × 450)** : disposition SCUMM classique. La scène occupe le haut ; la phrase est juste en dessous ; en bas à gauche, les 9 verbes ; à droite, le sac (4 × 2, flèches à gauche) ; tout à droite, les 3 icônes en colonne.
  Les choix de conversation et la liste des lieux prennent la place des verbes et du sac.

Le choix se fait tout seul (`App.layout`), et se refait si la fenêtre change de taille.

## Cache et fluidité

- Un **service worker** (vite-plugin-pwa / Workbox) garde l'application de base en cache dès la première visite. Les images et les sons sont gardés au premier usage, puis servis sans réseau.
  La musique est servie par morceaux (requêtes partielles) depuis le cache.
- Dès l'écran titre puis après chaque changement de lieu, le moteur **réchauffe en tâche de fond** le lieu courant, les lieux directement accessibles et leur audio, par lots dimensionnés par `GameDef.assetBudgets`. Puis, une fois par page, **le reste du jeu** (`GameDef.offline`, défaut `full`) : chaque image, bruitage, voix, musique et vidéo, lot par lot pendant les temps morts, en pause quand la page est cachée ; rien en « économie de données » ou en 2G, musiques et vidéos attendent mieux que la 3G. `offline: 'nearby'` garde seulement le réchauffement par lieu.
- Chaque adresse d'image ou de son porte `?v=<empreinte>` : l'empreinte change dès qu'un fichier de `public/assets` change, ce qui contourne l'ancien cache. Le fichier de la fin scellée (`data/`) est toujours redemandé au réseau d'abord.
- Après la première visite, le jeu entier se joue hors ligne (`npm run e2e:pwa` vérifie un lieu jamais visité depuis le cache). Avec `offline: 'nearby'`, un lieu jamais visité ni préchargé peut encore demander le réseau.

## Cycle d'une action

1. Le joueur choisit un verbe, puis touche une chose (ou un objet du sac, puis une cible).
2. `App` appelle `engine.act({ verb, a, b })`.
3. Le moteur fait marcher le héros jusqu'au point d'approche (layout), le tourne vers la cible.
4. `resolve` cherche la réaction : règle du lieu → règle du jeu → Regarder → Parler (indices, conversation) → sorte → refus → repli.
5. Les commandes s'exécutent une à une ; chacune appelle le Presenter (dire, marcher, changer un accessoire, jouer un son…).
6. À la fin, l'état est sauvegardé (autosauvegarde IndexedDB vérifiée, avec repli de compatibilité localStorage). Tout l'état est du JSON : `GameState` dans `types.ts`.
7. Dans les creux entre deux actions, les **scripts** du monde avancent d'une commande chacun (`ScriptDef`,
   `Engine.advance`) : PNJ qui déambule, gag d'ambiance, personnage qui change de lieu (`moveActor`) quand un événement
   émis (`emit`) réveille son `waitEvent`. Leur position vit aussi dans l'état : une sauvegarde les reprend, et le solveur
   les joue comme des actions (« Script <id> » : le script avance jusqu'à son prochain `wait`, une ronde est donc vue salle par salle). Le solveur essaie aussi chaque option d'un `choice` (le chemin s'écrit alors `Talk x: "sujet" › "réponse"`), et garde la valeur exacte d'un compteur qui baisse ou qui est posé à un nombre. Il laisse hors de l'état ce qui ne
   peut pas changer l'issue (le graphe de puzzles le dit : un flag que seul son poseur lit, un script d'horloge que
   personne ne regarde, un promeneur que personne n'attend), donc un monde décoratif ne lui coûte rien. Il note aussi
   ce que chaque action a lu (`Engine.reads`) et ce qui a répondu (`SessionEntry.ran`) : le profil (`--profile`) dit
   de quoi les états sont faits, et la réduction d'ordre partiel (`--por`, `src/engine/tools/por.ts`) saute les
   ordres des actions qui commutent.
8. Chaque entrée est **enregistrée** (`Engine.session` : actions, carte, changements de joueur, pas de script, avec les
   choix, réponses à la carte et tirages aléatoires rencontrés), donc une session exportée du jeu se rejoue sur un
   moteur silencieux (`replay()`, `npm run replay`) et retombe sur le même état ; la solution du solveur est une telle
   session (`SolveResult.steps`).

## Pourquoi ces choix

- **Rendu DOM plutôt que Phaser.** Les maquettes validées sont en DOM (images positionnées, texte net, CSS pour la mise en page).
  Une scène d'aventure compte une vingtaine d'images : le DOM suffit largement, et l'interface (verbes, sac, menus) reste en CSS.
  Le cœur ne dépend pas du rendu : un autre Presenter (Phaser, canvas) peut le remplacer sans toucher au contenu.
- **Bibliothèques** : Howler (audio, déverrouillage iOS), earcut + navmesh (chemins), Tweakpane (outils de dev), Vite, Vitest, Playwright.
- **Contenu en données** : pas de fonctions dans le contenu, donc validable (`npm run validate`), solvable (`npm run solve`) et sauvegardable.

Voir aussi : [CONTENT_GUIDE.md](CONTENT_GUIDE.md) pour écrire un jeu, [TOOLS.md](TOOLS.md) pour les commandes et l'éditeur,
[PROMPTS.md](PROMPTS.md) pour les prompts qui produisent des assets cohérents.
