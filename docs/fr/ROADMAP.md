# Feuille de route : du moteur réactif au moteur de monde (v1.3 → v2.0)

*Rédigée le 3 octobre 2026 à partir d'un audit externe de la v1.2.1 ; M1 est livré en v1.3.0. Version anglaise : [docs/en/ROADMAP.md](../en/ROADMAP.md).*

## Contexte

Un audit externe de web-scumm (v1.2.1) conclut que le moteur sait produire un bon point-and-click court, mais pas confortablement un jeu de 30-100 salles, parce qu'il est purement réactif (clic → règle → commandes) et sans simulation de monde. J'ai vérifié ses 18 affirmations contre le code : 12 exactes, 4 partielles, 2 fausses (`give`/`take`/`room` ne sont pas des commandes ; les mini-jeux ne sont pas dans le core, ils sont déjà un registre extensible depuis `games/<id>/index.ts`). Le diagnostic principal tient.

Objectif de l'utilisateur : qu'une personne seule, avec n'importe quelle IA, puisse faire un jeu **complet** (long) avec ce moteur. Ce plan ordonne les évolutions par ce qui bloque réellement un jeu long, pas par fidélité à DOTT.

Ce qui est vrai aujourd'hui (vérifié dans `src/engine/core/types.ts`, `engine.ts`, `src/engine/tools/solve.ts`) :
- un seul `hero`, un seul inventaire ; acteurs stockés par `room.actor`, aucune commande ne déplace un acteur vers une autre salle ;
- aucun script autonome, aucun timer, aucun événement : `onEnter` est le seul déclencheur hors clic ; la seule boucle est le rAF du rendu ;
- 640 × 400 fixe, pas de caméra ; pas d'animation d'accessoire ni d'événement de frame ;
- sujets de conversation `{topic, if, do}` par salle, branchements via `choice`/`if` dans `do` ;
- sorties = hotspots avec `goto` ; `validate` ne construit pas de graphe de salles ;
- une seule sauvegarde (`<id>.save`), version différente ⇒ nouvelle partie, pas de migration ;
- solveur best-first, `--max 20000`, départ possible d'un checkpoint, aucune notion d'objectif ni d'invariant ;
- pas de `custom`, pas de locale, pas de `voice`, réglages = musique/sfx.

## Avis sur l'audit (ce que je garde, ce que je change)

**Je garde** : scheduler + événements + acteurs du monde comme premier jalon ; ne pas réécrire, ne pas passer à Phaser ; solveur par chapitre avec objectifs/invariants ; sauvegardes multi-slots avec migrations data-only ; debugger « pourquoi cette règle est indisponible » ; animations avec événements de frame ; escape hatch avec effets déclarés au solveur.

**Je change** :
- *Événements et scheduler sont une seule feature.* Un bus d'événements sans scripts capables d'attendre (`waitEvent`, `waitUntil`) n'est qu'un flag renommé. Les deux arrivent ensemble, dans le même format de state sérialisable.
- *Multi-protagonistes n'est pas P0* pour « n'importe qui fait un jeu complet » : c'est P0 uniquement pour DOTT. Il passe après la caméra et après les sauvegardes, parce qu'il change la forme du state et doit profiter des migrations.
- *Pas de « dialogue graph » séparé.* Les sujets + `choice` + `do` sont déjà un graphe de données ; un second format dupliquerait le DSL et casserait solveur, MCP et prompts. Ce qu'il manque est la **visualisation** dans le Studio (arbre dérivé des sujets) et le remplissage des trous connus (le Studio ne sait pas ajouter/supprimer un sujet). Le combat d'insultes est une *activité* (mini-jeu), pas une primitive de dialogue.
- *Mini-jeux → plugins* : déjà le cas (`minigames` exporté par le jeu, fusionné dans `App`). Il manque seulement la doc et un exemple hors core ; pas une priorité.
- *Localisation* : retrofit par extraction (textes identifiés par chemin `room.hotspot.look`, fichiers `locales/<lang>.json` qui surchargent) plutôt que par clés dans le contenu, pour ne pas alourdir le DSL que l'IA écrit. Reste P2.
- *Le vrai risque* n'est pas technique : chaque primitive ajoutée doit être comprise par `validate`, `solve`, CONTENT_GUIDE en/fr, le générateur de prompts, les outils MCP et le Studio, sinon l'IA ne l'utilisera pas ou mal. Chaque jalon ci-dessous inclut cette propagation, et la démo utilise chaque primitive au moins une fois.

## Principes de conception (valables pour tous les jalons)

1. **Tout reste données** : nouvelles commandes dans l'union `Cmd`, nouveaux champs typés sur `RoomDef`/`GameDef`, jamais de fonctions dans le contenu (sauf le registre `custom`, qui vit dans `index.ts` comme les mini-jeux).
2. **Tout est dans `GameState`** : compteur de programme des scripts, acteurs du monde, caméra ⇒ sauvegarde et reprise exactes, solveur déterministe.
3. **Le solveur modélise le temps comme un choix** : « laisser le script X finir son itération » est une action du solveur, les `wait` sont nuls en simulation ; les effets d'un `custom` sont déclarés (`effects: Cmd[]`).
4. **Un jalon = un bump de `saveVersion` au plus**, avec migration fournie.
5. **Le jeu privé d'origine suit** : son dépôt embarque une copie de `src/engine` ; à chaque jalon, le moteur est recopié et le jeu rejoué (e2e, 37 tests, solveur). C'est le test de non-régression grandeur nature.

## Jalons

### M1 — « World » (v1.3, livré) : le monde agit sans clic

Fichiers : `src/engine/core/{types,engine,state}.ts`, nouveau `src/engine/core/scheduler.ts`, `src/engine/tools/{validate,solve}.ts`, `src/engine/dom/{app,room}.ts`, `src/engine/dev/panel.ts`.

- **Acteurs du monde** : `GameState.actors` devient `Record<actorId, {room, x, y, pose, facing, visible}>` (clé sans préfixe de salle). `CharacterDef.room?` donne la salle initiale ; une salle liste toujours ses acteurs attendus (`RoomDef.actors`) mais le rendu lit `state.actors[id].room === room`. Commande `{ moveActor: [who, room, entry?] }`. Migration : `room.actor` → `{room: …}`.
- **Événements** : `{ emit: 'bell_rang', payload? }` ; `RoomDef.events` et `GameRules.events`: `Array<{ on: string; if?: Cond; once?: boolean; do: Cmd[] }>`. Un événement n'est pas un état : il déclenche, puis disparaît. `GameState.pendingEvents` pour ceux émis pendant une cutscene.
- **Scheduler** : `RoomDef.scripts` / `GameDef.scripts`: `Array<{ id; while?: Cond; if?: Cond; loop?: boolean; do: Cmd[] }>`. Nouvelles commandes : `{ waitUntil: Cond }`, `{ waitEvent: id }`, `{ startScript: id }`, `{ stopScript: id }`, `{ every: ms, do }` (sucre pour loop + wait). `GameState.scripts: Record<id, {pc: number[], waiting?: …}>` pour reprendre après rechargement. Les scripts tournent entre deux actions du joueur et pendant la marche ; ils se mettent en pause pendant une cutscene et un mini-jeu (règle simple, documentée).
- **Solveur** : ajoute aux actions possibles « avancer le script S jusqu'à son prochain point d'attente / fin d'itération » ; `wait` = 0 ; `waitUntil` bloque tant que la condition est fausse. `validate` : événement émis mais jamais écouté et inversement, script sans effet, `waitEvent` sur un événement jamais émis.
- **Studio / dev** : le panneau `?dev` affiche scripts actifs, acteurs du monde et file d'événements ; bouton « avancer le script ». Studio Check montre les mêmes diagnostics.
- **Démo** : le chat (ou le voisin) patrouille entre jardin et marché ; une cloche du marché émet un événement écouté par la maison.
- **Docs/outils** : CONTENT_GUIDE en/fr section « Le monde vit » ; `tools/prompts.ts` inchangé ; MCP : les outils `room`/`add` acceptent `scripts`/`events` ; AGENTS.md règle « un PNJ qui bouge est un script, pas une règle ».

### M2 — « Scale » (v1.4, livré) : tenir 40 salles sans perdre les testeurs

Fichiers : `src/engine/tools/{validate,solve}.ts`, nouveau `src/engine/tools/graph.ts`, `src/engine/dom/app.ts` (menu), nouveau `src/engine/core/migrate.ts`, `tools/pages/review.ts` ou nouvelle page `world`.

- **Sorties déclarées** : `RoomDef.exits: Record<id, { to: room; entry?: string; if?: Cond; walkTo?: Point; transition?: 'fade'|'cut' }>`. Un exit est rendu comme un hotspot (même layout), le moteur génère la règle `goto`. Les hotspots `goto` existants restent valides.
- **Graphe du monde** : `graph.ts` construit salles/sorties/entrées ; `validate` signale salle inaccessible, entrée inexistante, sortie à sens unique non voulue (sauf `oneWay: true`). Page `npm run page:world` : graphe cliquable (export DOT/SVG), aussi dans le Studio Check.
- **Chapitres et objectifs** : `checkpoints[i].goals?: Cond[]` et `GameDef.invariants?: Cond[]` (« jamais vrai »). `solve` : par défaut, résout checkpoint à checkpoint (chaque segment borné), puis global si demandé ; échoue si un invariant devient vrai sur un chemin atteint. Sortie `--json` enrichie des segments (l'e2e rejoue déjà le chemin).
- **Sauvegardes** : `GameDef.saves?: { slots: number }` (défaut 1 = comportement actuel). Menu pause : sauver/charger dans un slot avec salle, date, durée, miniature (capture `room` déjà possible côté Studio ; côté jeu, une capture CSS→canvas est hors budget : vignette = décor de la salle). Export/import JSON d'un slot. Clé `<id>.save.<n>`, `<id>.save` migré vers le slot 1.
- **Migrations data-only** : `GameDef.migrations?: Array<{ from: number; renameFlag?; renameItem?; renameRoom?; renameActor?; drop? }>`, appliquées en chaîne dans `migrate.ts` avant `ensureProps`. `validate` : les renommages pointent sur des ids existants.
- **Profileur de contenu** : `npm run validate -- --report` : par salle (hotspots sans `look`, verbes en repli, props sans changement), par objet (obtenu où, utilisé combien, consommé), par personnage (sujets, inatteignables, lignes > N). Même rapport dans Studio Check.
- **Démo** : 3 salles → exits déclarés, 2 checkpoints avec goals, 1 invariant, 3 slots.

### M3 — « Picture » (v1.5, livré) : la mise en scène

Fichiers : `src/engine/core/types.ts` (Layout, PropDef, Cmd), `src/engine/dom/room.ts`, `src/engine/dev/editor.ts`, `tools/pages/placement.ts`, `tools/assets.py`.

- **Salles larges et caméra** : `Layout.width?: number` (≥ 640, hauteur reste 400) ; les coordonnées logiques s'étendent ; `assets.py` accepte des décors plus larges que 1280. `GameState.camera: {x, target?}`. Commandes `{ camera: 'follow' | {pan: x, ms} | {to: who} | 'reset' }`. `room.ts` translate le calque scène ; `shake` existe déjà. Éditeur et page de placement affichent la salle entière avec le cadre caméra. Solveur : ignore la caméra.
- **Animations d'accessoires avec événements de frame** : `PropDef.anims?: Record<name, { frames: ImgId[]; fps?; loop?; at?: Record<frameIndex, Cmd[]> }>` ; commandes `{ play: [prop, anim] }`, `{ waitAnim: prop }`. Même `at` sur les poses `anim` des personnages. Le solveur exécute les `at` dans l'ordre, sans attendre.
- **Voix** : `say` accepte `voice?: SoundId` ; `GameDef.audio.voices?` ; auto-avance à la fin du clip ; réglage voix séparé. `refs.ts`/`assets.py` prennent les clips en compte.
- **Préférences** : `GameDef.ui.settings?` active vitesse du texte, taille des sous-titres, réduction des animations/shake, police dys (fournie par le jeu dans `skin.fonts`), volumes musique/sfx/voix. Stockées hors sauvegarde.
- **Démo** : marché élargi (1,5 écran) avec suivi caméra ; porte du garde-manger animée avec `sfx` à la frame 3.

### M4 — « Cast » (v1.6, livré) : plusieurs personnages jouables

Fichiers : `types.ts`, `engine.ts`, `state`, `dom/app.ts` (inventaire, bouton de bascule), `solve.ts`, `validate.ts`, `migrate.ts`.

- `GameDef.hero` reste valide (sucre pour un seul joueur). Nouveau `GameDef.players?: { ids: Id[]; initial: Id; sharedInventory?: boolean }`.
- `GameState.players: Record<Id, { room, inventory, hero: Record<room, Point> }>` + `GameState.active`. Les champs plats `room`/`inventory`/`hero` deviennent des vues sur le joueur actif (accès centralisé dans `state.ts` pour ne pas toucher cent endroits). Migration fournie (saveVersion +1).
- Commandes `{ switchPlayer: id }`, `{ transfer: [item, to] }` ; condition `{ player: id }` ; bouton de bascule dans l'interface, `ui` textes.
- Solveur : la bascule est une action ; le hash inclut tous les joueurs. Validate : objet transférable vers un joueur qui ne peut jamais le recevoir.
- Fixture de test dédié (voir M5) ; la démo n'en a pas besoin, un second exemple `games/trio` (3 salles, 2 joueurs) sert d'illustration et de test e2e.

### M5 — « Open » (v2.0, livré) : ouverture et robustesse

- **Commandes custom** : `games/<id>/index.ts` exporte `commands?: Record<name, { run(ctx, args): Promise<void>; effects?: Cmd[] }>` ; commande `{ custom: name, args }`. Le solveur applique `effects` ; `validate` exige `effects` ou `pure: true`. Doc : « quand le DSL ne suffit pas ».
- **Localisation** : `npm run i18n extract` écrit `games/<id>/locales/<base>.json` (clé = chemin de contenu, valeur = texte) ; `locales/<lang>.json` surcharge au chargement ; `GameDef.lang`/sélecteur. Studio : onglet couverture (manquant, trop long). Le contenu source reste inline : rien ne change pour l'IA qui écrit un jeu.
- **Micro-jeux de test** : `tests/fixtures/{scripts,events,actors,exits,saves,camera,players}/` d'une salle chacun, un test par primitive ; le fixture actuel reste pour le socle.
- **Studio « Play »** : onglet jouant le jeu en iframe `?dev` avec inspecteur d'état (déjà dans le panneau dev) et **explicateur de règle** : clic sur un hotspot/objet → liste des règles candidates avec chaque condition évaluée ✓/✗ (réutilise `evalCond` du core, exposé en mode dev).
- **Mini-jeux** : rien à coder, documenter le registre existant comme `activities` et livrer un exemple dans `games/_template`.

## v2.1 « Proof » (livrée) : prouver le moteur plutôt que l'étendre

Un second audit, sur la 2.0.1, a conclu que les primitives étaient là et que l'étape suivante était la preuve et
l'outillage, pas d'autres commandes. Deux de ses affirmations étaient fausses (`engine.ts` et `types.ts` font moins de
mille lignes chacun, pas trois mille), sa direction était juste. Ce que la v2.1 a livré :

- **Un seul catalogue des commandes** (`src/engine/core/cmds.ts`) : chaque clé de `Cmd`, lesquelles portent des listes
  imbriquées, lesquelles changent l'état, lesquelles portent du texte ; le validateur, le solveur, le parcours des
  textes et les outils de contenu le lisent. Ajouter une variante à `Cmd` sans la lister casse `tsc` ;
  `tests/cmds.test.ts` passe chaque commande dans le validateur et le moteur.
- **Les classiques** (`docs/fr/CLASSICS.md`) : vingt mécaniques célèbres du genre écrites avec le DSL tel quel, chacune
  marquée natif / faisable / custom, cinq jouées et prouvées dans `tests/classics.test.ts`. Les écrire a trouvé trois
  vrais trous du solveur, corrigés : il ne prenait que la dernière option d'un `choice`, il bornait les compteurs qui
  baissent (le marchandage), et il jouait un script d'un bloc au lieu d'un `wait` à la fois (une ronde n'était jamais
  vue dans la salle du milieu).
- **Le graphe de puzzles** (`src/engine/tools/puzzle.ts`) : ce que chaque règle, sujet, script et écouteur exige et
  change ; une fiche par objet, flag, accessoire, lieu ou événement (obtenu par, utilisé par, exige d'abord, débloque,
  en aval) ; dans l'onglet Check du Studio, en page `npm run page:puzzles`, en outil `puzzle_graph`. Le validateur s'en
  sert pour repérer un flag posé seulement par des actions qui l'exigent déjà.
- **Le solveur élague ce qui ne peut pas compter** : depuis le même graphe, un flag que seul son poseur lit, un script
  dont les effets n'atteignent rien de vivant, un promeneur que personne n'attend sortent de l'état. Le jeu généré de
  40 salles est passé de « 20 000 états, tronqué » à 804 états en une seconde (`docs/fr/BENCH.md`).
- **Un jeu de charge généré** (`src/engine/tools/stress.ts`, `npm run bench`) : salles, joueurs, objets, flags,
  promeneurs, scripts, sujets, chapitres et migrations à toute taille, chaque outil chronométré dessus ; un petit tourne
  dans les tests.
- **Les boucles honorent `at`** pour les sons et les secousses ; le validateur y refuse un changement d'état.
- **Les traductions survivent aux refactors** : `extract --lang xx` suit un texte déplacé (même texte source dans le
  fichier de référence précédent), gare ce qui a disparu sous `_stale:`, le ressuscite quand le chemin revient.

## v2.2 « Studio » (livrée) : voir le dialogue, voir l'horloge

- **L'arbre de dialogue** (`src/engine/tools/dialogue.ts`) : les sujets d'un personnage en arbre (sujets, répliques,
  choix et options, branches, chacun avec sa condition), dérivé du DSL, rien à tenir à jour. Dans l'onglet Rooms du
  Studio (un bouton à côté des sujets ; toucher un nœud saute à son éditeur) et en outil `dialogue_tree`.
- **Le journal** (`Engine.trace`, mode dev) : ce que chaque action a répondu, les événements émis et les écouteurs
  atteints, les pas de script, les personnages déplacés, les changements de joueur. Dans l'onglet Play du Studio
  (filtrable par sorte) et le panneau dev (les dix derniers).

## v2.3 « Replay » (livrée) : reproduire, profiler, élaguer

Le troisième audit demandait trois choses dont un jeu long a plus besoin que d'une primitive : reproduire le bug d'un
testeur, savoir pourquoi le solveur est lent ou gros, explorer moins d'ordres équivalents. Les trois viennent du même
fait : le moteur sait ce que chaque action a lu et changé.

- **La session** (`Engine.session`, toujours enregistrée) : chaque entrée depuis le début de la partie ou le chargement
  d'une sauvegarde (actions, voyages sur la carte, changements de joueur, pas de script), avec les réponses données en
  chemin (choix, carte, tirages aléatoires) et ce qui a répondu (les ids du graphe de puzzles). « Exporter la session »
  dans le menu de sauvegarde du jeu, dans le panneau dev et dans l'onglet Play du Studio ; `npm run replay -- fichier.json`
  la rejoue sur le vrai moteur sans affichage et dit où elle cesse de correspondre (`src/engine/tools/replay.ts`). Un
  rapport de bug, c'est un fichier de session et une capture ; le **Replay** de l'onglet Play le parcourt au curseur et
  pose le jeu n'importe où en chemin.
- **La solution du solveur est une session** (`SolveResult.steps`) : `replay()` la prouve, le harnais e2e la joue au
  doigt (plus d'analyse de libellés), et la CI joue le jeu d'exemple dans Chromium à chaque push.
- **Le profil du solveur** (`npm run solve -- --profile`, le « Solver health » de l'onglet Check, l'outil `solve` avec
  `profile: true`) : états, exécutions du moteur, actions sans effet, de quoi les états sont faits (quelle dimension les
  sépare le plus), états par lieu, ce qui a répondu le plus (une carte de chaleur sur le graphe de puzzles), les
  combinaisons use/give qui ne pouvaient que retomber sur le repli, les dimensions indépendantes (un checkpoint entre
  elles couperait les états), les choses monotones. Les actions qu'aucune règle écrite ne peut répondre ne sont plus
  exécutées du tout : trois fois moins d'exécutions du moteur sur le jeu d'exemple.
- **Pourquoi est-ce live ?** (`liveClasses`, `whyLive` dans `src/engine/tools/puzzle.ts`) : chaque nœud du graphe de
  puzzles est *critical* (il mène à la fin, à un objectif ou à un invariant), *world*, *visible* ou *dead* (hors de
  l'état du solveur) ; la fiche montre la chaîne ; « Critical path » estompe le reste du graphe.
- **Réduction d'ordre partiel** (`src/engine/tools/por.ts`, `npm run solve -- --por=sleep|stubborn`) : des actions qui
  touchent des choses différentes commutent. `sleep` saute les ordres déjà couverts (moins d'exécutions, les mêmes
  états) ; `stubborn` n'explore qu'une action commutante à la fois (moins d'états aussi : k ramassages indépendants
  avant une porte font k + 1 états au lieu de 2^k). Désactivée par défaut, la recherche simple reste la preuve ;
  `tests/por.test.ts` vérifie que chaque fixture donne les mêmes réponses dans les trois modes.
- **Commandes custom contrôlées** en mode dev : un `run` qui change l'état hors de ses `effects` déclarés est signalé
  dans le journal.
- Deux trous du hash d'état bouchés (`visited`, les compteurs des blocs `random`) ; les répliques de l'arbre de
  dialogue sautent de nouveau à leur éditeur.

## v2.4 « Author » (livrée) : l'histoire face au jeu, la cinématique face au chrono

- **Couverture du storyboard** (`src/engine/tools/coverage.ts`) : le storyboard (`games/<id>/storyboard.json`)
  confronté au contenu : lieux, locuteurs, personnages des conversations et sons par id ; les actions des cases
  (« Open Grandpa's armchair », « Use pipe with tank », « Talk to Lou: Where is the key? ») analysées avec les verbes du
  jeu et les noms des choses du lieu, puis cherchées dans les règles, les réactions par kind, les sujets et les lignes
  Regarder ; répliques, sujets et indices par leur texte (exact, proche, ou absent). Chaque vérification est *ok*,
  *partial* (les morceaux existent, aucune règle ne répond ; une réplique proche), *missing* ou *unknown* (de la
  prose). Des badges sur les boards et les cases de l'onglet Storyboard du Studio (avec la liste de ce qui manque
  encore), un panneau « Storyboard coverage » dans Check, l'outil `storyboard_coverage` (20 outils).
- **La timeline de cinématique** (`src/engine/tools/timeline.ts`, `src/engine/core/timing.ts`) : combien de temps
  prend une liste de commandes et ce qui se chevauche, lu dans le DSL tel qu'il est écrit : les répliques durent ce que
  le présentateur les affiche, les marches la distance que dit le layout, les animations leurs images, les branches
  `parallel` sur leurs propres pistes, un choix ou un mini-jeu marqué comme le tour du joueur. Un bouton « Timeline »
  à côté de chaque cinématique, script d'arrivée et script du monde dans l'onglet Rooms ; toucher une barre saute à sa
  ligne. Les durées du présentateur viennent maintenant d'un seul fichier.
- L'élagage par dominance (cinquième palier de l'auditeur) n'a pas été fait : sur le jeu d'exemple, le jeu privé et le
  jeu de charge, le profil ne montre aucune dimension où les choses monotones dominent ; cela reste une note dans
  `docs/fr/BENCH.md`.

## v2.5 « Sound » (livrée) : musique et bruitages d'une seule palette

- **La chaîne audio** (`tools/audio`, `npm run audio`, `docs/fr/AUDIO.md`) : un MIDI (ou un fichier audio, transcrit)
  devient un arrangement Sega Mega Drive (FM YM2612 + PSG SN76489 + batterie DAC) écrit dans un `spec.json` que
  l'assistant rédige depuis une analyse automatique (pistes, tessitures, doublures, sections) ; Furnace rend `.fur`,
  `.wav`, `.vgm`, `.mp3` ; un rapport QA mesure chaque canal contre les cibles de la palette, la justesse et la crête.
  Une seule palette (`tools/audio/palette.json`) pour chaque morceau de chaque jeu, comme un seul bloc de style sert
  chaque image.
- **Des bruitages de la même palette** (`games/<id>/audio/sfx.json`, `npm run audio -- sfx`) : de courtes recettes sur
  les canaux FM, PSG et bruit, rendues, coupées et normalisées en `audio/sfx/*.mp3`. Les dix-neuf bruitages du jeu
  d'exemple sont maintenant des rendus Mega Drive au lieu d'échantillons Kenney, et il a un thème : l'ouverture du
  *Lac des cygnes* de Tchaïkovski (domaine public), joué sur l'écran titre et dans chaque lieu.
- Agnostique : le déroulé et les règles vivent dans `docs/fr/AUDIO.md` (`read_doc AUDIO` par MCP), `AGENTS.md` nomme
  la commande et la règle de licence ; le skill Claude ne fait qu'y renvoyer.
- Volontairement non fait : la musique adaptative (transitions à la iMUSE) ; Furnace est téléchargé par `setup`, pas
  embarqué ; la CI ne rend pas l'audio (les fichiers sont commités).

## v3 « Trust » (livrée le 4 octobre 2026) : le moteur auquel confier un jeu long

Co-développée par deux assistants selon `docs/dev/CHARTER.md` ; l'échange est `docs/dev/LOG.md`, les décisions
`docs/dev/DECISIONS.md` (en anglais, dépôt public). La v3 peut casser la v2 (D1) : chaque rupture vient avec sa
migration et un guide de mise à niveau, et le jeu privé de référence est migré sur une branche avant de taguer v3.0.0.
Depuis la v3.0.0, `main` est la branche de release et chaque `v3-<sujet>` y est fusionnée dès qu'elle passe ses
portes (D7).

La proposition d'ouverture est la beta de Codex (`v3-beta1`, journal #1), revue au #2. Ses sujets, chacun une branche
`v3-<sujet>` une fois découpé :

- **saves** : enveloppe de sauvegarde validée, autosave IndexedDB relue après chaque écriture, erreurs de stockage
  visibles, mise à jour PWA qui attend une sauvegarde vérifiée ; références périmées élaguées, pas rejetées.
- **prove** : `solve -- --prove` avec un `status` honnête, softlocks par accessibilité inverse, `random` et choix
  imbriqués explorés ; la preuve reste hors de `npm run build`, ou tourne avec la réduction et un budget.
- **ids** : `schemaVersion: 3` avec des ids stables sur règles, choix, sujets, écouteurs, blocs persistants et pas de
  script ; une seule fonction de nommage partagée par le moteur, le solveur et le graphe de puzzles.
- **studio-security** : loopback par défaut, jeton LAN, écritures same-origin, clé en sessionStorage.
- **ci** : e2e sur le build de production, fumée WebKit (non bloquante jusqu'à trois runs verts), `doctor`, `audit:deps`.
- **offline** : préchargement budgété du lieu et de ses voisins, avec un contrat hors ligne explicite limité aux lieux
  mis en cache plutôt qu'un téléchargement illimité de tout le jeu.
- **upgrading** : `docs/en/UPGRADING.md` + `docs/fr/UPGRADING.md`, la liste v2 → v3, exécutée sur le jeu privé de référence.

## v3.1 « Playtest » (livrée le 4 octobre 2026) : ce que la v3.0.0 a laissé ouvert, puis deux outils qu'un studio attend

Une branche `v3-<sujet>` à la fois, chacune avec son entrée de journal, ses tests, ses docs dans les deux langues et
une passe CI, fusionnée dans `main` au fur et à mesure : `v3-webkit` (le rejeu générique depuis le titre ; WebKit
bloquant après ses trois runs verts), `v3-ids` (`npm run ids`, la démo en schéma 3, chemins de traduction par id),
`v3-boot` (`bootGame` ; le correctif du précache du build à deux entrées), `v3-slots` (emplacements dans IndexedDB),
`v3-offline` (le jeu entier hors ligne après la première visite, D5), `v3-a11y` (une partie entière au clavier),
`v3-lint` (le lint de contenu), `v3-playtests` (sessions depuis les téléphones rejouées en CI, blocages sur la
heatmap), `v3-ci` (la preuve mesurée honnêtement, workflows release et prove, Dependabot), `v3-docs` (ce balayage).
Prochain pas du solveur : la réduction en mode preuve, avec `tests/por.test.ts` pour preuve (BENCH.md).

## Hors plan (décisions explicites)

- Pas de Phaser ni de canvas : le Presenter DOM suffit pour quelques dizaines d'images ; une salle large reste une translation CSS.
- Pas de format de dialogue parallèle au DSL.
- Pas de paquet npm avant qu'une seconde personne le demande (inchangé).

## Vérification (à chaque jalon)

1. `npm run validate && npm run solve && npm test && npm run build` verts, CI verte, audit d'assets vert.
2. La démo utilise chaque nouvelle primitive au moins une fois et l'e2e la traverse (capture 844 × 390).
3. Une sauvegarde faite avec la version précédente de la démo se charge après migration (test unitaire sur un JSON figé par jalon).
4. Copie de `src/engine` dans le dépôt privé : 37 tests, solveur 62 actions, e2e le jeu privé d'origine identiques.
5. MCP : `npm run -s mcp` liste les outils mis à jour ; une session d'IA neuve ajoute un script/événement à la démo en suivant seulement CONTENT_GUIDE.
6. Release taguée avec notes de version ; la table « Versions » du README mise à jour.
