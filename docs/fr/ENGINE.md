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

## Sauvegardes : ce qui est garanti

- L'autosauvegarde et les emplacements manuels vivent dans IndexedDB (`dom/save-store.ts`), chaque écriture relue et
  vérifiée ; un navigateur sans IndexedDB (fenêtre privée, profil verrouillé) reçoit le stockage localStorage, annoncé
  une fois.
- Chaque opération dit ce qu'elle a fait : `save()` signale une écriture refusée par le rappel d'échec du stockage et
  `whenIdle()` rejette ; `clear()` et `clearSlot()` rendent `false` quand le navigateur a refusé la suppression (la
  sauvegarde est toujours là, la page continue de la montrer). L'App en tient compte : « Recommencer » garde la partie
  en cours quand l'autosauvegarde ne peut pas être effacée, « Nouvelle partie » depuis le titre reprend la partie
  sauvegardée à la place, un import de fichier ne charge jamais par-dessus la partie courante quand sa copie dans un
  emplacement libre a été refusée. Chaque cas affiche `ui.saveFailed`.
- Tests : écritures et suppressions refusées avec un IndexedDB factice (`tests/save-store.test.ts`), une sauvegarde
  figée par release (`tests/fixtures/saves/demo-<version>.json` : se charge, migre, atteint la fin), et dans un vrai
  navigateur `npm run e2e -- --save` (une sauvegarde manuelle survit à un rechargement) et `--save --no-indexeddb` (le
  repli aussi).
- Une sauvegarde plus ancienne est mise à niveau par la vraie version construite, dans Chromium et WebKit
  (`npm run e2e:a11y`, sa partie stockage, une porte de la CI depuis la 3.3) : l'autosauvegarde et l'emplacement v2
  en localStorage sont copiés dans IndexedDB et supprimés seulement une fois la copie vérifiée, une enveloppe 3.1.0
  déjà dans IndexedDB est migrée, le bouton Continuer du titre la reprend, et une sauvegarde manuelle survit ensuite
  à un rechargement.

## Accessibilité

Le jeu entier se joue au clavier : Tab atteint les verbes (les flèches circulent dans la grille, `aria-pressed` dit
lequel est choisi), les cibles de la scène (un bouton caché par point chaud, prop ou personnage visible, dans l'ordre
de la scène), le sac et les outils ; les choix d'une conversation et les lieux de la carte prennent le focus quand ils
apparaissent (flèches, Entrée) ; Espace ou Entrée fait avancer une réplique ; Échap ferme ce qui est au-dessus (un
menu, la carte, une transcription, le Passer d'une cinématique ou d'un mini-jeu) et sinon ouvre le menu pause, dont
le focus ne sort pas. Une région live annonce le lieu, chaque réplique et chaque objet gagné. `ui.advance` nomme le
repère « toucher pour continuer » pour les lecteurs d'écran. `npm run e2e -- --generic --keyboard` rejoue la solution
du solveur au clavier ; les mini-jeux eux-mêmes y sont passés (leur bouton Passer prend le focus).

Les mini-jeux livrés se jouent jusqu'au bout au clavier, pas seulement se passent : `pick` et `hide` (les options et
les cachettes sont des boutons nommés, les flèches déplacent, Entrée choisit), `pipes` (les flèches parcourent la
grille, Entrée tourne un tuyau), `runner` (▲ / W saute, ▼ / S se baisse), `stroke` (◀ ▶ en alternance, calmement ;
garder la touche appuyée est « trop vite »), `scratch` (les flèches déplacent une pièce sur la couche argentée, le
texte révélé est annoncé) et `cables` (Entrée sur une fiche la prend, Entrée sur une prise la branche). Le mini-jeu
prend le focus sur sa première commande, sinon Passer le garde. `tests/dom/minigames-keyboard.test.ts` joue cinq
d'entre eux jusqu'au bout avec des événements clavier.

**Ce qui est vérifié, et ce qui ne l'est pas.** `npm run e2e -- --axe` lance axe-core sur le titre, un lieu, le menu
pause et la fin, et `npm run e2e:a11y` sur un menu de conversation, la carte, les emplacements de sauvegarde et de
chargement, les confirmations d'écrasement et de recommencement, et chaque mini-jeu livré à son ouverture.
`npm run e2e:a11y` gagne aussi chaque mini-jeu livré dans un vrai navigateur, avec des touches seulement (aucun
toucher, aucun état écrit par le test), en lisant la page comme un joueur : les images des options, les noms des
cachettes et des fiches, la surbrillance d'aide de `pipes` ; une victoire est un mini-jeu terminé sans son bouton
Passer (`App.minigameLog`, alimenté par l'événement `mg-skip`), et Passer est atteint une fois avec Tab. Sur macOS,
WebKit ne déplace Tab entre les boutons qu'avec Option enfoncée (le réglage du système) : la vérification y presse
Option+Tab. Sur chacun de ces écrans, une violation `serious` ou `critical` fait échouer le passage (`AXE_ACCEPTED` dans
`scripts/e2e/lib.mjs` liste les règles acceptées : aucune aujourd'hui). Les images sont décoratives sauf si elles
sont nommées (la scène s'atteint par ses cibles, un objet par son nom), une case vide de l'inventaire sort de
l'arbre d'accessibilité. CI : la ligne Chromium clavier (clavier, axe, une sauvegarde aller-retour sans IndexedDB,
`e2e:a11y`) est bloquante, tout comme `e2e:a11y` dans la ligne WebKit ; le jeu entier au clavier dans WebKit est
aussi bloquant (depuis la 3.3.1). axe ne prouve pas la conformité WCAG : un passage au lecteur d'écran (VoiceOver sur iOS,
TalkBack sur Android : le titre, une conversation, un objet, la carte, un mini-jeu) reste une vérification manuelle
avant une release, avec la liste de contrôle de `docs/dev/SCREEN-READER.md` et le résultat dans `docs/dev/passes/`. Ce
que le moteur peut affirmer est donc « testé au clavier, aucune violation axe grave ou critique sur les écrans
contrôlés », pas « WCAG AA ».
## Deux dispositions

- **Téléphone (écran tactile), en paysage** : la scène à gauche ; à droite, une colonne avec les 9 verbes en 3×3, le sac sur 3 colonnes et les icônes Carte / Menu / Son. La phrase s'affiche en bas de la scène.
- **Ordinateur (souris, écran d'au moins 720 × 450)** : disposition SCUMM classique. La scène occupe le haut ; la phrase est juste en dessous ; en bas à gauche, les 9 verbes ; à droite, le sac (4 × 2, flèches à gauche) ; tout à droite, les 3 icônes en colonne.
  Les choix de conversation et la liste des lieux prennent la place des verbes et du sac.

Le choix se fait tout seul (`App.layout`), et se refait si la fenêtre change de taille.

## Assets : un seul graphe

`src/engine/core/asset-graph.ts` dit quels fichiers chaque partie du jeu demande, d'après le contenu : le titre (décor,
logo, musique, vidéo, icônes de la colonne, le sac au départ), chaque lieu (décor ; accessoires dans tous leurs états et
images d'animation ; chaque personnage qui peut s'y tenir, ses acteurs, les personnages jouables qui l'atteignent depuis
leur départ par les sorties, la carte ou les commandes, ceux qu'on y déplace, avec variantes, bouches et portrait ; sa
musique ; ce que ses commandes peuvent jouer ou montrer), la carte, ce que les règles globales peuvent jouer, et
`offline` (chaque fichier que le jeu livre). Le renderer précharge la part d'un lieu pour qui s'y trouve vraiment, le
préchargement de fond lit les portées du lieu courant et des voisins, le plan hors ligne complet est la portée
`offline`, la provenance la couvre, et `npm run weight` la budgète ; un fichier que l'un connaît ne peut échapper aux
autres. La portée d'un lieu sur-approxime une visite (toutes les variantes, chaque personnage qui pourrait s'y trouver),
jamais l'inverse : `npm run e2e:weight` échoue sur une requête hors prédiction.

Les polices par défaut passent par le bundler, avec des noms hachés : le précache du service worker les prend dans le
cache HTTP au lieu de les télécharger une seconde fois. La police d'interface est un sous-ensemble latin (118 Ko,
`tools/subset-font.py`) ; DotGothic16 complète (2 Mo, surtout du japonais) est une seconde face dont le `unicode-range`
ne couvre que le reste : un navigateur ne la télécharge, et ne la garde, que pour un caractère hors du sous-ensemble.

## Cache et fluidité

- Un **service worker** (vite-plugin-pwa / Workbox) garde l'application de base en cache dès la première visite. Les images et les sons sont gardés au premier usage, puis servis sans réseau.
  La musique est servie par morceaux (requêtes partielles) depuis le cache.
- Dès l'écran titre puis après chaque changement de lieu, le moteur **réchauffe en tâche de fond** le lieu courant, les lieux directement accessibles et leur audio, par lots dimensionnés par `GameDef.assetBudgets`. Puis, une fois par page, **le reste du jeu** (`GameDef.offline`, défaut `full`) : chaque image, bruitage, voix, musique et vidéo, lot par lot pendant les temps morts, en pause quand la page est cachée ; rien en « économie de données » ou en 2G, musiques et vidéos attendent mieux que la 3G. `offline: 'nearby'` garde seulement le réchauffement par lieu.
- Chaque adresse d'image ou de son porte `?v=<empreinte>` : l'empreinte change dès qu'un fichier de `public/assets` change, ce qui contourne l'ancien cache. Le fichier de la fin scellée (`data/`) est toujours redemandé au réseau d'abord.
- Après la première visite, le jeu entier se joue hors ligne, et le jeu dit si c'est vrai : le préchargement rend un statut (`App.offlineStatus`, `offlineReady`) : `complete` seulement quand chaque fichier du plan est dans le cache ; `partial` avec sa raison (`network` et les fichiers en échec, `save-data`, `slow`, `quota` quand le navigateur annonce moins de 64 Mo libres avant de commencer) ; `skipped` quand rien n'a été tenté ; `off` avec `offline: 'nearby'`. Le menu pause l'affiche (`ui.offlineStatus` : « 312/400 », « jeu entier en cache », « 312/400 ⚠ toucher pour réessayer ») ; un toucher relance un préchargement partiel, et un fichier déjà dans le Cache API n'est jamais redemandé, donc le préchargement reprend d'un rechargement à l'autre sans état propre. `npm run e2e:pwa` exige `complete`, puis vérifie hors ligne chaque fichier du plan dans le cache et rend un lieu jamais visité (Chromium ; WebKit ne sait pas naviguer hors ligne sous automatisation et répond « skipped », code 3, accepté seulement par le `--allow-skip` de la CI). Avec `offline: 'nearby'`, un lieu jamais visité ni préchargé peut encore demander le réseau.

## Cycle d'une action

1. Le joueur choisit un verbe, puis touche une chose (ou un objet du sac, puis une cible).
2. `App` appelle `engine.act({ verb, a, b })`.
3. Le moteur fait marcher le héros jusqu'au point d'approche (layout), le tourne vers la cible.
4. `resolve` cherche la réaction : règle du lieu → règle du jeu → Regarder → Parler (indices, conversation) → sorte → refus → repli.
5. Les commandes s'exécutent une à une ; chacune appelle le Presenter (dire, marcher, changer un accessoire, jouer un son…).
6. À la fin, l'état est sauvegardé (autosauvegarde IndexedDB vérifiée ; les emplacements manuels vivent dans la même
   base, en enveloppes, vérifiés aussi ; localStorage est le repli de compatibilité). Tout l'état est du JSON : `GameState` dans `types.ts`.
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
